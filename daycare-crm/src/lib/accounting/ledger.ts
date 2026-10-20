// Pure double-entry helpers and report math.

import { daysBetween } from "@/lib/dates";

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type LineInput = {
  accountId: string;
  debitCents?: number;
  creditCents?: number;
  payerId?: string | null;
  classroomId?: string | null;
  memo?: string | null;
};

export class UnbalancedEntryError extends Error {}

/** Validates and normalises journal lines; throws if they don't balance. */
export function normaliseLines(lines: LineInput[]) {
  const out = lines
    .map((l) => {
      const debit = l.debitCents ?? 0;
      const credit = l.creditCents ?? 0;
      if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
        throw new UnbalancedEntryError("Amounts must be whole cents.");
      }
      // A negative debit is a credit and vice versa.
      const net = debit - credit;
      return {
        accountId: l.accountId,
        debitCents: net > 0 ? net : 0,
        creditCents: net < 0 ? -net : 0,
        payerId: l.payerId ?? null,
        classroomId: l.classroomId ?? null,
        memo: l.memo ?? null,
      };
    })
    .filter((l) => l.debitCents !== 0 || l.creditCents !== 0);

  if (out.length < 2) {
    throw new UnbalancedEntryError("A journal entry needs at least two non-zero lines.");
  }
  const debits = out.reduce((a, l) => a + l.debitCents, 0);
  const credits = out.reduce((a, l) => a + l.creditCents, 0);
  if (debits !== credits) {
    throw new UnbalancedEntryError(
      `Entry does not balance: debits ${debits} ≠ credits ${credits}.`,
    );
  }
  return out;
}

export function isDebitNormal(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

/** Balance in the account's natural sign (positive = normal balance). */
export function naturalBalance(type: AccountType, debit: number, credit: number): number {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

export type AccountTotals = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debitCents: number;
  creditCents: number;
};

export function trialBalance(rows: AccountTotals[]) {
  const lines = rows
    .filter((r) => r.debitCents !== 0 || r.creditCents !== 0)
    .map((r) => {
      const net = r.debitCents - r.creditCents;
      return { ...r, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
  return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export function profitAndLoss(rows: AccountTotals[]) {
  const pick = (type: AccountType) =>
    rows
      .filter((r) => r.type === type)
      .map((r) => ({ ...r, amount: naturalBalance(type, r.debitCents, r.creditCents) }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  const revenue = pick("REVENUE");
  const expenses = pick("EXPENSE");
  const totalRevenue = revenue.reduce((a, r) => a + r.amount, 0);
  const totalExpenses = expenses.reduce((a, r) => a + r.amount, 0);
  return { revenue, expenses, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
}

/**
 * Balance sheet as of a date. `rows` must be cumulative from inception;
 * current-year earnings are rolled into equity so the sheet balances.
 */
export function balanceSheet(rows: AccountTotals[]) {
  const pick = (type: AccountType) =>
    rows
      .filter((r) => r.type === type)
      .map((r) => ({ ...r, amount: naturalBalance(type, r.debitCents, r.creditCents) }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const earnings = profitAndLoss(rows).netIncome;
  const totalAssets = assets.reduce((a, r) => a + r.amount, 0);
  const totalLiabilities = liabilities.reduce((a, r) => a + r.amount, 0);
  const totalEquity = equity.reduce((a, r) => a + r.amount, 0) + earnings;
  return {
    assets,
    liabilities,
    equity,
    retainedEarnings: earnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export const AGING_BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return "Current";
  if (late <= 30) return "1–30";
  if (late <= 60) return "31–60";
  if (late <= 90) return "61–90";
  return "90+";
}

export type OpenItem = { payerId: string; payerName: string; dueDate: Date; balanceCents: number };

export function agingReport(items: OpenItem[], asOf: Date) {
  const byPayer = new Map<
    string,
    { payerId: string; payerName: string; buckets: Record<AgingBucket, number>; total: number }
  >();
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
  for (const item of items) {
    if (item.balanceCents === 0) continue;
    const bucket = agingBucket(item.dueDate, asOf);
    let row = byPayer.get(item.payerId);
    if (!row) {
      row = {
        payerId: item.payerId,
        payerName: item.payerName,
        buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>,
        total: 0,
      };
      byPayer.set(item.payerId, row);
    }
    row.buckets[bucket] += item.balanceCents;
    row.total += item.balanceCents;
    totals[bucket] += item.balanceCents;
  }
  const rows = Array.from(byPayer.values()).sort((a, b) => b.total - a.total);
  return { rows, totals, grandTotal: rows.reduce((a, r) => a + r.total, 0) };
}
