import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay, formatDayISO, parseDay, today } from "@/lib/dates";
import { previewBillingRun } from "@/lib/accounting/billing-run";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, Notice, Page, PageHeader, btnSecondary, inputCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { billingRunAction } from "../actions";

export default async function BillingRunPage(props: PageProps<"/billing/run">) {
  await requireRole(FINANCE);
  const sp = await props.searchParams;
  const frequency = sp.frequency === "WEEKLY" ? "WEEKLY" : "MONTHLY";
  const anchor = (typeof sp.anchor === "string" && parseDay(sp.anchor)) || today();
  const posted = typeof sp.posted === "string" ? await prisma.billingRun.findUnique({ where: { id: sp.posted } }) : null;
  const [preview, runs] = await Promise.all([
    previewBillingRun(prisma, frequency, anchor),
    prisma.billingRun.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="Billing run"
        subtitle="Preview every invoice before anything posts. Proration, sibling discounts and split billing are applied automatically; re-running a period only bills what's missing."
      />
      {posted && (
        <Notice>
          Posted {posted.invoiceCount} invoices totalling {formatCents(posted.totalCents)} for {formatDay(posted.periodStart)} – {formatDay(posted.periodEnd)}.
          Payer credits on file were applied automatically.
        </Notice>
      )}
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3">
          <Field label="Frequency">
            <select name="frequency" defaultValue={frequency} className={inputCls}>
              <option value="MONTHLY">Monthly plans</option>
              <option value="WEEKLY">Weekly plans</option>
            </select>
          </Field>
          <Field label="Any day in the period"><input type="date" name="anchor" defaultValue={formatDayISO(anchor)} className={inputCls} /></Field>
          <button className={btnSecondary}>Preview</button>
        </form>
      </Card>

      <Card
        title={`Preview: ${formatDay(preview.periodStart)} – ${formatDay(preview.periodEnd)} · ${preview.invoices.length} invoices · ${formatCents(preview.totalCents)}`}
        flush
      >
        {preview.warnings.map((w) => <p key={w} className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">{w}</p>)}
        {preview.skippedAlreadyBilled > 0 && (
          <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-500">
            {preview.skippedAlreadyBilled} charges in this period are already invoiced and will not be billed again.
          </p>
        )}
        {preview.invoices.length === 0 ? (
          <Empty>Nothing to bill for this period.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Payer</th>
                <th className={thCls}>Lines</th>
                <th className={thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.invoices.map((inv) => (
                <tr key={inv.payerId} className={`${trCls} align-top`}>
                  <td className={tdCls}>
                    <div className="font-medium">{inv.payerName}</div>
                    <div className="text-xs text-zinc-400">{inv.familyName ?? "Third-party payer"}</div>
                  </td>
                  <td className={tdCls}>
                    {inv.lines.map((l) => (
                      <div key={l.dedupeKey} className="flex justify-between gap-6">
                        <span className={l.amountCents < 0 ? "text-emerald-700" : ""}>{l.description}</span>
                        <span className="tabular-nums">{formatCents(l.amountCents)}</span>
                      </div>
                    ))}
                  </td>
                  <td className={`${tdRight} font-semibold`}>{formatCents(inv.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview.invoices.length > 0 && (
          <div className="border-t border-zinc-100 p-4">
            <ActionForm
              action={billingRunAction}
              submitLabel={`Post ${preview.invoices.length} invoices`}
              pendingLabel="Posting…"
              className="flex flex-wrap items-end gap-3"
              confirm="Post these invoices to the ledger?"
            >
              <input type="hidden" name="frequency" value={frequency} />
              <input type="hidden" name="anchor" value={formatDayISO(anchor)} />
              <Field label="Invoice date"><input type="date" name="issueDate" defaultValue={formatDayISO(today())} className={inputCls} /></Field>
            </ActionForm>
          </div>
        )}
      </Card>

      <Card title="Recent runs" flush className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Period</th>
              <th className={thCls}>Posted</th>
              <th className={thRight}>Invoices</th>
              <th className={thRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className={trCls}>
                <td className={tdDate}>{formatDay(r.periodStart)} – {formatDay(r.periodEnd)}</td>
                <td className={tdCls}>{r.createdAt.toLocaleString()}</td>
                <td className={tdRight}>{r.invoiceCount}</td>
                <td className={tdRight}>{formatCents(r.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
