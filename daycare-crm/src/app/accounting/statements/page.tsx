import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { careStatements } from "@/lib/accounting/reports";
import { Card, Page, PageHeader, btnSecondary } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function StatementsPage(props: PageProps<"/accounting/statements">) {
  await requireRole(FINANCE);
  const sp = await props.searchParams;
  const currentYear = new Date().getFullYear();
  const year = Number(sp.year) || currentYear;
  const [statements, center] = await Promise.all([careStatements(year), prisma.center.findUnique({ where: { id: "center" } })]);

  return (
    <Page>
      <div className="print:hidden">
        <PageHeader
          title="Dependent care tax statements"
          subtitle="Year-end statements for IRS Form 2441 and dependent-care FSA claims: what each guardian actually paid (net of refunds), with your EIN. Agency/subsidy payments are excluded automatically."
          actions={
            <>
              <form className="flex gap-2">
                <select name="year" defaultValue={year} className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm">
                  {[currentYear, currentYear - 1, currentYear - 2].map((y) => <option key={y}>{y}</option>)}
                </select>
                <button className={btnSecondary}>Show</button>
              </form>
              <PrintButton label={`Print all (${statements.length})`} />
            </>
          }
        />
        {!center?.ein && <p className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-800">Add your EIN under Close &amp; Settings — parents need it for Form 2441.</p>}
      </div>
      <div className="space-y-6">
        {statements.map(({ payer, paidCents }) => (
          <Card key={payer.id} className="break-after-page print:border-0 print:shadow-none">
            <div className="flex justify-between">
              <div>
                <div className="text-lg font-semibold">{center?.legalName ?? center?.name}</div>
                <div className="text-sm text-zinc-500">{center?.address}</div>
                <div className="text-sm text-zinc-500">Provider EIN: {center?.ein ?? "—"}</div>
              </div>
              <div className="text-right text-sm text-zinc-500">
                Child care payment statement
                <div className="text-lg font-semibold text-zinc-900">Tax year {year}</div>
              </div>
            </div>
            <div className="mt-6 text-sm">
              <div className="text-zinc-500">Paid by</div>
              <div className="font-medium">{payer.name}</div>
              {payer.email && <div className="text-zinc-500">{payer.email}</div>}
            </div>
            <div className="mt-4 text-sm">
              <div className="text-zinc-500">Children in care</div>
              <div>{payer.family?.children.map((c) => `${c.firstName} ${c.lastName}`).join(", ") || "—"}</div>
            </div>
            <div className="mt-6 flex items-center justify-between rounded-lg bg-zinc-50 p-4">
              <span className="text-sm font-medium">Total paid for child care in {year}</span>
              <span className="text-2xl font-semibold tabular-nums">{formatCents(paidCents)}</span>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              Amounts reflect payments received January 1 – December 31, {year}, less refunds. Third-party subsidy payments are not included.
            </p>
          </Card>
        ))}
        {statements.length === 0 && <p className="text-sm text-zinc-500">No guardian payments recorded in {year}.</p>}
      </div>
    </Page>
  );
}
