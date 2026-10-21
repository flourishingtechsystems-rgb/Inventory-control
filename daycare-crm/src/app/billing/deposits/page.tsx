import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay, formatDayISO, today } from "@/lib/dates";
import { undepositedPayments } from "@/lib/accounting/receivables";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, Notice, Page, PageHeader, inputCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { depositAction } from "../actions";

export default async function DepositsPage(props: PageProps<"/billing/deposits">) {
  await requireRole(FINANCE);
  const { recorded } = await props.searchParams;
  const justRecorded = typeof recorded === "string" ? await prisma.deposit.findUnique({ where: { id: recorded } }) : null;
  const [pending, deposits] = await Promise.all([
    undepositedPayments(prisma),
    prisma.deposit.findMany({ include: { payments: { include: { payer: true } } }, orderBy: { date: "desc" }, take: 30 }),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="Deposits"
        subtitle="Group payments into the exact amount that hit your bank (a processor payout or a deposit slip) so bank reconciliation in QuickBooks/Xero is a one-click match."
      />
      {justRecorded && (
        <Notice>
          Deposit of {formatCents(justRecorded.amountCents)} recorded{justRecorded.reference ? ` (${justRecorded.reference})` : ""} — it will match that line on your bank statement.
        </Notice>
      )}
      <Card title="Undeposited funds" flush className="mb-6">
        {pending.length === 0 ? (
          <Empty>Everything has been deposited.</Empty>
        ) : (
          <ActionForm action={depositAction} submitLabel="Record deposit" className="flex flex-col gap-3 pb-4 [&>div:last-child]:px-4">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}></th>
                  <th className={thCls}>Received</th>
                  <th className={thCls}>Payer</th>
                  <th className={thCls}>Method</th>
                  <th className={thRight}>Gross</th>
                  <th className={thRight}>Fees & refunds</th>
                  <th className={thRight}>Net to bank</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className={trCls}>
                    <td className={tdCls}><input type="checkbox" name="paymentId" value={p.id} defaultChecked /></td>
                    <td className={tdDate}>{formatDay(p.receivedAt)}</td>
                    <td className={tdCls}>{p.payer.name}</td>
                    <td className={tdCls}>{p.method.toLowerCase()}</td>
                    <td className={tdRight}>{formatCents(p.amountCents)}</td>
                    <td className={`${tdRight} text-zinc-500`}>{formatCents(p.amountCents - p.netCents)}</td>
                    <td className={`${tdRight} font-medium`}>{formatCents(p.netCents)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200 bg-zinc-50">
                  <td className={tdCls} colSpan={6}>All undeposited</td>
                  <td className={`${tdRight} font-semibold`}>{formatCents(pending.reduce((a, p) => a + p.netCents, 0))}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex flex-wrap gap-3 px-4 pt-4">
              <Field label="Deposit date"><input type="date" name="date" defaultValue={formatDayISO(today())} className={inputCls} /></Field>
              <Field label="Reference"><input name="reference" placeholder="Payout id / deposit slip #" className={inputCls} /></Field>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card title="Deposit history" flush>
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Date</th>
              <th className={thCls}>Reference</th>
              <th className={thCls}>Payments</th>
              <th className={thRight}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.id} className={trCls}>
                <td className={tdDate}>{formatDay(d.date)}</td>
                <td className={tdCls}>{d.reference ?? "—"}</td>
                <td className={`${tdCls} text-xs text-zinc-500`}>{d.payments.map((p) => p.payer.name).join(", ")}</td>
                <td className={`${tdRight} font-medium`}>{formatCents(d.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
