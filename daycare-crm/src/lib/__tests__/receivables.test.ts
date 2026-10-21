// End-to-end ledger test against a throwaway SQLite database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { DEFAULT_CHART } from "@/lib/accounting/accounts";
import { PeriodLockedError, systemAccounts } from "@/lib/accounting/posting";
import {
  applyLateFees,
  createAdjustment,
  createDeposit,
  createInvoice,
  payerLedgerBalance,
  recordPayment,
  refundPayment,
  voidInvoice,
} from "@/lib/accounting/receivables";
import { postBillingRun, previewBillingRun } from "@/lib/accounting/billing-run";
import { parseDay } from "@/lib/dates";

const d = (s: string) => parseDay(s)!;
let dir: string;
let db: PrismaClient;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nestwise-test-"));
  const file = path.join(dir, "test.db");
  const sqlite = new Database(file);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const m of readdirSync(migrations).filter((x) => !x.endsWith(".toml")).sort()) {
    sqlite.exec(readFileSync(path.join(migrations, m, "migration.sql"), "utf8"));
  }
  sqlite.close();
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  await db.center.create({ data: { name: "Test Center", siblingDiscountBps: 1000, lateFeeCents: 2500, lateFeeGraceDays: 5 } });
  for (const a of DEFAULT_CHART) await db.account.create({ data: a });
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function assertBooksBalance() {
  const agg = await db.journalLine.aggregate({ _sum: { debitCents: true, creditCents: true } });
  assert.equal(agg._sum.debitCents, agg._sum.creditCents);
}

test("full receivables lifecycle keeps GL and sub-ledger in agreement", async () => {
  const accounts = await systemAccounts(db);
  const family = await db.family.create({ data: { name: "Garcia" } });
  const mom = await db.guardian.create({ data: { familyId: family.id, firstName: "Maria", lastName: "Garcia", isPrimary: true } });
  const payer = await db.payer.create({ data: { name: "Maria Garcia", kind: "GUARDIAN", familyId: family.id, guardianId: mom.id } });
  const agency = await db.payer.create({ data: { name: "County Subsidy", kind: "AGENCY" } });
  const room = await db.classroom.create({ data: { name: "Toddlers", ageGroup: "1-2", capacity: 10, ratio: 5 } });
  const plan = await db.feePlan.create({
    data: { name: "Toddler Full-Time", amountCents: 120000, frequency: "MONTHLY", revenueAccountId: accounts.TUITION, classroomId: room.id },
  });
  const ava = await db.child.create({ data: { familyId: family.id, firstName: "Ava", lastName: "Garcia", dateOfBirth: d("2024-05-01"), classroomId: room.id } });
  const ben = await db.child.create({ data: { familyId: family.id, firstName: "Ben", lastName: "Garcia", dateOfBirth: d("2025-03-01"), classroomId: room.id } });
  const e1 = await db.enrollment.create({ data: { childId: ava.id, feePlanId: plan.id, startDate: d("2026-01-01") } });
  await db.enrollment.create({ data: { childId: ben.id, feePlanId: plan.id, startDate: d("2026-01-01") } });
  await db.billingSplit.create({ data: { enrollmentId: e1.id, payerId: agency.id, kind: "FIXED", value: 50000 } });

  // Billing run: 2 × $1,200, 10% sibling discount on one, agency covers $500 of Ava.
  const preview = await previewBillingRun(db, "MONTHLY", d("2026-10-01"));
  assert.equal(preview.invoices.length, 2);
  assert.equal(preview.totalCents, 240000 - 12000);
  const { run } = await postBillingRun(db, "MONTHLY", d("2026-10-01"), { issueDate: d("2026-10-01") });
  assert.ok(run);
  // Re-running bills nothing new.
  const again = await previewBillingRun(db, "MONTHLY", d("2026-10-01"));
  assert.equal(again.invoices.length, 0);
  assert.ok(again.skippedAlreadyBilled > 0);

  const agencyInvoice = await db.invoice.findFirstOrThrow({ where: { payerId: agency.id } });
  assert.equal(agencyInvoice.totalCents, 50000);
  assert.equal(await payerLedgerBalance(db, payer.id), 240000 - 12000 - 50000);

  // Overpay by card: fee is expensed, excess becomes a credit.
  const payment = await recordPayment(db, { payerId: payer.id, amountCents: 200000, method: "CARD", receivedAt: d("2026-10-03") });
  assert.equal(payment.feeCents, 5830);
  const momInvoice = await db.invoice.findFirstOrThrow({ where: { payerId: payer.id } });
  assert.equal(momInvoice.status, "PAID");
  assert.equal(await payerLedgerBalance(db, payer.id), -22000);

  // The credit is applied automatically to the next invoice.
  const registration = await createInvoice(db, {
    payerId: payer.id,
    issueDate: d("2026-10-04"),
    lines: [{ description: "Registration", accountId: accounts.REGISTRATION, amountCents: 15000 }],
  });
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: registration.id } })).status, "PAID");

  // Refund the remaining $70 credit.
  await refundPayment(db, { paymentId: payment.id, amountCents: 7000, reason: "Overpayment", date: d("2026-10-05") });
  assert.equal(await payerLedgerBalance(db, payer.id), 0);
  await assert.rejects(
    refundPayment(db, { paymentId: payment.id, amountCents: 1, reason: "x", date: d("2026-10-05") }),
    /unapplied/,
  );

  // Deposit: net of fee and refund.
  const deposit = await createDeposit(db, { paymentIds: [payment.id], date: d("2026-10-06"), reference: "po_123" });
  assert.equal(deposit.amountCents, 200000 - 5830 - 7000);
  const undeposited = await db.journalLine.aggregate({
    where: { accountId: accounts.UNDEPOSITED_FUNDS },
    _sum: { debitCents: true, creditCents: true },
  });
  assert.equal((undeposited._sum.debitCents ?? 0) - (undeposited._sum.creditCents ?? 0), 0);

  // Agency short-pays; remainder written off against the specific invoice.
  await recordPayment(db, { payerId: agency.id, amountCents: 45000, method: "SUBSIDY", receivedAt: d("2026-10-20") });
  await createAdjustment(db, { payerId: agency.id, kind: "WRITE_OFF", amountCents: 5000, reason: "Absent days not reimbursed", date: d("2026-10-20"), invoiceId: agencyInvoice.id });
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: agencyInvoice.id } })).status, "PAID");
  assert.equal(await payerLedgerBalance(db, agency.id), 0);

  await assertBooksBalance();
});

test("late fees are charged once; void reverses; locked periods reject postings", async () => {
  const accounts = await systemAccounts(db);
  const payer = await db.payer.create({ data: { name: "Late Payer", kind: "GUARDIAN" } });
  const inv = await createInvoice(db, {
    payerId: payer.id,
    issueDate: d("2026-09-01"),
    dueDate: d("2026-09-08"),
    lines: [{ description: "Tuition", accountId: accounts.TUITION, amountCents: 10000 }],
  });
  const fees = await applyLateFees(db, d("2026-09-20"));
  assert.equal(fees.filter((f) => f.payerId === payer.id).length, 1);
  assert.equal((await applyLateFees(db, d("2026-09-21"))).filter((f) => f.payerId === payer.id).length, 0);

  const lateFee = fees.find((f) => f.payerId === payer.id)!;
  await voidInvoice(db, { invoiceId: lateFee.id, reason: "Waived", date: d("2026-09-22") });
  assert.equal(await payerLedgerBalance(db, payer.id), 10000);

  await db.center.update({ where: { id: "center" }, data: { lockDate: d("2026-09-30") } });
  await assert.rejects(
    recordPayment(db, { payerId: payer.id, amountCents: 100, method: "CASH", receivedAt: d("2026-09-15") }),
    PeriodLockedError,
  );
  await recordPayment(db, { payerId: payer.id, amountCents: 10000, method: "CASH", receivedAt: d("2026-10-01") });
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "PAID");
  await db.center.update({ where: { id: "center" }, data: { lockDate: null } });
  await assertBooksBalance();
});
