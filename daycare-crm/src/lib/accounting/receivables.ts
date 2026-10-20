// Accounts-receivable operations: invoices, payments, credits, write-offs,
// refunds, deposits and late fees. Each function expects to run inside a
// prisma transaction so the sub-ledger and the general ledger never disagree.

import type { Tx } from "@/lib/prisma";
import type { AdjustmentKind, PaymentMethod } from "@/generated/prisma/client";
import { addDays, formatDayISO, toDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { processingFee } from "./billing";
import {
  AccountingError,
  audit,
  getCenter,
  postJournal,
  reverseJournal,
  systemAccounts,
} from "./posting";

export type NewInvoiceLine = {
  description: string;
  accountId: string;
  amountCents: number;
  childId?: string | null;
  enrollmentId?: string | null;
  classroomId?: string | null;
  dedupeKey?: string | null;
};

export async function createInvoice(
  tx: Tx,
  input: {
    payerId: string;
    issueDate: Date;
    dueDate?: Date;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    lines: NewInvoiceLine[];
    memo?: string | null;
    billingRunId?: string | null;
    lateFeeForId?: string | null;
    userId?: string | null;
  },
) {
  const total = input.lines.reduce((a, l) => a + l.amountCents, 0);
  if (input.lines.length === 0 || total <= 0) {
    throw new AccountingError("An invoice needs at least one line and a positive total.");
  }
  const center = await tx.center.update({
    where: { id: "center" },
    data: { nextInvoiceNumber: { increment: 1 } },
  });
  const accounts = await systemAccounts(tx);
  const issueDate = toDay(input.issueDate);
  const dueDate = toDay(input.dueDate ?? addDays(issueDate, center.invoiceDueDays));

  const invoice = await tx.invoice.create({
    data: {
      number: center.nextInvoiceNumber - 1,
      payerId: input.payerId,
      issueDate,
      dueDate,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      totalCents: total,
      memo: input.memo ?? null,
      billingRunId: input.billingRunId ?? null,
      lateFeeForId: input.lateFeeForId ?? null,
      lines: {
        create: input.lines.map((l) => ({
          description: l.description,
          accountId: l.accountId,
          amountCents: l.amountCents,
          childId: l.childId ?? null,
          enrollmentId: l.enrollmentId ?? null,
          classroomId: l.classroomId ?? null,
          dedupeKey: l.dedupeKey ?? null,
        })),
      },
    },
  });

  const entry = await postJournal(tx, {
    date: issueDate,
    memo: `Invoice #${invoice.number}`,
    source: "INVOICE",
    sourceId: invoice.id,
    userId: input.userId,
    lines: [
      { accountId: accounts.AR, debitCents: total, payerId: input.payerId },
      ...input.lines.map((l) => ({
        accountId: l.accountId,
        creditCents: l.amountCents,
        classroomId: l.classroomId ?? null,
        memo: l.description,
      })),
    ],
  });
  await tx.invoice.update({ where: { id: invoice.id }, data: { journalEntryId: entry.id } });
  await applyCredits(tx, input.payerId);
  return invoice;
}

async function invoiceBalances(tx: Tx, payerId: string) {
  const invoices = await tx.invoice.findMany({
    where: { payerId, status: "OPEN" },
    include: { allocations: true },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
  });
  return invoices.map((inv) => ({
    id: inv.id,
    balance: inv.totalCents - inv.allocations.reduce((a, x) => a + x.amountCents, 0),
  }));
}

export async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { allocations: true },
  });
  if (inv.status === "VOID") return;
  const paid = inv.allocations.reduce((a, x) => a + x.amountCents, 0);
  const status = paid >= inv.totalCents ? "PAID" : "OPEN";
  if (status !== inv.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
}

/** Unapplied money a payer has on account (payments and credits not yet matched). */
export async function availableCredits(tx: Tx, payerId: string) {
  const [payments, adjustments] = await Promise.all([
    tx.payment.findMany({
      where: { payerId },
      include: { allocations: true, refunds: true },
      orderBy: { receivedAt: "asc" },
    }),
    tx.adjustment.findMany({
      where: { payerId },
      include: { allocations: true },
      orderBy: { date: "asc" },
    }),
  ]);
  const sum = (xs: { amountCents: number }[]) => xs.reduce((a, x) => a + x.amountCents, 0);
  return [
    ...payments.map((p) => ({
      kind: "payment" as const,
      id: p.id,
      date: p.receivedAt,
      unapplied: p.amountCents - sum(p.allocations) - sum(p.refunds),
    })),
    ...adjustments.map((a) => ({
      kind: "adjustment" as const,
      id: a.id,
      date: a.date,
      unapplied: a.amountCents - sum(a.allocations),
    })),
  ]
    .filter((c) => c.unapplied > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Matches unapplied payments/credits against the oldest open invoices. */
export async function applyCredits(tx: Tx, payerId: string) {
  const credits = await availableCredits(tx, payerId);
  if (credits.length === 0) return;
  const invoices = (await invoiceBalances(tx, payerId)).filter((i) => i.balance > 0);
  const touched = new Set<string>();
  for (const credit of credits) {
    for (const inv of invoices) {
      if (credit.unapplied === 0) break;
      if (inv.balance === 0) continue;
      const amount = Math.min(credit.unapplied, inv.balance);
      await tx.allocation.create({
        data: {
          invoiceId: inv.id,
          paymentId: credit.kind === "payment" ? credit.id : null,
          adjustmentId: credit.kind === "adjustment" ? credit.id : null,
          amountCents: amount,
        },
      });
      credit.unapplied -= amount;
      inv.balance -= amount;
      touched.add(inv.id);
    }
  }
  for (const id of touched) await refreshInvoiceStatus(tx, id);
}

export async function recordPayment(
  tx: Tx,
  input: {
    payerId: string;
    amountCents: number;
    method: PaymentMethod;
    receivedAt: Date;
    reference?: string | null;
    memo?: string | null;
    // Overrides the computed processor fee (e.g. from the processor's payout report).
    feeCents?: number | null;
    userId?: string | null;
  },
) {
  if (input.amountCents <= 0) throw new AccountingError("Payment amount must be positive.");
  const center = await getCenter(tx);
  const accounts = await systemAccounts(tx);
  const fee = input.feeCents ?? processingFee(input.method, input.amountCents, center);
  if (fee < 0 || fee >= input.amountCents) {
    throw new AccountingError("Processing fee must be less than the payment amount.");
  }

  const payment = await tx.payment.create({
    data: {
      payerId: input.payerId,
      amountCents: input.amountCents,
      method: input.method,
      receivedAt: toDay(input.receivedAt),
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      feeCents: fee,
    },
  });
  const entry = await postJournal(tx, {
    date: input.receivedAt,
    memo: `Payment ${input.method.toLowerCase()}${input.reference ? ` ${input.reference}` : ""}`,
    source: "PAYMENT",
    sourceId: payment.id,
    userId: input.userId,
    lines: [
      { accountId: accounts.UNDEPOSITED_FUNDS, debitCents: input.amountCents - fee },
      { accountId: accounts.MERCHANT_FEES, debitCents: fee, memo: "Processing fee" },
      { accountId: accounts.AR, creditCents: input.amountCents, payerId: input.payerId },
    ],
  });
  await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
  await applyCredits(tx, input.payerId);
  await audit(tx, {
    userId: input.userId,
    action: "payment.recorded",
    entity: "Payment",
    entityId: payment.id,
    detail: `${formatCents(input.amountCents)} via ${input.method}`,
  });
  return payment;
}

export async function createAdjustment(
  tx: Tx,
  input: {
    payerId: string;
    kind: AdjustmentKind;
    amountCents: number;
    reason: string;
    date: Date;
    // Credits default to the discounts account; write-offs to bad debt.
    accountId?: string | null;
    invoiceId?: string | null;
    userId?: string | null;
  },
) {
  if (input.amountCents <= 0) throw new AccountingError("Amount must be positive.");
  if (!input.reason.trim()) throw new AccountingError("A reason is required for the audit trail.");
  const accounts = await systemAccounts(tx);
  const accountId =
    input.accountId || (input.kind === "WRITE_OFF" ? accounts.BAD_DEBT : accounts.DISCOUNTS);

  const adjustment = await tx.adjustment.create({
    data: {
      payerId: input.payerId,
      kind: input.kind,
      amountCents: input.amountCents,
      reason: input.reason,
      date: toDay(input.date),
      accountId,
    },
  });
  const entry = await postJournal(tx, {
    date: input.date,
    memo: `${input.kind === "WRITE_OFF" ? "Write-off" : "Credit"}: ${input.reason}`,
    source: "ADJUSTMENT",
    sourceId: adjustment.id,
    userId: input.userId,
    lines: [
      { accountId, debitCents: input.amountCents },
      { accountId: accounts.AR, creditCents: input.amountCents, payerId: input.payerId },
    ],
  });
  await tx.adjustment.update({ where: { id: adjustment.id }, data: { journalEntryId: entry.id } });

  if (input.invoiceId) {
    const target = (await invoiceBalances(tx, input.payerId)).find((i) => i.id === input.invoiceId);
    if (target && target.balance > 0) {
      await tx.allocation.create({
        data: {
          invoiceId: target.id,
          adjustmentId: adjustment.id,
          amountCents: Math.min(target.balance, input.amountCents),
        },
      });
      await refreshInvoiceStatus(tx, target.id);
    }
  }
  await applyCredits(tx, input.payerId);
  await audit(tx, {
    userId: input.userId,
    action: `adjustment.${input.kind.toLowerCase()}`,
    entity: "Adjustment",
    entityId: adjustment.id,
    detail: `${formatCents(input.amountCents)} — ${input.reason}`,
  });
  return adjustment;
}

/** Refunds the unapplied part of a payment (overpayments, withdrawals). */
export async function refundPayment(
  tx: Tx,
  input: { paymentId: string; amountCents: number; reason: string; date: Date; userId?: string | null },
) {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: input.paymentId },
    include: { allocations: true, refunds: true },
  });
  const unapplied =
    payment.amountCents -
    payment.allocations.reduce((a, x) => a + x.amountCents, 0) -
    payment.refunds.reduce((a, x) => a + x.amountCents, 0);
  if (input.amountCents <= 0 || input.amountCents > unapplied) {
    throw new AccountingError(
      `Only ${formatCents(unapplied)} of this payment is unapplied and refundable. Unapply it from invoices (credit or void) first.`,
    );
  }
  const accounts = await systemAccounts(tx);
  const refund = await tx.refund.create({
    data: {
      paymentId: payment.id,
      amountCents: input.amountCents,
      reason: input.reason,
      date: toDay(input.date),
    },
  });
  const entry = await postJournal(tx, {
    date: input.date,
    memo: `Refund: ${input.reason}`,
    source: "REFUND",
    sourceId: refund.id,
    userId: input.userId,
    lines: [
      { accountId: accounts.AR, debitCents: input.amountCents, payerId: payment.payerId },
      {
        accountId: payment.depositId ? accounts.OPERATING_BANK : accounts.UNDEPOSITED_FUNDS,
        creditCents: input.amountCents,
      },
    ],
  });
  await tx.refund.update({ where: { id: refund.id }, data: { journalEntryId: entry.id } });
  await audit(tx, {
    userId: input.userId,
    action: "payment.refunded",
    entity: "Payment",
    entityId: payment.id,
    detail: `${formatCents(input.amountCents)} — ${input.reason}`,
  });
  return refund;
}

export async function voidInvoice(
  tx: Tx,
  input: { invoiceId: string; reason: string; date: Date; userId?: string | null },
) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: { allocations: true },
  });
  if (invoice.status === "VOID") throw new AccountingError("Invoice is already void.");
  if (invoice.allocations.length > 0) {
    throw new AccountingError(
      "This invoice has payments or credits applied. Issue a credit instead, or refund the payment first.",
    );
  }
  if (invoice.journalEntryId) {
    await reverseJournal(tx, invoice.journalEntryId, {
      date: input.date,
      memo: `Void invoice #${invoice.number}: ${input.reason}`,
      userId: input.userId,
    });
  }
  // Release dedupe keys so the charge can be re-billed correctly.
  await tx.invoiceLine.updateMany({
    where: { invoiceId: invoice.id },
    data: { dedupeKey: null },
  });
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
  await audit(tx, {
    userId: input.userId,
    action: "invoice.voided",
    entity: "Invoice",
    entityId: invoice.id,
    detail: input.reason,
  });
}

/** Undeposited payments with the net amount each will contribute to a payout. */
export async function undepositedPayments(tx: Tx) {
  const payments = await tx.payment.findMany({
    where: { depositId: null },
    include: { payer: true, refunds: true },
    orderBy: { receivedAt: "asc" },
  });
  return payments.map((p) => ({
    ...p,
    netCents: p.amountCents - p.feeCents - p.refunds.reduce((a, r) => a + r.amountCents, 0),
  }));
}

export async function createDeposit(
  tx: Tx,
  input: { paymentIds: string[]; date: Date; reference?: string | null; userId?: string | null },
) {
  if (input.paymentIds.length === 0) throw new AccountingError("Select at least one payment.");
  const accounts = await systemAccounts(tx);
  const pending = (await undepositedPayments(tx)).filter((p) => input.paymentIds.includes(p.id));
  if (pending.length !== input.paymentIds.length) {
    throw new AccountingError("Some selected payments were already deposited.");
  }
  const amount = pending.reduce((a, p) => a + p.netCents, 0);
  if (amount <= 0) throw new AccountingError("Deposit total must be positive.");

  const deposit = await tx.deposit.create({
    data: {
      date: toDay(input.date),
      bankAccountId: accounts.OPERATING_BANK,
      amountCents: amount,
      reference: input.reference ?? null,
    },
  });
  await tx.payment.updateMany({
    where: { id: { in: input.paymentIds } },
    data: { depositId: deposit.id },
  });
  const entry = await postJournal(tx, {
    date: input.date,
    memo: `Deposit${input.reference ? ` ${input.reference}` : ""} (${pending.length} payments)`,
    source: "DEPOSIT",
    sourceId: deposit.id,
    userId: input.userId,
    lines: [
      { accountId: accounts.OPERATING_BANK, debitCents: amount },
      { accountId: accounts.UNDEPOSITED_FUNDS, creditCents: amount },
    ],
  });
  await tx.deposit.update({ where: { id: deposit.id }, data: { journalEntryId: entry.id } });
  return deposit;
}

/** Charges the center's late fee once per overdue invoice. Safe to run daily. */
export async function applyLateFees(tx: Tx, asOf: Date, userId?: string | null) {
  const center = await getCenter(tx);
  if (center.lateFeeCents <= 0) return [];
  const accounts = await systemAccounts(tx);
  const cutoff = addDays(toDay(asOf), -center.lateFeeGraceDays);
  const overdue = await tx.invoice.findMany({
    where: { status: "OPEN", lateFeeForId: null, dueDate: { lt: cutoff } },
    include: { allocations: true },
  });
  const created = [];
  for (const inv of overdue) {
    const balance = inv.totalCents - inv.allocations.reduce((a, x) => a + x.amountCents, 0);
    if (balance <= 0) continue;
    const dedupeKey = `latefee:${inv.id}`;
    if (await tx.invoiceLine.findUnique({ where: { dedupeKey } })) continue;
    created.push(
      await createInvoice(tx, {
        payerId: inv.payerId,
        issueDate: asOf,
        dueDate: asOf,
        lateFeeForId: inv.id,
        memo: `Late fee for invoice #${inv.number}`,
        userId,
        lines: [
          {
            description: `Late fee – invoice #${inv.number} due ${formatDayISO(inv.dueDate)}`,
            accountId: accounts.LATE_FEES,
            amountCents: center.lateFeeCents,
            dedupeKey,
          },
        ],
      }),
    );
  }
  return created;
}

/** Payer A/R balance straight from the general ledger (positive = owes). */
export async function payerLedgerBalance(tx: Tx, payerId: string) {
  const accounts = await systemAccounts(tx);
  const agg = await tx.journalLine.aggregate({
    where: { payerId, accountId: accounts.AR },
    _sum: { debitCents: true, creditCents: true },
  });
  return (agg._sum.debitCents ?? 0) - (agg._sum.creditCents ?? 0);
}
