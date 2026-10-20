import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MappingError,
  buildDetailedJournal,
  buildSummaryJournal,
  quickbooksIif,
  summarise,
  toQboJournalEntry,
  toXeroManualJournal,
  unmappedAccounts,
  xeroManualJournalCsv,
  type ExportEntry,
  type Mappings,
  type SyncEntry,
} from "@/lib/integrations/mappers";
import { QuickBooksClient, XeroClient } from "@/lib/integrations/clients";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { parseDay } from "@/lib/dates";

const day = parseDay("2026-10-05")!;

const entries: SyncEntry[] = [
  {
    id: "je1",
    number: 1,
    date: day,
    memo: "Invoice #1001",
    lines: [
      { accountId: "ar", classroomId: null, payerId: "p1", debitCents: 90000, creditCents: 0, memo: null },
      { accountId: "tuition", classroomId: "room1", payerId: null, debitCents: 0, creditCents: 100000, memo: "Tuition" },
      { accountId: "disc", classroomId: "room1", payerId: null, debitCents: 10000, creditCents: 0, memo: "Sibling" },
    ],
  },
  {
    id: "je2",
    number: 2,
    date: day,
    memo: "Payment card",
    lines: [
      { accountId: "undeposited", classroomId: null, payerId: null, debitCents: 87360, creditCents: 0, memo: null },
      { accountId: "fees", classroomId: null, payerId: null, debitCents: 2640, creditCents: 0, memo: "Processing fee" },
      { accountId: "ar", classroomId: null, payerId: "p1", debitCents: 0, creditCents: 90000, memo: null },
    ],
  },
];

const mappings: Mappings = {
  accounts: new Map([
    ["ar", "1210"],
    ["tuition", "4000"],
    ["disc", "4900"],
    ["undeposited", "1050"],
    ["fees", "6100"],
  ]),
  classes: new Map([["room1", "Classroom::Toddlers"]]),
  customers: new Map([["p1", "58"]]),
  accountNames: new Map([["ar", "1100 Accounts Receivable"]]),
  payerNames: new Map([["p1", "Maria Garcia"]]),
};

test("summary nets AR to zero and stays balanced", () => {
  const lines = summarise(entries);
  assert.equal(lines.find((l) => l.accountId === "ar"), undefined);
  const debits = lines.reduce((a, l) => a + l.debitCents, 0);
  const credits = lines.reduce((a, l) => a + l.creditCents, 0);
  assert.equal(debits, credits);
  assert.equal(credits, 100000);
});

test("QBO journal payload", () => {
  const journal = buildSummaryJournal(day, entries, mappings);
  const payload = toQboJournalEntry(journal);
  assert.equal(payload.TxnDate, "2026-10-05");
  assert.ok(payload.DocNumber.length <= 21);
  const tuition = payload.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === "4000")!;
  assert.equal(tuition.Amount, 1000);
  assert.equal(tuition.JournalEntryLineDetail.PostingType, "Credit");
  assert.deepEqual(tuition.JournalEntryLineDetail.ClassRef, { value: "Classroom::Toddlers" });
});

test("detailed QBO journal attaches the customer to AR lines", () => {
  const payload = toQboJournalEntry(buildDetailedJournal(entries[0], mappings, true));
  const ar = payload.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === "1210")!;
  assert.deepEqual(ar.JournalEntryLineDetail.Entity, { Type: "Customer", EntityRef: { value: "58" } });
  assert.match(ar.Description, /Maria Garcia/);
});

test("Xero manual journal signs credits negative and uses tracking", () => {
  const payload = toXeroManualJournal(buildDetailedJournal(entries[0], mappings, false));
  const sum = payload.JournalLines.reduce((a, l) => a + Math.round(l.LineAmount * 100), 0);
  assert.equal(sum, 0);
  const tuition = payload.JournalLines.find((l) => l.AccountCode === "4000")!;
  assert.equal(tuition.LineAmount, -1000);
  assert.deepEqual(tuition.Tracking, [{ Name: "Classroom", Option: "Toddlers" }]);
});

test("unmapped accounts are reported, not silently dropped", () => {
  const partial = { ...mappings, accounts: new Map([["tuition", "4000"]]) };
  assert.ok(unmappedAccounts(entries, partial).includes("1100 Accounts Receivable"));
  assert.throws(() => buildDetailedJournal(entries[0], partial, false), MappingError);
});

test("file exports", () => {
  const exportEntries: ExportEntry[] = entries.map((e) => ({
    ...e,
    lines: e.lines.map((l) => ({ ...l, accountCode: l.accountId, accountName: `Acct ${l.accountId}`, classroomName: l.classroomId ? "Toddlers" : null })),
  }));
  const csv = xeroManualJournalCsv(exportEntries);
  assert.match(csv.split("\r\n")[0], /^\*Narration,\*Date/);
  assert.match(csv, /tuition,Tax Exempt,-1000\.00,Classroom,Toddlers/);
  const iif = quickbooksIif(exportEntries);
  assert.match(iif, /^!TRNS/);
  assert.equal(iif.match(/ENDTRNS\r\n/g)!.length, 3);
});

function fakeFetch(responses: { match: RegExp; status?: number; body: unknown }[], calls: { url: string; init?: RequestInit }[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const r = responses.find((x) => x.match.test(href));
    if (!r) throw new Error(`unexpected request ${href}`);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("QuickBooks client skips posting when DocNumber already exists", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new QuickBooksClient("tok", "123", "sandbox", fakeFetch([
    { match: /\/query\?/, body: { QueryResponse: { JournalEntry: [{ Id: "77" }] } } },
  ], calls));
  const id = await client.postJournal(buildSummaryJournal(day, entries, mappings), "key");
  assert.equal(id, "77");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123\/query\?minorversion=/);
});

test("QuickBooks client posts with requestid and surfaces Fault details", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ok = new QuickBooksClient("tok", "123", "production", fakeFetch([
    { match: /\/query\?/, body: { QueryResponse: {} } },
    { match: /\/journalentry\?/, body: { JournalEntry: { Id: "88" } } },
  ], calls));
  assert.equal(await ok.postJournal(buildSummaryJournal(day, entries, mappings), "abc"), "88");
  assert.match(calls[1].url, /requestid=abc/);
  assert.equal((calls[1].init!.headers as Record<string, string>).Authorization, "Bearer tok");

  const failing = new QuickBooksClient("tok", "123", "sandbox", fakeFetch([
    { match: /\/query\?/, body: { QueryResponse: {} } },
    { match: /\/journalentry\?/, status: 400, body: { Fault: { Error: [{ Detail: "Account is inactive" }] } } },
  ], []));
  await assert.rejects(failing.postJournal(buildSummaryJournal(day, entries, mappings), "abc"), /Account is inactive/);
});

test("Xero client sends tenant + idempotency headers and flags system accounts", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new XeroClient("tok", "tenant-1", fakeFetch([
    { match: /ManualJournals/, body: { ManualJournals: [{ ManualJournalID: "mj-1" }] } },
    {
      match: /Accounts/,
      body: {
        Accounts: [
          { Code: "610", Name: "Accounts Receivable", Type: "CURRENT", SystemAccount: "DEBTORS", Status: "ACTIVE" },
          { Code: "620", Name: "Tuition Receivable (Nestwise)", Type: "CURRENT", Status: "ACTIVE" },
        ],
      },
    },
  ], calls));
  assert.equal(await client.postJournal(buildSummaryJournal(day, entries, mappings), "idem-1"), "mj-1");
  const headers = calls[0].init!.headers as Record<string, string>;
  assert.equal(headers["xero-tenant-id"], "tenant-1");
  assert.equal(headers["Idempotency-Key"], "idem-1");
  const accounts = await client.listAccounts();
  assert.ok(accounts[0].unusableReason);
  assert.equal(accounts[1].unusableReason, undefined);
});

test("token encryption round-trips and detects tampering", () => {
  process.env.AUTH_SECRET = "test-secret";
  const sealed = encrypt("refresh-token-value");
  assert.notEqual(sealed, "refresh-token-value");
  assert.equal(decrypt(sealed), "refresh-token-value");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
