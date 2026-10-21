"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Field, inputCls } from "@/components/ui";
import { manualJournalAction } from "../actions";

type Option = { id: string; label: string };

function toCents(v: string) {
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function ManualJournalForm({ accounts, defaultDate }: { accounts: Option[]; defaultDate: string }) {
  const blank = [{ debit: "", credit: "" }, { debit: "", credit: "" }];
  const [lines, setLines] = useState(blank);
  const debits = lines.reduce((a, l) => a + toCents(l.debit), 0);
  const credits = lines.reduce((a, l) => a + toCents(l.credit), 0);
  const diff = debits - credits;

  return (
    <ActionForm action={manualJournalAction} submitLabel="Post entry" className="flex flex-col gap-3" onSuccess={() => setLines(blank)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><input type="date" name="date" defaultValue={defaultDate} required className={inputCls} /></Field>
        <div className="sm:col-span-2">
          <Field label="Memo"><input name="memo" required placeholder="Payroll for period ending…" className={inputCls} /></Field>
        </div>
      </div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_8rem] gap-2">
            <select name="accountId" className={inputCls} aria-label={`Line ${i + 1} account`}>
              <option value="">Account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <input
              name="debit"
              placeholder="Debit"
              inputMode="decimal"
              value={line.debit}
              onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, debit: e.target.value } : l)))}
              className={inputCls}
            />
            <input
              name="credit"
              placeholder="Credit"
              inputMode="decimal"
              value={line.credit}
              onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, credit: e.target.value } : l)))}
              className={inputCls}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={() => setLines([...lines, { debit: "", credit: "" }])} className="text-teal-700 hover:underline">
          + Add line
        </button>
        <span className={diff === 0 ? "text-emerald-700" : "text-red-600"}>
          {diff === 0 ? "Balanced" : `Out of balance by ${(Math.abs(diff) / 100).toFixed(2)}`}
        </span>
      </div>
    </ActionForm>
  );
}
