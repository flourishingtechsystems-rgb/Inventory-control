import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { daysBetween, formatDay, today } from "@/lib/dates";
import { AGING_BUCKETS } from "@/lib/accounting/ledger";
import { arAging, openInvoices } from "@/lib/accounting/reports";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, Stat, btnSecondary, inputCls, linkCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { createAgencyPayerAction, lateFeesAction } from "./actions";

export default async function ReceivablesPage() {
  await requireRole(FINANCE);
  const now = today();
  const [aging, invoices, center, agencies] = await Promise.all([
    arAging(now),
    openInvoices(),
    prisma.center.findUnique({ where: { id: "center" } }),
    prisma.payer.findMany({ where: { kind: { not: "GUARDIAN" } }, orderBy: { name: "asc" } }),
  ]);
  const overdue = invoices.filter((i) => i.dueDate < now);

  return (
    <Page wide>
      <PageHeader
        title="Receivables"
        subtitle="Every open invoice, by payer and age. Balances are reconciled to the general ledger."
        actions={
          <>
            <Link href="/billing/run" className={btnSecondary}>Run billing</Link>
            <ActionForm
              action={lateFeesAction}
              submitLabel={`Apply late fees (${formatCents(center?.lateFeeCents ?? 0)})`}
              buttonClassName={btnSecondary}
              className="flex items-center gap-2"
              confirm="Charge the late fee on every invoice past its grace period?"
            />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open A/R" value={formatCents(aging.grandTotal)} hint={`${invoices.length} open invoices`} />
        <Stat label="Past due" value={formatCents(aging.grandTotal - aging.totals.Current)} hint={`${overdue.length} invoices`} tone={overdue.length ? "warn" : "good"} />
        <Stat label="Over 60 days" value={formatCents(aging.totals["61–90"] + aging.totals["90+"])} tone={aging.totals["61–90"] + aging.totals["90+"] > 0 ? "bad" : "good"} />
      </div>

      <Card title="Aging by payer" flush className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Payer</th>
              {AGING_BUCKETS.map((b) => <th key={b} className={thRight}>{b}</th>)}
              <th className={thRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {aging.rows.map((r) => (
              <tr key={r.payerId} className={trCls}>
                <td className={tdCls}>{r.payerName}</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={`${tdRight} ${b !== "Current" && r.buckets[b] ? "text-amber-700" : "text-zinc-400"}`}>
                    {r.buckets[b] ? formatCents(r.buckets[b]) : "—"}
                  </td>
                ))}
                <td className={`${tdRight} font-semibold`}>{formatCents(r.total)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-200 bg-zinc-50">
              <td className={`${tdCls} font-semibold`}>Total</td>
              {AGING_BUCKETS.map((b) => <td key={b} className={`${tdRight} font-semibold`}>{formatCents(aging.totals[b])}</td>)}
              <td className={`${tdRight} font-semibold`}>{formatCents(aging.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="Open invoices" flush className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Invoice</th>
              <th className={thCls}>Payer</th>
              <th className={thCls}>Issued</th>
              <th className={thCls}>Due</th>
              <th className={thRight}>Total</th>
              <th className={thRight}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const late = daysBetween(inv.dueDate, now);
              return (
                <tr key={inv.id} className={trCls}>
                  <td className={tdCls}><Link href={`/billing/invoices/${inv.id}`} className={linkCls}>#{inv.number}</Link></td>
                  <td className={tdCls}>
                    {inv.payer.familyId ? <Link href={`/families/${inv.payer.familyId}`} className="hover:underline">{inv.payer.name}</Link> : inv.payer.name}
                    {inv.payer.kind !== "GUARDIAN" && <> <Badge tone="blue">{inv.payer.kind.toLowerCase()}</Badge></>}
                  </td>
                  <td className={tdDate}>{formatDay(inv.issueDate)}</td>
                  <td className={tdCls}>
                    {formatDay(inv.dueDate)} {late > 0 && <Badge tone={late > 30 ? "red" : "amber"}>{late}d late</Badge>}
                  </td>
                  <td className={tdRight}>{formatCents(inv.totalCents)}</td>
                  <td className={`${tdRight} font-medium`}>{formatCents(inv.balanceCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Third-party payers (subsidy agencies & employers)" className="mt-6">
        <div className="grid gap-6 md:grid-cols-2">
          <ul className="space-y-1 text-sm">
            {agencies.map((a) => (
              <li key={a.id}>{a.name} <Badge tone="blue">{a.kind.toLowerCase()}</Badge></li>
            ))}
            {agencies.length === 0 && <li className="text-zinc-500">None yet.</li>}
          </ul>
          <ActionForm action={createAgencyPayerAction} submitLabel="Add payer" buttonClassName={btnSecondary}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><input name="name" required className={inputCls} /></Field>
              <Field label="Type">
                <select name="kind" className={inputCls}>
                  <option value="AGENCY">Subsidy agency</option>
                  <option value="EMPLOYER">Employer benefit</option>
                </select>
              </Field>
            </div>
            <Field label="Billing email"><input name="email" type="email" className={inputCls} /></Field>
          </ActionForm>
        </div>
      </Card>
    </Page>
  );
}
