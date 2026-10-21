"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { optStr, str, toActionError, type ActionState } from "@/lib/actions";
import { parseDay, today } from "@/lib/dates";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { systemAccounts } from "@/lib/accounting/posting";
import {
  applyLateFees,
  createAdjustment,
  createDeposit,
  createInvoice,
  recordPayment,
  refundPayment,
  voidInvoice,
} from "@/lib/accounting/receivables";
import { postBillingRun } from "@/lib/accounting/billing-run";
import type { PaymentMethod } from "@/generated/prisma/client";

const METHODS: PaymentMethod[] = ["CARD", "ACH", "CASH", "CHECK", "SUBSIDY"];

function refreshBilling(extra?: string) {
  for (const p of ["/billing", "/billing/payments", "/billing/deposits", "/dashboard", "/accounting"]) revalidatePath(p);
  if (extra) revalidatePath(extra);
}

function money(formData: FormData, key: string) {
  const cents = parseMoneyToCents(str(formData, key));
  return cents && cents > 0 ? cents : null;
}

export async function recordPaymentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const amountCents = money(formData, "amount");
    const method = str(formData, "method") as PaymentMethod;
    const payerId = str(formData, "payerId");
    if (!payerId || !amountCents || !METHODS.includes(method)) return { error: "Payer, amount and method are required." };
    const feeRaw = str(formData, "fee");
    const feeCents = feeRaw ? parseMoneyToCents(feeRaw) : null;
    await prisma.$transaction((tx) =>
      recordPayment(tx, {
        payerId,
        amountCents,
        method,
        receivedAt: parseDay(str(formData, "receivedAt")) ?? today(),
        reference: optStr(formData, "reference"),
        memo: optStr(formData, "memo"),
        feeCents,
        userId: user.id,
      }),
    );
    refreshBilling(optStr(formData, "returnPath") ?? undefined);
    return { ok: `Recorded ${formatCents(amountCents)} and applied it to the oldest open invoices.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function chargeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const amountCents = money(formData, "amount");
    const payerId = str(formData, "payerId");
    const description = str(formData, "description");
    const accountId = str(formData, "accountId");
    if (!payerId || !amountCents || !description || !accountId) return { error: "All fields are required." };
    const invoice = await prisma.$transaction((tx) =>
      createInvoice(tx, {
        payerId,
        issueDate: parseDay(str(formData, "issueDate")) ?? today(),
        dueDate: parseDay(str(formData, "dueDate")) ?? undefined,
        lines: [{ description, accountId, amountCents, childId: optStr(formData, "childId") }],
        userId: user.id,
      }),
    );
    refreshBilling(optStr(formData, "returnPath") ?? undefined);
    return { ok: `Invoice #${invoice.number} created.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function adjustmentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const amountCents = money(formData, "amount");
    const payerId = str(formData, "payerId");
    const kind = str(formData, "kind") === "WRITE_OFF" ? "WRITE_OFF" : "CREDIT";
    if (!payerId || !amountCents) return { error: "Payer and amount are required." };
    await prisma.$transaction((tx) =>
      createAdjustment(tx, {
        payerId,
        kind,
        amountCents,
        reason: str(formData, "reason"),
        date: parseDay(str(formData, "date")) ?? today(),
        accountId: optStr(formData, "accountId"),
        invoiceId: optStr(formData, "invoiceId"),
        userId: user.id,
      }),
    );
    refreshBilling(optStr(formData, "returnPath") ?? undefined);
    return { ok: `${kind === "WRITE_OFF" ? "Write-off" : "Credit"} of ${formatCents(amountCents)} posted.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidInvoiceAction(invoiceId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const reason = str(formData, "reason");
    if (!reason) return { error: "A reason is required." };
    await prisma.$transaction((tx) => voidInvoice(tx, { invoiceId, reason, date: today(), userId: user.id }));
    refreshBilling(`/billing/invoices/${invoiceId}`);
    return { ok: "Invoice voided with a reversing entry." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function refundAction(paymentId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const amountCents = money(formData, "amount");
    if (!amountCents) return { error: "Enter an amount." };
    await prisma.$transaction((tx) =>
      refundPayment(tx, { paymentId, amountCents, reason: str(formData, "reason") || "Refund", date: today(), userId: user.id }),
    );
    refreshBilling();
    return { ok: `Refunded ${formatCents(amountCents)}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function depositAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let depositId: string;
  try {
    const user = await requireRole(FINANCE);
    const paymentIds = formData.getAll("paymentId").filter((v): v is string => typeof v === "string");
    const deposit = await prisma.$transaction((tx) =>
      createDeposit(tx, {
        paymentIds,
        date: parseDay(str(formData, "date")) ?? today(),
        reference: optStr(formData, "reference"),
        userId: user.id,
      }),
    );
    refreshBilling();
    depositId = deposit.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/billing/deposits?recorded=${depositId}`);
}

export async function billingRunAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let runId: string;
  try {
    const user = await requireRole(FINANCE);
    const frequency = str(formData, "frequency") === "WEEKLY" ? "WEEKLY" : "MONTHLY";
    const anchor = parseDay(str(formData, "anchor"));
    if (!anchor) return { error: "Pick a period." };
    const { run } = await prisma.$transaction(
      (tx) => postBillingRun(tx, frequency, anchor, { issueDate: parseDay(str(formData, "issueDate")) ?? today(), userId: user.id }),
      { timeout: 60_000 },
    );
    refreshBilling("/billing/run");
    if (!run) return { error: "Nothing to bill — every enrollment in this period is already invoiced." };
    runId = run.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/billing/run?frequency=${str(formData, "frequency")}&anchor=${str(formData, "anchor")}&posted=${runId}`);
}

export async function lateFeesAction(): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const created = await prisma.$transaction((tx) => applyLateFees(tx, today(), user.id));
    refreshBilling();
    return { ok: created.length ? `Charged ${created.length} late fees.` : "No invoices are past the grace period." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function savePlanAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const amountCents = money(formData, "amount");
    const name = str(formData, "name");
    if (!name || !amountCents) return { error: "Name and rate are required." };
    const accounts = await systemAccounts(prisma);
    const data = {
      name,
      amountCents,
      frequency: str(formData, "frequency") === "WEEKLY" ? ("WEEKLY" as const) : ("MONTHLY" as const),
      revenueAccountId: optStr(formData, "revenueAccountId") ?? accounts.TUITION,
      classroomId: optStr(formData, "classroomId"),
    };
    const id = optStr(formData, "id");
    if (id) await prisma.feePlan.update({ where: { id }, data });
    else await prisma.feePlan.create({ data });
    revalidatePath("/billing/plans");
    return { ok: id ? "Plan updated (applies to future billing runs)." : "Plan created." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createAgencyPayerAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const name = str(formData, "name");
    if (!name) return { error: "Name is required." };
    await prisma.payer.create({
      data: { name, kind: str(formData, "kind") === "EMPLOYER" ? "EMPLOYER" : "AGENCY", email: optStr(formData, "email") },
    });
    revalidatePath("/billing");
    return { ok: `${name} can now be used in billing splits.` };
  } catch (e) {
    return toActionError(e);
  }
}
