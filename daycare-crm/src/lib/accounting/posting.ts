// The only code that writes to the general ledger. Every financial event
// (invoice, payment, credit, refund, deposit, manual entry) goes through
// postJournal so balancing, period locks and numbering are enforced in one
// place.

import type { Tx } from "@/lib/prisma";
import type { JournalSource } from "@/generated/prisma/client";
import { formatDayISO, toDay } from "@/lib/dates";
import { normaliseLines, type LineInput } from "./ledger";
import { SYSTEM_KEYS, type SystemKey } from "./accounts";

export class PeriodLockedError extends Error {}
export class AccountingError extends Error {}

export async function getCenter(tx: Tx) {
  const center = await tx.center.findUnique({ where: { id: "center" } });
  if (!center) throw new AccountingError("Center settings are missing — run the seed.");
  return center;
}

export async function systemAccounts(tx: Tx): Promise<Record<SystemKey, string>> {
  const rows = await tx.account.findMany({
    where: { systemKey: { in: [...SYSTEM_KEYS] } },
    select: { id: true, systemKey: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.systemKey, r.id])) as Record<SystemKey, string>;
  for (const key of SYSTEM_KEYS) {
    if (!map[key]) throw new AccountingError(`System account ${key} is missing from the chart.`);
  }
  return map;
}

export async function assertPeriodOpen(tx: Tx, date: Date) {
  const center = await getCenter(tx);
  if (center.lockDate && toDay(date) <= center.lockDate) {
    throw new PeriodLockedError(
      `The books are closed through ${formatDayISO(center.lockDate)}. Date the entry after the lock date or reopen the period.`,
    );
  }
}

export async function postJournal(
  tx: Tx,
  input: {
    date: Date;
    memo: string;
    source: JournalSource;
    sourceId?: string | null;
    lines: LineInput[];
    userId?: string | null;
    reversesId?: string | null;
  },
) {
  const lines = normaliseLines(input.lines);
  const date = toDay(input.date);
  await assertPeriodOpen(tx, date);

  const center = await tx.center.update({
    where: { id: "center" },
    data: { nextJournalNumber: { increment: 1 } },
  });

  return tx.journalEntry.create({
    data: {
      number: center.nextJournalNumber - 1,
      date,
      memo: input.memo,
      source: input.source,
      sourceId: input.sourceId ?? null,
      reversesId: input.reversesId ?? null,
      createdById: input.userId ?? null,
      lines: { create: lines },
    },
  });
}

/** Posts the mirror image of an entry. Original stays untouched for the audit trail. */
export async function reverseJournal(
  tx: Tx,
  entryId: string,
  opts: { date: Date; memo?: string; userId?: string | null },
) {
  const original = await tx.journalEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { lines: true, reversedBy: true },
  });
  if (original.reversedBy) {
    throw new AccountingError(`Journal #${original.number} has already been reversed.`);
  }
  return postJournal(tx, {
    date: opts.date,
    memo: opts.memo ?? `Reversal of #${original.number}: ${original.memo}`,
    source: "REVERSAL",
    sourceId: original.sourceId,
    reversesId: original.id,
    userId: opts.userId,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      payerId: l.payerId,
      classroomId: l.classroomId,
      memo: l.memo,
    })),
  });
}

export async function audit(
  tx: Tx,
  entry: { userId?: string | null; action: string; entity: string; entityId?: string | null; detail?: string },
) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
    },
  });
}
