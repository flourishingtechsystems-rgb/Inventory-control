// Pure tuition-billing calculations: proration, discounts and split billing.
// No database access here so every rule is unit-testable.

import { allocateByWeights, applyBps, roundDiv } from "@/lib/money";
import {
  countWeekdays,
  formatDayISO,
  maxDate,
  minDate,
  monthPeriod,
  weekPeriod,
} from "@/lib/dates";

export type Frequency = "WEEKLY" | "MONTHLY";

export function periodFor(frequency: Frequency, anyDay: Date) {
  return frequency === "WEEKLY" ? weekPeriod(anyDay) : monthPeriod(anyDay);
}

/**
 * Prorates a period charge by enrolled weekdays. Returns the full amount when
 * the enrollment covers the whole period and 0 when it doesn't overlap.
 */
export function prorate(
  amountCents: number,
  period: { start: Date; end: Date },
  enrollment: { startDate: Date; endDate: Date | null },
): { cents: number; enrolledDays: number; periodDays: number } {
  const periodDays = countWeekdays(period.start, period.end);
  const from = maxDate(period.start, enrollment.startDate);
  const to = enrollment.endDate ? minDate(period.end, enrollment.endDate) : period.end;
  if (to < from || periodDays === 0) {
    return { cents: 0, enrolledDays: 0, periodDays };
  }
  const enrolledDays = countWeekdays(from, to);
  const cents =
    enrolledDays >= periodDays
      ? amountCents
      : roundDiv(amountCents * enrolledDays, periodDays);
  return { cents, enrolledDays, periodDays };
}

export type Split = { payerId: string; kind: "PERCENT" | "FIXED"; value: number };

/**
 * Divides a net charge between payers. FIXED splits (e.g. a subsidy agency's
 * authorised amount) are taken first, capped at what is left; PERCENT splits
 * share the remainder. Anything still unassigned — no splits, or percentages
 * under 100% — goes to the default payer. Shares always sum to `netCents`.
 */
export function splitCharge(
  netCents: number,
  splits: Split[],
  defaultPayerId: string,
): { payerId: string; cents: number; fixed: boolean }[] {
  const shares = new Map<string, { cents: number; fixed: boolean }>();
  const add = (payerId: string, cents: number, fixed: boolean) => {
    const existing = shares.get(payerId);
    if (existing) existing.cents += cents;
    else shares.set(payerId, { cents, fixed });
  };

  let remaining = netCents;
  for (const split of splits.filter((s) => s.kind === "FIXED")) {
    const cents = Math.max(0, Math.min(split.value, remaining));
    add(split.payerId, cents, true);
    remaining -= cents;
  }

  const percentSplits = splits.filter((s) => s.kind === "PERCENT");
  const percentTotal = percentSplits.reduce((a, s) => a + s.value, 0);
  if (percentSplits.length > 0 && remaining > 0) {
    const weights = percentSplits.map((s) => s.value);
    const unassignedBps = Math.max(0, 10_000 - percentTotal);
    const parts = allocateByWeights(remaining, [...weights, unassignedBps]);
    percentSplits.forEach((s, i) => add(s.payerId, parts[i], false));
    if (parts[parts.length - 1] > 0) add(defaultPayerId, parts[parts.length - 1], false);
  } else if (remaining > 0) {
    add(defaultPayerId, remaining, false);
  }

  return Array.from(shares, ([payerId, v]) => ({ payerId, ...v }));
}

export type EnrollmentInput = {
  enrollmentId: string;
  childId: string;
  childName: string;
  classroomId: string | null;
  planName: string;
  planAmountCents: number;
  frequency: Frequency;
  revenueAccountId: string;
  startDate: Date;
  endDate: Date | null;
  discountBps: number;
  discountReason: string | null;
  splits: Split[];
  defaultPayerId: string;
};

export type DraftLine = {
  payerId: string;
  description: string;
  accountId: string;
  amountCents: number;
  childId: string;
  enrollmentId: string;
  classroomId: string | null;
  dedupeKey: string;
};

/**
 * Builds the invoice lines for one family's enrollments in a billing period.
 *
 * Revenue is recorded gross with discounts on a contra-revenue account, so the
 * P&L shows true tuition and the true cost of discounts. FIXED payers
 * (agencies) are billed exactly their authorised amount; discounts benefit the
 * family-side payers.
 */
export function buildFamilyCharges(
  enrollments: EnrollmentInput[],
  periodAnchor: Date,
  opts: { siblingDiscountBps: number; discountAccountId: string },
): DraftLine[] {
  const priced = enrollments
    .map((e) => {
      const period = periodFor(e.frequency, periodAnchor);
      const p = prorate(e.planAmountCents, period, e);
      return { e, period, ...p };
    })
    .filter((x) => x.cents > 0)
    // Sibling discount applies to every child except the highest-tuition one.
    .sort((a, b) => b.cents - a.cents || a.e.childId.localeCompare(b.e.childId));

  const lines: DraftLine[] = [];
  priced.forEach(({ e, period, cents, enrolledDays, periodDays }, index) => {
    const periodKey = formatDayISO(period.start);
    const discounts: { label: string; cents: number }[] = [];
    if (index > 0 && opts.siblingDiscountBps > 0) {
      discounts.push({
        label: "Sibling discount",
        cents: applyBps(cents, opts.siblingDiscountBps),
      });
    }
    if (e.discountBps > 0) {
      discounts.push({
        label: e.discountReason || "Discount",
        cents: applyBps(cents, e.discountBps),
      });
    }
    const discountTotal = discounts.reduce((a, d) => a + d.cents, 0);
    const net = Math.max(0, cents - discountTotal);
    const shares = splitCharge(net, e.splits, e.defaultPayerId);

    // Spread each discount across the non-fixed payers by their share.
    const discountWeights = shares.map((s) => (s.fixed ? 0 : s.cents));
    const fallback = discountWeights.every((w) => w === 0);
    const discountParts = discounts.map((d) =>
      allocateByWeights(
        d.cents,
        fallback ? shares.map((s) => s.cents || 1) : discountWeights,
      ),
    );

    const prorationNote =
      enrolledDays < periodDays ? ` (prorated ${enrolledDays}/${periodDays} days)` : "";
    const periodLabel =
      e.frequency === "WEEKLY"
        ? `week of ${formatDayISO(period.start)}`
        : formatDayISO(period.start).slice(0, 7);

    shares.forEach((share, i) => {
      const discountForPayer = discountParts.reduce((a, parts) => a + parts[i], 0);
      const gross = share.cents + discountForPayer;
      if (gross === 0) return;
      const splitNote = shares.length > 1 ? " — your share" : "";
      lines.push({
        payerId: share.payerId,
        description: `${e.planName} – ${e.childName}, ${periodLabel}${prorationNote}${splitNote}`,
        accountId: e.revenueAccountId,
        amountCents: gross,
        childId: e.childId,
        enrollmentId: e.enrollmentId,
        classroomId: e.classroomId,
        dedupeKey: `tuition:${e.enrollmentId}:${share.payerId}:${periodKey}`,
      });
      discounts.forEach((d, di) => {
        const amount = discountParts[di][i];
        if (amount === 0) return;
        lines.push({
          payerId: share.payerId,
          description: `${d.label} – ${e.childName}`,
          accountId: opts.discountAccountId,
          amountCents: -amount,
          childId: e.childId,
          enrollmentId: e.enrollmentId,
          classroomId: e.classroomId,
          dedupeKey: `discount${di}:${e.enrollmentId}:${share.payerId}:${periodKey}`,
        });
      });
    });
  });
  return lines;
}

/** Card/ACH processing fee for a payment, per the center's processor rates. */
export function processingFee(
  method: string,
  amountCents: number,
  rates: {
    cardFeeBps: number;
    cardFeeFixedCents: number;
    achFeeBps: number;
    achFeeCapCents: number;
  },
): number {
  if (amountCents <= 0) return 0;
  if (method === "CARD") {
    return applyBps(amountCents, rates.cardFeeBps) + rates.cardFeeFixedCents;
  }
  if (method === "ACH") {
    return Math.min(applyBps(amountCents, rates.achFeeBps), rates.achFeeCapCents);
  }
  return 0;
}
