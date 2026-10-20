// Billing runs: preview every invoice a period will generate, then post them
// in one transaction. Re-running a period only bills what's missing.

import type { Tx } from "@/lib/prisma";
import { formatDayISO } from "@/lib/dates";
import { buildFamilyCharges, periodFor, type DraftLine, type Frequency } from "./billing";
import { getCenter, systemAccounts } from "./posting";
import { createInvoice } from "./receivables";

export type DraftInvoice = {
  payerId: string;
  payerName: string;
  familyName: string | null;
  lines: DraftLine[];
  totalCents: number;
};

export type BillingPreview = {
  frequency: Frequency;
  periodStart: Date;
  periodEnd: Date;
  invoices: DraftInvoice[];
  totalCents: number;
  skippedAlreadyBilled: number;
  warnings: string[];
};

export async function previewBillingRun(
  tx: Tx,
  frequency: Frequency,
  anchor: Date,
): Promise<BillingPreview> {
  const period = periodFor(frequency, anchor);
  const center = await getCenter(tx);
  const accounts = await systemAccounts(tx);
  const warnings: string[] = [];

  const enrollments = await tx.enrollment.findMany({
    where: {
      feePlan: { frequency },
      startDate: { lte: period.end },
      OR: [{ endDate: null }, { endDate: { gte: period.start } }],
    },
    include: {
      feePlan: true,
      splits: true,
      child: { include: { family: { include: { payers: true, guardians: true } } } },
    },
  });

  const byFamily = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = byFamily.get(e.child.familyId) ?? [];
    list.push(e);
    byFamily.set(e.child.familyId, list);
  }

  const allLines: DraftLine[] = [];
  for (const [, list] of byFamily) {
    const family = list[0].child.family;
    const primaryGuardian = family.guardians.find((g) => g.isPrimary) ?? family.guardians[0];
    const defaultPayer =
      family.payers.find((p) => p.guardianId && p.guardianId === primaryGuardian?.id) ??
      family.payers.find((p) => p.kind === "GUARDIAN");
    if (!defaultPayer) {
      warnings.push(`${family.name} has enrollments but no guardian payer — skipped.`);
      continue;
    }
    allLines.push(
      ...buildFamilyCharges(
        list.map((e) => ({
          enrollmentId: e.id,
          childId: e.childId,
          childName: `${e.child.firstName} ${e.child.lastName}`,
          classroomId: e.feePlan.classroomId ?? e.child.classroomId,
          planName: e.feePlan.name,
          planAmountCents: e.feePlan.amountCents,
          frequency: e.feePlan.frequency,
          revenueAccountId: e.feePlan.revenueAccountId,
          startDate: e.startDate,
          endDate: e.endDate,
          discountBps: e.discountBps,
          discountReason: e.discountReason,
          splits: e.splits.map((s) => ({ payerId: s.payerId, kind: s.kind, value: s.value })),
          defaultPayerId: defaultPayer.id,
        })),
        anchor,
        { siblingDiscountBps: center.siblingDiscountBps, discountAccountId: accounts.DISCOUNTS },
      ),
    );
  }

  const existing = await tx.invoiceLine.findMany({
    where: { dedupeKey: { in: allLines.map((l) => l.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const billed = new Set(existing.map((e) => e.dedupeKey));
  const fresh = allLines.filter((l) => !billed.has(l.dedupeKey));

  const payers = await tx.payer.findMany({
    where: { id: { in: [...new Set(fresh.map((l) => l.payerId))] } },
    include: { family: true },
  });
  const payerById = new Map(payers.map((p) => [p.id, p]));

  const grouped = new Map<string, DraftInvoice>();
  for (const line of fresh) {
    const payer = payerById.get(line.payerId)!;
    const draft = grouped.get(line.payerId) ?? {
      payerId: line.payerId,
      payerName: payer.name,
      familyName: payer.family?.name ?? null,
      lines: [],
      totalCents: 0,
    };
    draft.lines.push(line);
    draft.totalCents += line.amountCents;
    grouped.set(line.payerId, draft);
  }
  const invoices = Array.from(grouped.values())
    .filter((d) => d.totalCents > 0)
    .sort((a, b) => a.payerName.localeCompare(b.payerName));

  return {
    frequency,
    periodStart: period.start,
    periodEnd: period.end,
    invoices,
    totalCents: invoices.reduce((a, d) => a + d.totalCents, 0),
    skippedAlreadyBilled: billed.size,
    warnings,
  };
}

export async function postBillingRun(
  tx: Tx,
  frequency: Frequency,
  anchor: Date,
  opts: { issueDate: Date; userId?: string | null },
) {
  const preview = await previewBillingRun(tx, frequency, anchor);
  if (preview.invoices.length === 0) return { run: null, preview };

  const run = await tx.billingRun.create({
    data: {
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      invoiceCount: preview.invoices.length,
      totalCents: preview.totalCents,
      createdById: opts.userId ?? null,
    },
  });
  for (const draft of preview.invoices) {
    await createInvoice(tx, {
      payerId: draft.payerId,
      issueDate: opts.issueDate,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      memo: `${frequency === "WEEKLY" ? "Weekly" : "Monthly"} tuition ${formatDayISO(preview.periodStart)} – ${formatDayISO(preview.periodEnd)}`,
      billingRunId: run.id,
      userId: opts.userId,
      lines: draft.lines,
    });
  }
  return { run, preview };
}
