import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay, formatDayISO, today } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Page, PageHeader, btnSecondary, inputCls, linkCls, tdCls, tdDate, tdRight, thCls, thRight } from "@/components/ui";
import { reverseEntryAction } from "../actions";
import { ManualJournalForm } from "./ManualJournalForm";

const PAGE_SIZE = 40;

export default async function JournalPage(props: PageProps<"/accounting/journal">) {
  await requireRole(FINANCE);
  const sp = await props.searchParams;
  const accountId = typeof sp.account === "string" ? sp.account : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [accounts, entries, count] = await Promise.all([
    prisma.account.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.journalEntry.findMany({
      where: accountId ? { lines: { some: { accountId } } } : undefined,
      include: { lines: { include: { account: true, payer: true, classroom: true } }, reversedBy: true, createdBy: true },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.journalEntry.count({ where: accountId ? { lines: { some: { accountId } } } : undefined }),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="General ledger"
        subtitle="Every posting, immutable. Corrections are reversing entries so the audit trail and synced books always agree."
        actions={
          <>
            <form action="/api/exports/gl"><button className={btnSecondary}>Export CSV</button></form>
            <form className="flex gap-2">
              <select name="account" defaultValue={accountId ?? ""} className={inputCls}>
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
              <button className={btnSecondary}>Filter</button>
            </form>
          </>
        }
      />
      <Card title="Manual journal entry" className="mb-6">
        <ManualJournalForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))} defaultDate={formatDayISO(today())} />
      </Card>
      <Card flush>
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>#</th>
              <th className={thCls}>Date</th>
              <th className={thCls}>Account</th>
              <th className={thCls}>Detail</th>
              <th className={thRight}>Debit</th>
              <th className={thRight}>Credit</th>
            </tr>
          </thead>
          {entries.map((e) => (
            <tbody key={e.id} className="border-t-2 border-zinc-100">
              <tr className="bg-zinc-50/70">
                <td className={`${tdCls} font-mono text-xs`}>{e.number}</td>
                <td className={tdDate}>{formatDay(e.date)}</td>
                <td className={tdCls} colSpan={2}>
                  <span className="font-medium">{e.memo}</span> <Badge>{e.source.toLowerCase()}</Badge>
                  {e.reversedBy && <> <Badge tone="amber">reversed by #{e.reversedBy.number}</Badge></>}
                  {e.source === "INVOICE" && e.sourceId && <> <Link href={`/billing/invoices/${e.sourceId}`} className={`text-xs ${linkCls}`}>view</Link></>}
                  <span className="ml-2 text-xs text-zinc-400">{e.createdBy?.name ?? "system"}</span>
                </td>
                <td className={tdCls} colSpan={2}>
                  {e.source === "MANUAL" && !e.reversedBy && (
                    <details className="text-right">
                      <summary className="cursor-pointer text-xs text-teal-700">Reverse</summary>
                      <ActionForm action={reverseEntryAction.bind(null, e.id)} submitLabel="Post reversal" buttonClassName={btnSecondary} className="mt-2 flex items-center justify-end gap-2">
                        <input type="date" name="date" defaultValue={formatDayISO(today())} className={`${inputCls} w-40`} />
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td />
                  <td />
                  <td className={`${tdCls} py-1`}>{l.account.code} {l.account.name}</td>
                  <td className={`${tdCls} py-1 text-xs text-zinc-500`}>{[l.payer?.name, l.classroom?.name, l.memo].filter(Boolean).join(" · ")}</td>
                  <td className={`${tdRight} py-1`}>{l.debitCents ? formatCents(l.debitCents) : ""}</td>
                  <td className={`${tdRight} py-1`}>{l.creditCents ? formatCents(l.creditCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <div className="flex justify-between border-t border-zinc-100 px-4 py-3 text-sm">
          <span className="text-zinc-500">{count} entries</span>
          <span className="flex gap-3">
            {page > 1 && <Link className={linkCls} href={`?page=${page - 1}${accountId ? `&account=${accountId}` : ""}`}>← Newer</Link>}
            {page * PAGE_SIZE < count && <Link className={linkCls} href={`?page=${page + 1}${accountId ? `&account=${accountId}` : ""}`}>Older →</Link>}
          </span>
        </div>
      </Card>
    </Page>
  );
}
