import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { formatDay, formatDayISO, parseDay, today } from "@/lib/dates";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/accounting/ledger";
import { accountTotals, arReconciliation, defaultRange, revenueByClassroom, undepositedReconciliation } from "@/lib/accounting/reports";
import { Badge, Card, Field, Page, PageHeader, Tabs, btnSecondary, inputCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";

const REPORTS = [
  { key: "pl", label: "Profit & Loss" },
  { key: "bs", label: "Balance Sheet" },
  { key: "tb", label: "Trial Balance" },
  { key: "class", label: "Revenue by Classroom" },
  { key: "recon", label: "Reconciliation" },
] as const;

export default async function ReportsPage(props: PageProps<"/accounting">) {
  await requireRole(FINANCE);
  const sp = await props.searchParams;
  const report = REPORTS.find((r) => r.key === sp.report)?.key ?? "pl";
  const { from, to } = defaultRange(
    { from: typeof sp.from === "string" ? sp.from : undefined, to: typeof sp.to === "string" ? sp.to : undefined },
    parseDay,
  );
  const qs = `from=${formatDayISO(from)}&to=${formatDayISO(to)}`;

  return (
    <Page>
      <PageHeader
        title="Financial reports"
        subtitle="Straight from the double-entry general ledger — the same numbers your accountant sees in QuickBooks or Xero."
        actions={
          <form className="flex items-end gap-2">
            <input type="hidden" name="report" value={report} />
            {report !== "bs" && <Field label="From"><input type="date" name="from" defaultValue={formatDayISO(from)} className={inputCls} /></Field>}
            <Field label={report === "bs" ? "As of" : "To"}><input type="date" name="to" defaultValue={formatDayISO(to)} className={inputCls} /></Field>
            <button className={btnSecondary}>Run</button>
          </form>
        }
      />
      <Tabs items={REPORTS.map((r) => ({ href: `/accounting?report=${r.key}&${qs}`, label: r.label }))} active={`/accounting?report=${report}&${qs}`} />
      {report === "pl" && <PL from={from} to={to} />}
      {report === "bs" && <BS asOf={to} />}
      {report === "tb" && <TB from={from} to={to} />}
      {report === "class" && <ByClass from={from} to={to} />}
      {report === "recon" && <Recon />}
    </Page>
  );
}

function Section({ title, rows, total }: { title: string; rows: { id: string; code: string; name: string; amount: number }[]; total: number }) {
  return (
    <>
      <tr className="bg-zinc-50">
        <td className={`${tdCls} font-semibold`} colSpan={2}>{title}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.id} className={trCls}>
          <td className={`${tdCls} pl-8`}>{r.code} {r.name}</td>
          <td className={tdRight}>{formatCents(r.amount)}</td>
        </tr>
      ))}
      <tr className={trCls}>
        <td className={`${tdCls} font-medium`}>Total {title.toLowerCase()}</td>
        <td className={`${tdRight} font-medium`}>{formatCents(total)}</td>
      </tr>
    </>
  );
}

async function PL({ from, to }: { from: Date; to: Date }) {
  const pl = profitAndLoss(await accountTotals({ from, to }));
  return (
    <Card title={`Profit & Loss · ${formatDay(from)} – ${formatDay(to)}`} flush>
      <table className="w-full">
        <tbody>
          <Section title="Income" rows={pl.revenue} total={pl.totalRevenue} />
          <Section title="Expenses" rows={pl.expenses} total={pl.totalExpenses} />
          <tr className="border-t-2 border-zinc-300">
            <td className={`${tdCls} text-base font-semibold`}>Net income</td>
            <td className={`${tdRight} text-base font-semibold ${pl.netIncome < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCents(pl.netIncome)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

async function BS({ asOf }: { asOf: Date }) {
  const bs = balanceSheet(await accountTotals({ to: asOf }));
  return (
    <Card title={`Balance Sheet · as of ${formatDay(asOf)}`} actions={bs.balanced ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Out of balance</Badge>} flush>
      <table className="w-full">
        <tbody>
          <Section title="Assets" rows={bs.assets} total={bs.totalAssets} />
          <Section title="Liabilities" rows={bs.liabilities} total={bs.totalLiabilities} />
          <Section
            title="Equity"
            rows={[...bs.equity, { id: "re", code: "", name: "Retained earnings / current earnings", amount: bs.retainedEarnings }]}
            total={bs.totalEquity}
          />
          <tr className="border-t-2 border-zinc-300">
            <td className={`${tdCls} font-semibold`}>Total liabilities & equity</td>
            <td className={`${tdRight} font-semibold`}>{formatCents(bs.totalLiabilities + bs.totalEquity)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

async function TB({ from, to }: { from: Date; to: Date }) {
  const tb = trialBalance(await accountTotals({ from, to }));
  return (
    <Card title={`Trial Balance · ${formatDay(from)} – ${formatDay(to)}`} actions={tb.balanced ? <Badge tone="green">Debits = credits</Badge> : <Badge tone="red">Unbalanced</Badge>} flush>
      <table className="w-full">
        <thead>
          <tr>
            <th className={thCls}>Account</th>
            <th className={thRight}>Debit</th>
            <th className={thRight}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {tb.lines.map((l) => (
            <tr key={l.id} className={trCls}>
              <td className={tdCls}>{l.code} {l.name}</td>
              <td className={tdRight}>{l.debit ? formatCents(l.debit) : ""}</td>
              <td className={tdRight}>{l.credit ? formatCents(l.credit) : ""}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-zinc-300">
            <td className={`${tdCls} font-semibold`}>Total</td>
            <td className={`${tdRight} font-semibold`}>{formatCents(tb.totalDebit)}</td>
            <td className={`${tdRight} font-semibold`}>{formatCents(tb.totalCredit)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

async function ByClass({ from, to }: { from: Date; to: Date }) {
  const rows = await revenueByClassroom(from, to);
  const total = rows.reduce((a, r) => a + r.cents, 0);
  return (
    <Card title={`Net revenue by classroom · ${formatDay(from)} – ${formatDay(to)}`} flush>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={trCls}>
              <td className={tdCls}>{r.name}</td>
              <td className={tdRight}>{formatCents(r.cents)}</td>
              <td className={`${tdRight} w-24 text-zinc-500`}>{total ? Math.round((r.cents / total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
        Classrooms sync to QuickBooks Classes / Xero tracking categories, so this report matches your books.
      </p>
    </Card>
  );
}

async function Recon() {
  const [ar, ud] = await Promise.all([arReconciliation(), undepositedReconciliation()]);
  const row = (label: string, value: number, strong?: boolean) => (
    <tr className={trCls}>
      <td className={`${tdCls} ${strong ? "font-semibold" : ""}`}>{label}</td>
      <td className={`${tdRight} ${strong ? "font-semibold" : ""}`}>{formatCents(value)}</td>
    </tr>
  );
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title="Accounts receivable" actions={ar.difference === 0 ? <Badge tone="green">Reconciled</Badge> : <Badge tone="red">Off by {formatCents(ar.difference)}</Badge>} flush>
        <table className="w-full">
          <tbody>
            {row("Open invoice balances", ar.openBalances)}
            {row("Less unapplied payments & credits", -ar.unapplied)}
            {row("Sub-ledger total", ar.subledger, true)}
            {row("General ledger A/R", ar.gl, true)}
          </tbody>
        </table>
      </Card>
      <Card title="Undeposited funds" actions={ud.difference === 0 ? <Badge tone="green">Reconciled</Badge> : <Badge tone="red">Off by {formatCents(ud.difference)}</Badge>} flush>
        <table className="w-full">
          <tbody>
            {row("Payments awaiting deposit (net)", ud.pending)}
            {row("General ledger balance", ud.gl, true)}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-zinc-500 md:col-span-2">
        Checked live on every page load as of {formatDay(today())}. Most childcare software can&apos;t prove this — their &ldquo;accounting&rdquo; is a payments list.
      </p>
    </div>
  );
}
