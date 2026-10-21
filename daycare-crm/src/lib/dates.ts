// Calendar-day helpers. Business dates (invoice dates, periods, journal dates)
// are stored as midnight UTC of that calendar day so they never drift across
// time zones.

const DAY_MS = 86_400_000;

export function toDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Calendar day (server local time) that an instant falls on. */
export function dayOf(instant: Date): Date {
  return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()));
}

/** Today's calendar day in the server's local time zone. */
export function today(): Date {
  return dayOf(new Date());
}

export function formatTime(instant: Date | null | undefined): string {
  if (!instant) return "—";
  return instant.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDayISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDay(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDay(to).getTime() - toDay(from).getTime()) / DAY_MS);
}

export function monthPeriod(anyDay: Date): { start: Date; end: Date } {
  const y = anyDay.getUTCFullYear();
  const m = anyDay.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 0)),
  };
}

/** Monday–Sunday week containing `anyDay`. */
export function weekPeriod(anyDay: Date): { start: Date; end: Date } {
  const day = toDay(anyDay);
  const offset = (day.getUTCDay() + 6) % 7;
  const start = addDays(day, -offset);
  return { start, end: addDays(start, 6) };
}

/** Weekdays (Mon–Fri) in [start, end], inclusive. */
export function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  for (let d = toDay(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}
