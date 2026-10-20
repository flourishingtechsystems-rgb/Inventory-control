// Sync engine: pushes the Nestwise general ledger to QuickBooks Online / Xero.
//
// The ledger is the source of truth and posted entries are immutable, so sync
// is append-only: each journal entry is pushed exactly once (tracked in
// ExternalRef), corrections arrive as reversing entries, and backdated entries
// land in their own journal rather than rewriting an already-synced day.

import { prisma } from "@/lib/prisma";
import type { Integration, Provider } from "@/generated/prisma/client";
import { formatDayISO, today } from "@/lib/dates";
import { decrypt, encrypt } from "./crypto";
import { QuickBooksClient, XeroClient, type AccountingClient } from "./clients";
import {
  MappingError,
  batchReference,
  buildDetailedJournal,
  buildSummaryJournal,
  unmappedAccounts,
  type Mappings,
  type SyncEntry,
} from "./mappers";
import { refreshTokens } from "./oauth";

export const ENTITY = {
  ACCOUNT: "ACCOUNT",
  CLASS: "CLASS",
  CUSTOMER: "CUSTOMER",
  JOURNAL_ENTRY: "JOURNAL_ENTRY",
} as const;

export async function clientFor(integration: Integration): Promise<AccountingClient> {
  if (!integration.accessTokenEnc || !integration.refreshTokenEnc || !integration.tenantId) {
    throw new Error("Not connected.");
  }
  let accessToken = decrypt(integration.accessTokenEnc);
  // Refresh a few minutes early so long syncs don't expire mid-run.
  if (!integration.expiresAt || integration.expiresAt.getTime() < Date.now() + 5 * 60_000) {
    const tokens = await refreshTokens(integration.provider, decrypt(integration.refreshTokenEnc));
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessTokenEnc: encrypt(tokens.accessToken),
        refreshTokenEnc: encrypt(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      },
    });
    accessToken = tokens.accessToken;
  }
  return integration.provider === "QUICKBOOKS"
    ? new QuickBooksClient(accessToken, integration.tenantId)
    : new XeroClient(accessToken, integration.tenantId);
}

async function loadMappings(provider: Provider): Promise<Mappings> {
  const [refs, accounts, payers] = await Promise.all([
    prisma.externalRef.findMany({
      where: { provider, entityType: { in: [ENTITY.ACCOUNT, ENTITY.CLASS, ENTITY.CUSTOMER] } },
    }),
    prisma.account.findMany({ select: { id: true, code: true, name: true } }),
    prisma.payer.findMany({ select: { id: true, name: true } }),
  ]);
  const of = (type: string) => new Map(refs.filter((r) => r.entityType === type).map((r) => [r.localId, r.remoteId]));
  return {
    accounts: of(ENTITY.ACCOUNT),
    classes: of(ENTITY.CLASS),
    customers: of(ENTITY.CUSTOMER),
    accountNames: new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`])),
    payerNames: new Map(payers.map((p) => [p.id, p.name])),
  };
}

/** Journal entries not yet pushed to `provider`, oldest first. */
export async function pendingEntries(integration: Integration, opts: { includeToday: boolean }) {
  const synced = await prisma.externalRef.findMany({
    where: { provider: integration.provider, entityType: ENTITY.JOURNAL_ENTRY },
    select: { localId: true },
  });
  const done = new Set(synced.map((s) => s.localId));
  const entries = await prisma.journalEntry.findMany({
    where: {
      date: {
        ...(integration.syncFrom ? { gte: integration.syncFrom } : {}),
        ...(opts.includeToday ? {} : { lt: today() }),
      },
    },
    include: { lines: true },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  return entries
    .filter((e) => !done.has(e.id))
    .map<SyncEntry>((e) => ({
      id: e.id,
      number: e.number,
      date: e.date,
      memo: e.memo,
      lines: e.lines.map((l) => ({
        accountId: l.accountId,
        classroomId: l.classroomId,
        payerId: l.payerId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        memo: l.memo,
      })),
    }));
}

async function log(provider: Provider, entityType: string, localId: string | null, status: string, message: string) {
  await prisma.syncLog.create({ data: { provider, entityType, localId, status, message } });
}

export type SyncResult = { pushed: number; journals: number; errors: string[] };

export async function syncProvider(provider: Provider): Promise<SyncResult> {
  const integration = await prisma.integration.findUnique({ where: { provider } });
  if (!integration?.accessTokenEnc) return { pushed: 0, journals: 0, errors: ["Not connected."] };

  const result: SyncResult = { pushed: 0, journals: 0, errors: [] };
  try {
    const client = await clientFor(integration);
    const mappings = await loadMappings(provider);
    // Summary mode waits for the day to close so each day is one journal.
    const entries = await pendingEntries(integration, { includeToday: integration.syncMode === "DETAILED" });
    if (entries.length === 0) {
      await log(provider, "SYNC", null, "SUCCESS", "Nothing new to sync.");
    } else {
      const missing = unmappedAccounts(entries, mappings);
      if (missing.length) throw new MappingError(missing);

      if (integration.syncMode === "SUMMARY") {
        const byDay = new Map<string, SyncEntry[]>();
        for (const e of entries) {
          const key = formatDayISO(e.date);
          byDay.set(key, [...(byDay.get(key) ?? []), e]);
        }
        for (const [day, dayEntries] of byDay) {
          const journal = buildSummaryJournal(dayEntries[0].date, dayEntries, mappings);
          const idempotencyKey = batchReference(dayEntries[0].date, dayEntries.map((e) => e.id));
          if (journal.lines.length === 0) {
            await markSynced(provider, dayEntries, "netted-to-zero");
            continue;
          }
          const remoteId = await client.postJournal(journal, idempotencyKey);
          await markSynced(provider, dayEntries, remoteId);
          await log(provider, "JOURNAL", null, "SUCCESS", `${day}: posted summary ${journal.reference} (${dayEntries.length} entries) → ${remoteId}`);
          result.pushed += dayEntries.length;
          result.journals++;
        }
      } else {
        for (const entry of entries) {
          if (client.ensureCustomer) {
            for (const payerId of new Set(entry.lines.map((l) => l.payerId).filter((p): p is string => !!p))) {
              if (!mappings.customers.has(payerId)) {
                const payer = await prisma.payer.findUniqueOrThrow({ where: { id: payerId } });
                const remoteId = await client.ensureCustomer(payer);
                await prisma.externalRef.create({
                  data: { provider, entityType: ENTITY.CUSTOMER, localId: payerId, remoteId, remoteName: payer.name },
                });
                mappings.customers.set(payerId, remoteId);
                await log(provider, "CUSTOMER", payerId, "SUCCESS", `Linked customer ${payer.name} → ${remoteId}`);
              }
            }
          }
          const journal = buildDetailedJournal(entry, mappings, client.ensureCustomer !== null);
          const remoteId = await client.postJournal(journal, `nw-je-${entry.id}`);
          await markSynced(provider, [entry], remoteId);
          await log(provider, "JOURNAL", entry.id, "SUCCESS", `#${entry.number} ${entry.memo} → ${remoteId}`);
          result.pushed++;
          result.journals++;
        }
      }
    }
    await prisma.integration.update({
      where: { provider },
      data: { lastSyncAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    await log(provider, "SYNC", null, "ERROR", message);
    await prisma.integration.update({ where: { provider }, data: { lastError: message } });
  }
  return result;
}

async function markSynced(provider: Provider, entries: SyncEntry[], remoteId: string) {
  await prisma.$transaction(
    entries.map((e) =>
      prisma.externalRef.create({
        data: { provider, entityType: ENTITY.JOURNAL_ENTRY, localId: e.id, remoteId, remoteName: `#${e.number}` },
      }),
    ),
  );
}

export async function syncAll() {
  const integrations = await prisma.integration.findMany({ where: { accessTokenEnc: { not: null } } });
  const results: Partial<Record<Provider, SyncResult>> = {};
  for (const i of integrations) results[i.provider] = await syncProvider(i.provider);
  return results;
}
