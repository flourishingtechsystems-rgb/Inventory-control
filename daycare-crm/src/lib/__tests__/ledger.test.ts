import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UnbalancedEntryError,
  agingBucket,
  agingReport,
  balanceSheet,
  normaliseLines,
  profitAndLoss,
  trialBalance,
  type AccountTotals,
} from "@/lib/accounting/ledger";
import { parseDay } from "@/lib/dates";

const d = (s: string) => parseDay(s)!;

test("normaliseLines rejects unbalanced entries and folds negatives", () => {
  assert.throws(
    () => normaliseLines([{ accountId: "a", debitCents: 100 }, { accountId: "b", creditCents: 99 }]),
    UnbalancedEntryError,
  );
  assert.throws(() => normaliseLines([{ accountId: "a", debitCents: 0 }]), UnbalancedEntryError);
  const lines = normaliseLines([
    { accountId: "ar", debitCents: 1000 },
    { accountId: "rev", creditCents: 1200 },
    { accountId: "disc", creditCents: -200 },
    { accountId: "zero", debitCents: 0 },
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2], { accountId: "disc", debitCents: 200, creditCents: 0, payerId: null, classroomId: null, memo: null });
});

const rows: AccountTotals[] = [
  { id: "1", code: "1000", name: "Bank", type: "ASSET", debitCents: 50000, creditCents: 10000 },
  { id: "2", code: "1100", name: "AR", type: "ASSET", debitCents: 100000, creditCents: 50000 },
  { id: "3", code: "3000", name: "Equity", type: "EQUITY", debitCents: 0, creditCents: 20000 },
  { id: "4", code: "4000", name: "Tuition", type: "REVENUE", debitCents: 0, creditCents: 100000 },
  { id: "5", code: "4900", name: "Discounts", type: "REVENUE", debitCents: 5000, creditCents: 0 },
  { id: "6", code: "6100", name: "Fees", type: "EXPENSE", debitCents: 25000, creditCents: 0 },
];
// Balanced input: debits 180000 = credits 180000.

test("trial balance, P&L and balance sheet tie out", () => {
  const tb = trialBalance(rows);
  assert.ok(tb.balanced);
  const pl = profitAndLoss(rows);
  assert.equal(pl.totalRevenue, 95000);
  assert.equal(pl.totalExpenses, 25000);
  assert.equal(pl.netIncome, 70000);
  const bs = balanceSheet(rows);
  assert.equal(bs.totalAssets, 90000);
  assert.equal(bs.totalEquity, 90000);
  assert.ok(bs.balanced);
});

test("aging buckets", () => {
  assert.equal(agingBucket(d("2026-10-20"), d("2026-10-20")), "Current");
  assert.equal(agingBucket(d("2026-10-01"), d("2026-10-20")), "1–30");
  assert.equal(agingBucket(d("2026-08-01"), d("2026-10-20")), "61–90");
  assert.equal(agingBucket(d("2026-01-01"), d("2026-10-20")), "90+");
  const report = agingReport(
    [
      { payerId: "p", payerName: "P", dueDate: d("2026-10-30"), balanceCents: 100 },
      { payerId: "p", payerName: "P", dueDate: d("2026-09-01"), balanceCents: 50 },
      { payerId: "q", payerName: "Q", dueDate: d("2026-09-01"), balanceCents: 0 },
    ],
    d("2026-10-20"),
  );
  assert.equal(report.rows.length, 1);
  assert.equal(report.grandTotal, 150);
  assert.equal(report.totals["31–60"], 50);
});
