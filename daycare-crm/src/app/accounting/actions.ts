"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { optStr, str, toActionError, type ActionState } from "@/lib/actions";
import { formatDay, parseDay, today } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";
import { audit, postJournal, reverseJournal } from "@/lib/accounting/posting";
import type { AccountType } from "@/generated/prisma/client";
import type { LineInput } from "@/lib/accounting/ledger";

const TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export async function manualJournalAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const date = parseDay(str(formData, "date"));
    const memo = str(formData, "memo");
    if (!date || !memo) return { error: "Date and memo are required." };
    const accountIds = formData.getAll("accountId").map(String);
    const debits = formData.getAll("debit").map(String);
    const credits = formData.getAll("credit").map(String);
    const lines: LineInput[] = [];
    for (let i = 0; i < accountIds.length; i++) {
      if (!accountIds[i]) continue;
      const debit = debits[i] ? parseMoneyToCents(debits[i]) : 0;
      const credit = credits[i] ? parseMoneyToCents(credits[i]) : 0;
      if (debit === null || credit === null) return { error: `Line ${i + 1} has an invalid amount.` };
      if (debit && credit) return { error: `Line ${i + 1} has both a debit and a credit.` };
      lines.push({ accountId: accountIds[i], debitCents: debit, creditCents: credit });
    }
    const entry = await prisma.$transaction(async (tx) => {
      const e = await postJournal(tx, { date, memo, source: "MANUAL", lines, userId: user.id });
      await audit(tx, { userId: user.id, action: "journal.manual", entity: "JournalEntry", entityId: e.id, detail: memo });
      return e;
    });
    revalidatePath("/accounting/journal");
    return { ok: `Posted journal #${entry.number}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reverseEntryAction(entryId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
    if (entry.source !== "MANUAL") {
      return { error: "Reverse invoices, payments and credits from their own screens so the sub-ledger stays in sync." };
    }
    const reversal = await prisma.$transaction(async (tx) => {
      const r = await reverseJournal(tx, entryId, { date: parseDay(str(formData, "date")) ?? today(), userId: user.id });
      await audit(tx, { userId: user.id, action: "journal.reversed", entity: "JournalEntry", entityId: entryId });
      return r;
    });
    revalidatePath("/accounting/journal");
    return { ok: `Reversed with #${reversal.number}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveAccountAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const code = str(formData, "code");
    const name = str(formData, "name");
    const type = str(formData, "type") as AccountType;
    if (!code || !name || !TYPES.includes(type)) return { error: "Code, name and type are required." };
    await prisma.account.create({ data: { code, name, type } });
    revalidatePath("/accounting/accounts");
    return { ok: `Added ${code} ${name}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleAccountAction(accountId: string) {
  await requireRole(FINANCE);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.systemKey) return;
  await prisma.account.update({ where: { id: accountId }, data: { active: !account.active } });
  revalidatePath("/accounting/accounts");
}

export async function lockPeriodAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(["ADMIN", "DIRECTOR", "BOOKKEEPER"]);
    const raw = str(formData, "lockDate");
    const lockDate = raw ? parseDay(raw) : null;
    if (raw && !lockDate) return { error: "Invalid date." };
    if (lockDate && lockDate >= today()) return { error: "You can only close periods that have ended." };
    await prisma.$transaction(async (tx) => {
      await tx.center.update({ where: { id: "center" }, data: { lockDate } });
      await audit(tx, {
        userId: user.id,
        action: lockDate ? "period.closed" : "period.reopened",
        entity: "Center",
        detail: lockDate ? `Closed through ${formatDay(lockDate)}` : "Lock date removed",
      });
    });
    revalidatePath("/accounting/settings");
    return { ok: lockDate ? `Books closed through ${formatDay(lockDate)}.` : "All periods reopened." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(["ADMIN", "DIRECTOR"]);
    const int = (key: string) => {
      const n = Number(str(formData, key));
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    };
    const pct = (key: string) => {
      const n = Number(str(formData, key));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
    };
    const cents = (key: string) => parseMoneyToCents(str(formData, key) || "0") ?? 0;
    await prisma.$transaction(async (tx) => {
      await tx.center.update({
        where: { id: "center" },
        data: {
          name: str(formData, "name") || "My Center",
          legalName: optStr(formData, "legalName"),
          ein: optStr(formData, "ein"),
          address: optStr(formData, "address"),
          phone: optStr(formData, "phone"),
          email: optStr(formData, "email"),
          invoiceDueDays: int("invoiceDueDays"),
          lateFeeCents: cents("lateFee"),
          lateFeeGraceDays: int("lateFeeGraceDays"),
          siblingDiscountBps: pct("siblingDiscountPct"),
          cardFeeBps: pct("cardFeePct"),
          cardFeeFixedCents: cents("cardFeeFixed"),
          achFeeBps: pct("achFeePct"),
          achFeeCapCents: cents("achFeeCap"),
        },
      });
      await audit(tx, { userId: user.id, action: "settings.updated", entity: "Center" });
    });
    revalidatePath("/accounting/settings");
    return { ok: "Settings saved." };
  } catch (e) {
    return toActionError(e);
  }
}
