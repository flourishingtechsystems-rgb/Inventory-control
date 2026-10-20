// Money helpers. Everything is integer cents; never do arithmetic on floats.

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Parses "1,234.5", "$12", "-3.07" into cents without going through a float. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  const match = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const whole = Number(match[2] || "0");
  const frac = Number((match[3] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + frac;
  return match[1] ? -cents : cents;
}

/** Cents → "1234.56" (no symbol, no grouping) for external APIs and exports. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Rounds half away from zero. */
export function roundDiv(numerator: number, denominator: number): number {
  const q = Math.abs(numerator) / Math.abs(denominator);
  const rounded = Math.floor(q + 0.5);
  return Math.sign(numerator) * Math.sign(denominator) * rounded;
}

export function applyBps(cents: number, bps: number): number {
  return roundDiv(cents * bps, 10_000);
}

/**
 * Splits `total` across `weights` so the parts sum to exactly `total`
 * (largest-remainder method). Zero/negative weights get nothing; if every
 * weight is zero the whole amount goes to the first slot.
 */
export function allocateByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const positive = weights.map((w) => (w > 0 ? w : 0));
  const weightSum = positive.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    return weights.map((_, i) => (i === 0 ? total : 0));
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = positive.map((w) => (abs * w) / weightSum);
  const parts = raw.map(Math.floor);
  let remainder = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (positive[i] === 0) continue;
    parts[i] += 1;
    remainder -= 1;
  }
  return parts.map((p) => p * sign);
}
