import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { PaymentForm } from "@/components/BillingForms";
import { Badge, Card, Page, PageHeader, btnSecondary, inputCls, linkCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { refundAction } from "../actions";

export default async function PaymentsPage() {
  await requireRole(FINANCE);
  const [payments, payers] = await Promise.all([
    prisma.payment.findMany({
      include: { payer: true, allocations: { include: { invoice: true } }, refunds: true, deposit: true },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.payer.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <Page wide>
      <PageHeader title="Payments" subtitle="Payments post to Undeposited Funds net of processor fees, then move to the bank when you record the deposit." />
      <Card title="Record a payment" className="mb-6">
        <PaymentForm payers={payers.map((p) => ({ id: p.id, name: p.name }))} />
      </Card>
      <Card flush>
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Date</th>
              <th className={thCls}>Payer</th>
              <th className={thCls}>Method</th>
              <th className={thRight}>Amount</th>
              <th className={thRight}>Fee</th>
              <th className={thCls}>Applied to</th>
              <th className={thCls}>Deposit</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const applied = p.allocations.reduce((a, x) => a + x.amountCents, 0);
              const refunded = p.refunds.reduce((a, x) => a + x.amountCents, 0);
              const unapplied = p.amountCents - applied - refunded;
              return (
                <tr key={p.id} className={`${trCls} align-top`}>
                  <td className={tdDate}>{formatDay(p.receivedAt)}</td>
                  <td className={tdCls}>
                    {p.payer.familyId ? <Link href={`/families/${p.payer.familyId}`} className="hover:underline">{p.payer.name}</Link> : p.payer.name}
                    {p.reference && <div className="text-xs text-zinc-400">{p.reference}</div>}
                  </td>
                  <td className={tdCls}><Badge>{p.method.toLowerCase()}</Badge></td>
                  <td className={tdRight}>{formatCents(p.amountCents)}</td>
                  <td className={`${tdRight} text-zinc-500`}>{p.feeCents ? formatCents(p.feeCents) : "—"}</td>
                  <td className={tdCls}>
                    {p.allocations.map((a) => (
                      <Link key={a.id} href={`/billing/invoices/${a.invoiceId}`} className={`mr-2 ${linkCls}`}>#{a.invoice.number}</Link>
                    ))}
                    {unapplied > 0 && <Badge tone="teal">{formatCents(unapplied)} credit</Badge>}
                    {refunded > 0 && <Badge tone="amber">{formatCents(refunded)} refunded</Badge>}
                  </td>
                  <td className={tdCls}>{p.deposit ? formatDay(p.deposit.date) : <Badge tone="amber">undeposited</Badge>}</td>
                  <td className={tdCls}>
                    {unapplied > 0 && (
                      <details>
                        <summary className="cursor-pointer text-xs text-teal-700">Refund</summary>
                        <ActionForm action={refundAction.bind(null, p.id)} submitLabel="Refund" buttonClassName={btnSecondary} className="mt-2 flex w-48 flex-col gap-2">
                          <input name="amount" defaultValue={(unapplied / 100).toFixed(2)} className={inputCls} />
                          <input name="reason" placeholder="Reason" className={inputCls} />
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
