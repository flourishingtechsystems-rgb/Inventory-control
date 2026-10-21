import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { addDays, formatDay, monthPeriod, today } from "@/lib/dates";
import { accountTotals, arAging, arReconciliation, undepositedReconciliation } from "@/lib/accounting/reports";
import { profitAndLoss, AGING_BUCKETS } from "@/lib/accounting/ledger";
import { PROVIDER_LABELS } from "@/lib/integrations/oauth";
import { Badge, Card, Page, PageHeader, Stat, linkCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";

const STAGES = ["INQUIRY", "TOUR_SCHEDULED", "TOURED", "APPLIED", "WAITLIST"] as const;

export default async function DashboardPage() {
  await requireRole(FINANCE);
  const now = today();
  const month = monthPeriod(now);

  const [rooms, enrolled, present, mtd, aging, arRec, udRec, payments, leads, tours, immunizations, integrations, center] =
    await Promise.all([
      prisma.classroom.findMany({ orderBy: { name: "asc" } }),
      prisma.child.count({ where: { status: "ENROLLED" } }),
      prisma.attendance.findMany({ where: { day: now, checkOutAt: null } }),
      accountTotals({ from: month.start, to: month.end }),
      arAging(now),
      arReconciliation(),
      undepositedReconciliation(),
      prisma.payment.aggregate({ where: { receivedAt: { gte: month.start, lte: month.end } }, _sum: { amountCents: true } }),
      prisma.lead.groupBy({ by: ["stage"], _count: true }),
      prisma.lead.findMany({ where: { stage: "TOUR_SCHEDULED", tourAt: { gte: now } }, orderBy: { tourAt: "asc" }, take: 5 }),
      prisma.child.findMany({ where: { immunizationsDue: { lte: addDays(now, 30) } }, include: { family: true } }),
      prisma.integration.findMany(),
      prisma.center.findUnique({ where: { id: "center" } }),
    ]);

  const pendingReleases = await prisma.pickupRelease.count({ where: { status: "PENDING" } });
  const capacity = rooms.reduce((a, r) => a + r.capacity, 0);
  const pl = profitAndLoss(mtd);
  const overdue = aging.grandTotal - aging.totals.Current;
  const staffOn = await prisma.staffShift.groupBy({ by: ["classroomId"], where: { clockOutAt: null }, _count: true });
  const leadCount = (s: string) => leads.find((l) => l.stage === s)?._count ?? 0;

  return (
    <Page wide>
      <PageHeader title={center?.name ?? "Dashboard"} subtitle={`${formatDay(now)} · month to date`} />

      {pendingReleases > 0 && (
        <Link href="/attendance" className="mb-6 block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100">
          ⚠️ {pendingReleases} pickup {pendingReleases === 1 ? "release needs" : "releases need"} director approval →
        </Link>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occupancy" value={`${capacity ? Math.round((enrolled / capacity) * 100) : 0}%`} hint={`${enrolled} of ${capacity} seats enrolled`} />
        <Stat label="Revenue (MTD)" value={formatCents(pl.totalRevenue)} hint={`Net income ${formatCents(pl.netIncome)}`} />
        <Stat label="Collected (MTD)" value={formatCents(payments._sum.amountCents ?? 0)} />
        <Stat
          label="A/R outstanding"
          value={formatCents(aging.grandTotal)}
          hint={`${formatCents(overdue)} past due`}
          tone={overdue > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Books health" className="lg:col-span-1">
          <ul className="space-y-3 text-sm">
            <HealthRow ok={arRec.difference === 0} label="A/R sub-ledger ties to general ledger" detail={formatCents(arRec.gl)} />
            <HealthRow ok={udRec.difference === 0} label="Undeposited funds tie to pending payments" detail={formatCents(udRec.gl)} />
            <HealthRow
              ok={Boolean(center?.lockDate)}
              warnOnly
              label={center?.lockDate ? `Books closed through ${formatDay(center.lockDate)}` : "No closed period yet"}
            />
            {(["QUICKBOOKS", "XERO"] as const).map((p) => {
              const i = integrations.find((x) => x.provider === p);
              if (!i?.accessTokenEnc) return null;
              return (
                <HealthRow
                  key={p}
                  ok={!i.lastError}
                  label={`${PROVIDER_LABELS[p]} sync`}
                  detail={i.lastError ? "error" : i.lastSyncAt ? `last ${i.lastSyncAt.toLocaleString()}` : "not yet run"}
                />
              );
            })}
          </ul>
          <Link href="/accounting" className={`mt-4 inline-block text-sm ${linkCls}`}>
            Financial reports →
          </Link>
        </Card>

        <Card title="A/R aging" className="lg:col-span-2" flush actions={<Link href="/billing" className={`text-sm ${linkCls}`}>Receivables →</Link>}>
          <table className="w-full">
            <thead>
              <tr>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className={thRight}>{b}</th>
                ))}
                <th className={thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className={trCls}>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={`${tdRight} ${b !== "Current" && aging.totals[b] > 0 ? "text-amber-700" : ""}`}>
                    {formatCents(aging.totals[b])}
                  </td>
                ))}
                <td className={`${tdRight} font-semibold`}>{formatCents(aging.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500">
            {aging.rows.filter((r) => r.total - r.buckets.Current > 0).length} payers have past-due balances.
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Classrooms right now" flush className="lg:col-span-2">
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Room</th>
                <th className={thRight}>Present</th>
                <th className={thRight}>Staff</th>
                <th className={thRight}>Ratio</th>
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => {
                const kids = present.filter((a) => a.classroomId === r.id).length;
                const staff = staffOn.find((s) => s.classroomId === r.id)?._count ?? 0;
                const needed = Math.ceil(kids / r.ratio);
                return (
                  <tr key={r.id} className={trCls}>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdRight}>{kids} / {r.capacity}</td>
                    <td className={tdRight}>{staff}</td>
                    <td className={tdRight}>1:{r.ratio}</td>
                    <td className={tdCls}>
                      {kids === 0 ? (
                        <Badge>Empty</Badge>
                      ) : staff >= needed ? (
                        <Badge tone="green">In ratio</Badge>
                      ) : (
                        <Badge tone="red">Needs {needed - staff} more staff</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Enrollment pipeline" actions={<Link href="/leads" className={`text-sm ${linkCls}`}>Leads →</Link>}>
          <div className="space-y-2">
            {STAGES.map((s) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600">{s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                <span className="font-semibold tabular-nums">{leadCount(s)}</span>
              </div>
            ))}
          </div>
          {tours.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-3">
              <div className="mb-1 text-xs font-semibold uppercase text-zinc-500">Upcoming tours</div>
              {tours.map((t) => (
                <Link key={t.id} href={`/leads/${t.id}`} className="block text-sm text-zinc-700 hover:underline">
                  {t.parentName} · {t.tourAt?.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {immunizations.length > 0 && (
        <Card title="Compliance alerts" className="mt-6">
          <ul className="space-y-1 text-sm">
            {immunizations.map((c) => (
              <li key={c.id}>
                <Badge tone="amber">Immunizations</Badge>{" "}
                <Link href={`/families/${c.familyId}`} className={linkCls}>
                  {c.firstName} {c.lastName}
                </Link>{" "}
                due {formatDay(c.immunizationsDue)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}

function HealthRow({ ok, label, detail, warnOnly }: { ok: boolean; label: string; detail?: string; warnOnly?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
          ok ? "bg-emerald-600" : warnOnly ? "bg-amber-500" : "bg-red-600"
        }`}
      >
        {ok ? "✓" : "!"}
      </span>
      <span className="flex-1 text-zinc-700">
        {label}
        {detail && <span className="block text-xs text-zinc-500">{detail}</span>}
      </span>
    </li>
  );
}
