// Sync engine against a real (throwaway) database with a fake provider client.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { AccountingClient } from "@/lib/integrations/clients";
import type { RemoteJournal } from "@/lib/integrations/mappers";

const dir = mkdtempSync(path.join(tmpdir(), "nestwise-sync-"));
const file = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${file}`;
process.env.AUTH_SECRET = "test";

const sqlite = new Database(file);
const migrations = path.join(process.cwd(), "prisma/migrations");
for (const m of readdirSync(migrations).filter((x) => !x.endsWith(".toml")).sort()) {
  sqlite.exec(readFileSync(path.join(migrations, m, "migration.sql"), "utf8"));
}
sqlite.close();

// Imported after DATABASE_URL is set so the shared client points at the temp DB.
let prisma: (typeof import("@/lib/prisma"))["prisma"];
let systemAccounts: (typeof import("@/lib/accounting/posting"))["systemAccounts"];
let createInvoice: (typeof import("@/lib/accounting/receivables"))["createInvoice"];
let syncProvider: (typeof import("@/lib/integrations/sync"))["syncProvider"];
let parseDay: (typeof import("@/lib/dates"))["parseDay"];

function fakeClient(withCustomers: boolean) {
  const journals: RemoteJournal[] = [];
  const customers: string[] = [];
  const client: AccountingClient = {
    provider: "QUICKBOOKS",
    companyName: async () => "Fake Co",
    listAccounts: async () => [],
    listClasses: async () => [],
    postJournal: async (j) => {
      journals.push(j);
      return `remote-${journals.length}`;
    },
    ensureCustomer: withCustomers
      ? async (payer) => {
          customers.push(payer.name);
          return `cust-${customers.length}`;
        }
      : null,
  };
  return { client, journals, customers };
}

let payerId: string;

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ systemAccounts } = await import("@/lib/accounting/posting"));
  ({ createInvoice } = await import("@/lib/accounting/receivables"));
  ({ syncProvider } = await import("@/lib/integrations/sync"));
  ({ parseDay } = await import("@/lib/dates"));
  const { DEFAULT_CHART } = await import("@/lib/accounting/accounts");
  const { recordPayment } = await import("@/lib/accounting/receivables");
  const { encrypt } = await import("@/lib/integrations/crypto");
  await prisma.center.create({ data: { name: "Sync Test" } });
  for (const a of DEFAULT_CHART) await prisma.account.create({ data: a });
  const accounts = await systemAccounts(prisma);
  payerId = (await prisma.payer.create({ data: { name: "Pat Payer", kind: "GUARDIAN" } })).id;
  await prisma.$transaction(async (tx) => {
    await createInvoice(tx, {
      payerId,
      issueDate: parseDay("2026-09-01")!,
      lines: [{ description: "Tuition", accountId: accounts.TUITION, amountCents: 100000 }],
    });
    await recordPayment(tx, { payerId, amountCents: 100000, method: "CARD", receivedAt: parseDay("2026-09-01")! });
    await recordPayment(tx, { payerId, amountCents: 5000, method: "CASH", receivedAt: parseDay("2026-09-02")! });
  });
  await prisma.integration.create({
    data: { provider: "QUICKBOOKS", tenantId: "realm", accessTokenEnc: encrypt("a"), refreshTokenEnc: encrypt("r"), expiresAt: new Date(Date.now() + 3600_000) },
  });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("refuses to sync until every used account is mapped", async () => {
  const { client, journals } = fakeClient(false);
  const result = await syncProvider("QUICKBOOKS", { client });
  assert.equal(journals.length, 0);
  assert.match(result.errors[0], /Map these accounts before syncing: .*Accounts Receivable/);
  const integration = await prisma.integration.findUniqueOrThrow({ where: { provider: "QUICKBOOKS" } });
  assert.ok(integration.lastError);
});

test("summary mode posts one balanced journal per day, exactly once", async () => {
  const accounts = await prisma.account.findMany();
  for (const a of accounts) {
    await prisma.externalRef.create({ data: { provider: "QUICKBOOKS", entityType: "ACCOUNT", localId: a.id, remoteId: `q-${a.code}` } });
  }
  const { client, journals } = fakeClient(false);
  const result = await syncProvider("QUICKBOOKS", { client });
  assert.deepEqual(result.errors, []);
  assert.equal(journals.length, 2); // Sep 1 and Sep 2
  for (const j of journals) {
    const debit = j.lines.filter((l) => l.postingType === "Debit").reduce((a, l) => a + l.amountCents, 0);
    const credit = j.lines.filter((l) => l.postingType === "Credit").reduce((a, l) => a + l.amountCents, 0);
    assert.equal(debit, credit);
  }
  // Sep 1: invoice and payment net A/R to zero, so it never appears.
  assert.equal(journals[0].lines.some((l) => l.accountRemoteId === "q-1100"), false);

  const again = fakeClient(false);
  await syncProvider("QUICKBOOKS", { client: again.client });
  assert.equal(again.journals.length, 0);

  // A backdated entry lands in its own journal instead of rewriting the synced day.
  const accountsMap = await systemAccounts(prisma);
  await prisma.$transaction((tx) =>
    createInvoice(tx, {
      payerId,
      issueDate: parseDay("2026-09-01")!,
      lines: [{ description: "Late registration", accountId: accountsMap.REGISTRATION, amountCents: 2500 }],
    }),
  );
  const third = fakeClient(false);
  await syncProvider("QUICKBOOKS", { client: third.client });
  assert.equal(third.journals.length, 1);
  assert.equal(third.journals[0].date, "2026-09-01");
});

test("detailed mode creates the customer once and tags A/R lines", async () => {
  await prisma.integration.update({ where: { provider: "QUICKBOOKS" }, data: { syncMode: "DETAILED" } });
  await prisma.externalRef.deleteMany({ where: { entityType: "JOURNAL_ENTRY" } });
  const { client, journals, customers } = fakeClient(true);
  const result = await syncProvider("QUICKBOOKS", { client });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(customers, ["Pat Payer"]);
  assert.equal(journals.length, 4);
  const ar = journals.flatMap((j) => j.lines).filter((l) => l.accountRemoteId === "q-1100");
  assert.ok(ar.length > 0 && ar.every((l) => l.customerRemoteId === "cust-1"));
});
