import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFamilyCharges, processingFee, prorate, splitCharge, type EnrollmentInput } from "@/lib/accounting/billing";
import { monthPeriod, parseDay } from "@/lib/dates";

const d = (s: string) => parseDay(s)!;

test("prorate by weekdays", () => {
  const october = monthPeriod(d("2026-10-15")); // 22 weekdays
  assert.deepEqual(prorate(110000, october, { startDate: d("2026-09-01"), endDate: null }), {
    cents: 110000,
    enrolledDays: 22,
    periodDays: 22,
  });
  // Starts Mon Oct 19 → 10 weekdays of 22.
  assert.equal(prorate(110000, october, { startDate: d("2026-10-19"), endDate: null }).cents, 50000);
  assert.equal(prorate(110000, october, { startDate: d("2026-11-02"), endDate: null }).cents, 0);
  assert.equal(prorate(110000, october, { startDate: d("2026-01-01"), endDate: d("2026-09-30") }).cents, 0);
});

test("splitCharge: fixed subsidy first, percentages share the rest", () => {
  const shares = splitCharge(
    120000,
    [
      { payerId: "agency", kind: "FIXED", value: 60000 },
      { payerId: "mom", kind: "PERCENT", value: 5000 },
      { payerId: "dad", kind: "PERCENT", value: 5000 },
    ],
    "mom",
  );
  assert.deepEqual(shares, [
    { payerId: "agency", cents: 60000, fixed: true },
    { payerId: "mom", cents: 30000, fixed: false },
    { payerId: "dad", cents: 30000, fixed: false },
  ]);
});

test("splitCharge: odd cents and under-100% go to the default payer", () => {
  const shares = splitCharge(10001, [{ payerId: "dad", kind: "PERCENT", value: 3333 }], "mom");
  const total = shares.reduce((a, s) => a + s.cents, 0);
  assert.equal(total, 10001);
  assert.equal(shares.find((s) => s.payerId === "dad")!.cents, 3333);
  assert.equal(shares.find((s) => s.payerId === "mom")!.cents, 6668);
});

test("splitCharge: fixed amount is capped at the charge", () => {
  assert.deepEqual(splitCharge(5000, [{ payerId: "agency", kind: "FIXED", value: 9000 }], "mom"), [
    { payerId: "agency", cents: 5000, fixed: true },
  ]);
});

function enrollment(over: Partial<EnrollmentInput>): EnrollmentInput {
  return {
    enrollmentId: "e1",
    childId: "c1",
    childName: "Ava",
    classroomId: "room",
    planName: "Full-time",
    planAmountCents: 100000,
    frequency: "MONTHLY",
    revenueAccountId: "rev",
    startDate: d("2026-01-01"),
    endDate: null,
    discountBps: 0,
    discountReason: null,
    splits: [],
    defaultPayerId: "mom",
    ...over,
  };
}

test("sibling discount applies to all but the highest-tuition child, recorded as contra revenue", () => {
  const lines = buildFamilyCharges(
    [
      enrollment({ enrollmentId: "e1", childId: "c1", planAmountCents: 90000 }),
      enrollment({ enrollmentId: "e2", childId: "c2", childName: "Ben", planAmountCents: 120000 }),
    ],
    d("2026-10-01"),
    { siblingDiscountBps: 1000, discountAccountId: "disc" },
  );
  const discount = lines.filter((l) => l.accountId === "disc");
  assert.equal(discount.length, 1);
  assert.equal(discount[0].amountCents, -9000);
  assert.equal(discount[0].childId, "c1");
  assert.equal(lines.reduce((a, l) => a + l.amountCents, 0), 90000 + 120000 - 9000);
  assert.equal(new Set(lines.map((l) => l.dedupeKey)).size, lines.length);
});

test("agency is billed its authorised amount; discount benefits the family", () => {
  const lines = buildFamilyCharges(
    [
      enrollment({
        discountBps: 1000,
        discountReason: "Staff discount",
        splits: [{ payerId: "agency", kind: "FIXED", value: 60000 }],
      }),
    ],
    d("2026-10-01"),
    { siblingDiscountBps: 0, discountAccountId: "disc" },
  );
  const byPayer = (p: string) => lines.filter((l) => l.payerId === p).reduce((a, l) => a + l.amountCents, 0);
  assert.equal(byPayer("agency"), 60000);
  assert.equal(byPayer("mom"), 100000 - 10000 - 60000);
  assert.equal(lines.filter((l) => l.payerId === "agency" && l.amountCents < 0).length, 0);
  // Gross revenue across payers is the full plan amount.
  assert.equal(lines.filter((l) => l.accountId === "rev").reduce((a, l) => a + l.amountCents, 0), 100000);
});

test("processing fees", () => {
  const rates = { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 };
  assert.equal(processingFee("CARD", 100000, rates), 2930);
  assert.equal(processingFee("ACH", 100000, rates), 500);
  assert.equal(processingFee("ACH", 10000, rates), 80);
  assert.equal(processingFee("CHECK", 100000, rates), 0);
});
