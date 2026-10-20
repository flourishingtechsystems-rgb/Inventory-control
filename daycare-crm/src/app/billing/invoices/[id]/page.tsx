import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Page, PageHeader, btnDanger, inputCls, linkCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { adjustmentAction, voidInvoiceAction } from "../../actions";

export default async function InvoicePage(props: PageProps<"/billing/invoices/[id]">) {
  await requireRole(FINANCE);
  const { id } = await props.params;
  const [invoice, center] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: {
        payer: true,
        lines: { include: { account: true, child: true } },
        allocations: { include: { payment: true, adjustment: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.center.findUnique({ where: { id: "center" } }),
  ]);
  if (!invoice) notFound();
  const journal = invoice.journalEntryId
    ? await prisma.journalEntry.findUnique({ where: { id: invoice.journalEntryId }, include: { lines: { include: { account: true } }, reversedBy: true } })
    : null;
  const applied = invoice.allocations.reduce((a, x) => a + x.amountCents, 0);
  const balance = invoice.status === "VOID" ? 0 : invoice.totalCents - applied;

  return (
    <Page>
      <PageHeader
        title={`Invoice #${invoice.number}`}
        subtitle={
          <>
            {invoice.payer.familyId ? <Link href={`/families/${invoice.payer.familyId}`} className={linkCls}>{invoice.payer.name}</Link> : invoice.payer.name}
            {" · "}issued {formatDay(invoice.issueDate)} · due {formatDay(invoice.dueDate)}
          </>
        }
        actions={<Badge tone={invoice.status === "PAID" ? "green" : invoice.status === "VOID" ? "neutral" : "amber"}>{invoice.status.toLowerCase()}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card flush>
            <div className="flex justify-between border-b border-zinc-100 px-4 py-3 text-sm">
              <div>
                <div className="font-semibold">{center?.legalName ?? center?.name}</div>
                <div className="text-zinc-500">{center?.address}</div>
              </div>
              <div className="text-right text-zinc-500">
                {invoice.periodStart && <div>Service period {formatDay(invoice.periodStart)} – {formatDay(invoice.periodEnd)}</div>}
                {center?.ein && <div>EIN {center.ein}</div>}
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>Description</th>
                  <th className={thCls}>Account</th>
                  <th className={thRight}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l) => (
                  <tr key={l.id} className={trCls}>
                    <td className={tdCls}>{l.description}</td>
                    <td className={`${tdCls} text-xs text-zinc-500`}>{l.account.code} {l.account.name}</td>
                    <td className={tdRight}>{formatCents(l.amountCents)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200">
                  <td className={`${tdCls} font-semibold`} colSpan={2}>Total</td>
                  <td className={`${tdRight} font-semibold`}>{formatCents(invoice.totalCents)}</td>
                </tr>
                {invoice.allocations.map((a) => (
                  <tr key={a.id} className={trCls}>
                    <td className={`${tdCls} text-zinc-500`} colSpan={2}>
                      {a.payment
                        ? `Payment ${a.payment.method.toLowerCase()} ${formatDay(a.payment.receivedAt)}${a.payment.reference ? ` · ${a.payment.reference}` : ""}`
                        : `${a.adjustment?.kind === "WRITE_OFF" ? "Write-off" : "Credit"}: ${a.adjustment?.reason}`}
                    </td>
                    <td className={`${tdRight} text-emerald-700`}>−{formatCents(a.amountCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 bg-zinc-50">
                  <td className={`${tdCls} font-semibold`} colSpan={2}>Balance due</td>
                  <td className={`${tdRight} font-semibold`}>{formatCents(balance)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          {journal && (
            <Card title={`Journal entry #${journal.number}${journal.reversedBy ? ` (reversed by #${journal.reversedBy.number})` : ""}`} flush>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Account</th>
                    <th className={thRight}>Debit</th>
                    <th className={thRight}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.lines.map((l) => (
                    <tr key={l.id} className={trCls}>
                      <td className={tdCls}>{l.account.code} {l.account.name}</td>
                      <td className={tdRight}>{l.debitCents ? formatCents(l.debitCents) : ""}</td>
                      <td className={tdRight}>{l.creditCents ? formatCents(l.creditCents) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        {invoice.status === "OPEN" && (
          <div className="space-y-6">
            <Card title="Credit this invoice">
              <ActionForm action={adjustmentAction} submitLabel="Apply credit">
                <input type="hidden" name="payerId" value={invoice.payerId} />
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="returnPath" value={`/billing/invoices/${invoice.id}`} />
                <input name="amount" inputMode="decimal" defaultValue={(balance / 100).toFixed(2)} className={inputCls} />
                <select name="kind" className={inputCls}>
                  <option value="CREDIT">Credit (reduces revenue)</option>
                  <option value="WRITE_OFF">Write-off (bad debt)</option>
                </select>
                <input name="reason" required placeholder="Reason" className={inputCls} />
              </ActionForm>
            </Card>
            {invoice.allocations.length === 0 && (
              <Card title="Void invoice">
                <p className="mb-3 text-xs text-zinc-500">Posts a reversing entry; the original stays in the ledger for audit.</p>
                <ActionForm action={voidInvoiceAction.bind(null, invoice.id)} submitLabel="Void" buttonClassName={btnDanger} confirm="Void this invoice?">
                  <input name="reason" required placeholder="Reason" className={inputCls} />
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
