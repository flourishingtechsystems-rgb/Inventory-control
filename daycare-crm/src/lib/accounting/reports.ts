// Report queries. All figures come from the general ledger (or the A/R
// sub-ledger that is reconciled to it), never from cached totals.

import type { Tx } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/dates";
import { agingReport, type AccountTotals, type AccountType } from "./ledger";
import { systemAccounts } from "./posting";

export async function accountTotals(
  range: { from?: Date | null; to?: Date | null },
  db: Tx | typeof prisma = prisma,
): Promise<AccountTotals[]> {
  const [accounts, sums] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: {
        entry: {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lte: range.to } : {}),
          },
        },
      },
      _sum: { debitCents: true, creditCents: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type as AccountType,
    debitCents: byId.get(a.id)?.debitCents ?? 0,
    creditCents: byId.get(a.id)?.creditCents ?? 0,
  }));
}

export async function openInvoices(db: Tx | typeof prisma = prisma) {
  const invoices = await db.invoice.findMany({
    where: { status: "OPEN" },
    include: { allocations: true, payer: { include: { family: true } } },
    orderBy: { dueDate: "asc" },
  });
  return invoices.map((inv) => ({
    ...inv,
    balanceCents: inv.totalCents - inv.allocations.reduce((a, x) => a + x.amountCents, 0),
  }));
}

export async function arAging(asOf: Date) {
  const invoices = await openInvoices();
  return agingReport(
    invoices.map((inv) => ({
      payerId: inv.payerId,
      payerName: inv.payer.name,
      dueDate: inv.dueDate,
      balanceCents: inv.balanceCents,
    })),
    asOf,
  );
}

/**
 * Proves the A/R sub-ledger (open invoice balances minus unapplied credits)
 * equals the A/R control account in the general ledger.
 */
export async function arReconciliation() {
  const accounts = await systemAccounts(prisma);
  const [glAgg, invoices, payments, adjustments] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { accountId: accounts.AR },
      _sum: { debitCents: true, creditCents: true },
    }),
    openInvoices(),
    prisma.payment.findMany({ include: { allocations: true, refunds: true } }),
    prisma.adjustment.findMany({ include: { allocations: true } }),
  ]);
  const gl = (glAgg._sum.debitCents ?? 0) - (glAgg._sum.creditCents ?? 0);
  const openBalances = invoices.reduce((a, i) => a + i.balanceCents, 0);
  const sum = (xs: { amountCents: number }[]) => xs.reduce((a, x) => a + x.amountCents, 0);
  const unapplied =
    payments.reduce((a, p) => a + p.amountCents - sum(p.allocations) - sum(p.refunds), 0) +
    adjustments.reduce((a, x) => a + x.amountCents - sum(x.allocations), 0);
  const subledger = openBalances - unapplied;
  return { gl, openBalances, unapplied, subledger, difference: gl - subledger };
}

/** Undeposited Funds GL balance vs. the payments waiting to be deposited. */
export async function undepositedReconciliation() {
  const accounts = await systemAccounts(prisma);
  const [glAgg, payments] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { accountId: accounts.UNDEPOSITED_FUNDS },
      _sum: { debitCents: true, creditCents: true },
    }),
    prisma.payment.findMany({ where: { depositId: null }, include: { refunds: true } }),
  ]);
  const gl = (glAgg._sum.debitCents ?? 0) - (glAgg._sum.creditCents ?? 0);
  const pending = payments.reduce(
    (a, p) => a + p.amountCents - p.feeCents - p.refunds.reduce((s, r) => s + r.amountCents, 0),
    0,
  );
  return { gl, pending, difference: gl - pending };
}

/**
 * Dependent-care (FSA / IRS Form 2441) statements: what each family-side payer
 * actually paid for care in the calendar year, net of refunds.
 */
export async function careStatements(year: number) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const payers = await prisma.payer.findMany({
    where: { kind: "GUARDIAN" },
    include: {
      family: { include: { children: true } },
      payments: {
        where: { receivedAt: { gte: from, lte: to } },
        include: { refunds: { where: { date: { gte: from, lte: to } } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return payers
    .map((p) => ({
      payer: p,
      paidCents: p.payments.reduce(
        (a, pay) => a + pay.amountCents - pay.refunds.reduce((s, r) => s + r.amountCents, 0),
        0,
      ),
    }))
    .filter((s) => s.paidCents > 0);
}

/** Revenue by classroom (class tracking) for a date range. */
export async function revenueByClassroom(from: Date, to: Date) {
  const lines = await prisma.journalLine.findMany({
    where: {
      account: { type: "REVENUE" },
      entry: { date: { gte: from, lte: to } },
    },
    include: { classroom: true },
  });
  const map = new Map<string, { name: string; cents: number }>();
  for (const l of lines) {
    const key = l.classroomId ?? "none";
    const row = map.get(key) ?? { name: l.classroom?.name ?? "Unassigned", cents: 0 };
    row.cents += l.creditCents - l.debitCents;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.cents - a.cents);
}

export function defaultRange(searchParams: { from?: string; to?: string }, parse: (s: string) => Date | null) {
  const now = new Date();
  const to = (searchParams.to && parse(searchParams.to)) || new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  const from =
    (searchParams.from && parse(searchParams.from)) ||
    new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  return { from, to: to < from ? addDays(from, 0) : to };
}
