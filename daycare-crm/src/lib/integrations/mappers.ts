// Pure translation from Nestwise journal entries to QuickBooks Online and Xero
// payloads, plus file exports. Kept free of I/O so it is fully unit-tested.

import { createHash } from "node:crypto";
import { centsToDecimal } from "@/lib/money";
import { formatDayISO } from "@/lib/dates";

export type ProviderKey = "QUICKBOOKS" | "XERO";

export type SyncLine = {
  accountId: string;
  classroomId: string | null;
  payerId: string | null;
  debitCents: number;
  creditCents: number;
  memo: string | null;
};

export type SyncEntry = {
  id: string;
  number: number;
  date: Date;
  memo: string;
  lines: SyncLine[];
};

export type RemoteLine = {
  accountRemoteId: string;
  classRemoteId: string | null;
  customerRemoteId: string | null;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
};

export type RemoteJournal = {
  date: string;
  reference: string;
  memo: string;
  lines: RemoteLine[];
};

export type Mappings = {
  accounts: Map<string, string>;
  classes: Map<string, string>;
  customers: Map<string, string>;
  accountNames: Map<string, string>;
  payerNames: Map<string, string>;
};

export class MappingError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Map these accounts before syncing: ${missing.join(", ")}`);
  }
}

/** Accounts used by `entries` that have no remote mapping (by local account name). */
export function unmappedAccounts(entries: SyncEntry[], mappings: Mappings): string[] {
  const missing = new Set<string>();
  for (const e of entries) {
    for (const l of e.lines) {
      if (!mappings.accounts.has(l.accountId)) {
        missing.add(mappings.accountNames.get(l.accountId) ?? l.accountId);
      }
    }
  }
  return [...missing].sort();
}

/**
 * Collapses a day's entries into one balanced journal: one line per
 * account + class, netted. Because every source entry balances, so does the
 * summary.
 */
export function summarise(entries: SyncEntry[]): SyncLine[] {
  const map = new Map<string, SyncLine & { net: number }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const key = `${l.accountId}|${l.classroomId ?? ""}`;
      const row =
        map.get(key) ??
        { accountId: l.accountId, classroomId: l.classroomId, payerId: null, debitCents: 0, creditCents: 0, memo: null, net: 0 };
      row.net += l.debitCents - l.creditCents;
      map.set(key, row);
    }
  }
  return [...map.values()]
    .filter((r) => r.net !== 0)
    .map(({ net, ...r }) => ({ ...r, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0 }));
}

/** Short, deterministic reference so a retried sync can be recognised remotely. */
export function batchReference(date: Date, entryIds: string[]): string {
  const hash = createHash("sha256").update([...entryIds].sort().join(",")).digest("hex");
  return `NW-${formatDayISO(date).replaceAll("-", "")}-${hash.slice(0, 6)}`;
}

export function buildSummaryJournal(date: Date, entries: SyncEntry[], mappings: Mappings): RemoteJournal {
  const lines = summarise(entries);
  return {
    date: formatDayISO(date),
    reference: batchReference(date, entries.map((e) => e.id)),
    memo: `Nestwise daily summary ${formatDayISO(date)} (${entries.length} transactions, #${Math.min(...entries.map((e) => e.number))}–#${Math.max(...entries.map((e) => e.number))})`,
    lines: lines.map((l) => toRemoteLine(l, mappings, false)),
  };
}

export function buildDetailedJournal(entry: SyncEntry, mappings: Mappings, withCustomers: boolean): RemoteJournal {
  return {
    date: formatDayISO(entry.date),
    reference: `NW-JE-${entry.number}`,
    memo: `Nestwise #${entry.number}: ${entry.memo}`,
    lines: entry.lines.map((l) => toRemoteLine(l, mappings, withCustomers)),
  };
}

function toRemoteLine(l: SyncLine, mappings: Mappings, withCustomers: boolean): RemoteLine {
  const accountRemoteId = mappings.accounts.get(l.accountId);
  if (!accountRemoteId) throw new MappingError([mappings.accountNames.get(l.accountId) ?? l.accountId]);
  const payerName = l.payerId ? mappings.payerNames.get(l.payerId) : undefined;
  const description = [l.memo, payerName].filter(Boolean).join(" — ") || (mappings.accountNames.get(l.accountId) ?? "");
  return {
    accountRemoteId,
    classRemoteId: l.classroomId ? mappings.classes.get(l.classroomId) ?? null : null,
    customerRemoteId: withCustomers && l.payerId ? mappings.customers.get(l.payerId) ?? null : null,
    postingType: l.debitCents > 0 ? "Debit" : "Credit",
    amountCents: l.debitCents > 0 ? l.debitCents : l.creditCents,
    description: description.slice(0, 4000),
  };
}

// --- QuickBooks Online -----------------------------------------------------

export function toQboJournalEntry(j: RemoteJournal) {
  return {
    TxnDate: j.date,
    // QBO caps DocNumber at 21 characters.
    DocNumber: j.reference.slice(0, 21),
    PrivateNote: j.memo.slice(0, 4000),
    Line: j.lines.map((l) => ({
      Description: l.description,
      Amount: Number(centsToDecimal(l.amountCents)),
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: l.postingType,
        AccountRef: { value: l.accountRemoteId },
        ...(l.classRemoteId ? { ClassRef: { value: l.classRemoteId } } : {}),
        ...(l.customerRemoteId
          ? { Entity: { Type: "Customer", EntityRef: { value: l.customerRemoteId } } }
          : {}),
      },
    })),
  };
}

export function toQboCustomer(payer: { name: string; email: string | null; id: string }) {
  return {
    // DisplayName must be unique in QBO; the suffix avoids clashing with an
    // existing customer of the same name.
    DisplayName: `${payer.name} (NW-${payer.id.slice(-6)})`.slice(0, 500),
    ...(payer.email ? { PrimaryEmailAddr: { Address: payer.email } } : {}),
    Notes: `Synced from Nestwise payer ${payer.id}`,
  };
}

// --- Xero ------------------------------------------------------------------

/** Xero tracking is addressed by names; mapping ids are stored as "Category::Option". */
export function xeroTracking(classRemoteId: string | null) {
  if (!classRemoteId) return undefined;
  const [name, option] = classRemoteId.split("::");
  return name && option ? [{ Name: name, Option: option }] : undefined;
}

export function toXeroManualJournal(j: RemoteJournal) {
  return {
    Narration: `${j.reference} ${j.memo}`.slice(0, 4000),
    Date: j.date,
    Status: "POSTED",
    LineAmountTypes: "NoTax",
    JournalLines: j.lines.map((l) => ({
      // Xero signs manual-journal lines: debits positive, credits negative.
      LineAmount: Number(centsToDecimal(l.postingType === "Debit" ? l.amountCents : -l.amountCents)),
      AccountCode: l.accountRemoteId,
      Description: l.description,
      ...(xeroTracking(l.classRemoteId) ? { Tracking: xeroTracking(l.classRemoteId) } : {}),
    })),
  };
}

// --- File exports (for accountants not using a live connection) -------------

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export type ExportEntry = SyncEntry & { lines: (SyncLine & { accountCode: string; accountName: string; classroomName: string | null })[] };

/** Xero "Import manual journals" CSV template. */
export function xeroManualJournalCsv(entries: ExportEntry[]): string {
  const rows = [
    ["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount", "TrackingName1", "TrackingOption1"],
  ];
  for (const e of entries) {
    for (const l of e.lines) {
      const signed = l.debitCents - l.creditCents;
      rows.push([
        `Nestwise #${e.number}: ${e.memo}`,
        formatDayISO(e.date),
        l.memo ?? "",
        l.accountCode,
        "Tax Exempt",
        centsToDecimal(signed),
        l.classroomName ? "Classroom" : "",
        l.classroomName ?? "",
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** QuickBooks Desktop IIF general-journal import. */
export function quickbooksIif(entries: ExportEntry[]): string {
  const out = [
    "!TRNS\tTRNSTYPE\tDATE\tACCNT\tCLASS\tAMOUNT\tDOCNUM\tMEMO",
    "!SPL\tTRNSTYPE\tDATE\tACCNT\tCLASS\tAMOUNT\tDOCNUM\tMEMO",
    "!ENDTRNS",
  ];
  const clean = (s: string) => s.replace(/[\t\r\n]/g, " ");
  for (const e of entries) {
    const [y, m, d] = formatDayISO(e.date).split("-");
    const date = `${m}/${d}/${y}`;
    e.lines.forEach((l, i) => {
      out.push(
        [
          i === 0 ? "TRNS" : "SPL",
          "GENERAL JOURNAL",
          date,
          clean(l.accountName),
          clean(l.classroomName ?? ""),
          centsToDecimal(l.debitCents - l.creditCents),
          `NW${e.number}`,
          clean(l.memo ?? e.memo),
        ].join("\t"),
      );
    });
    out.push("ENDTRNS");
  }
  return out.join("\r\n") + "\r\n";
}

/** Plain general-ledger detail CSV. */
export function generalLedgerCsv(entries: ExportEntry[]): string {
  const rows = [["Entry", "Date", "Memo", "Account Code", "Account", "Class", "Debit", "Credit", "Line Memo"]];
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([
        String(e.number),
        formatDayISO(e.date),
        e.memo,
        l.accountCode,
        l.accountName,
        l.classroomName ?? "",
        l.debitCents ? centsToDecimal(l.debitCents) : "",
        l.creditCents ? centsToDecimal(l.creditCents) : "",
        l.memo ?? "",
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
