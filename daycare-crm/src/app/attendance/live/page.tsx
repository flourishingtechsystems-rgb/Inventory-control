import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM } from "@/lib/roles";
import { formatTime } from "@/lib/dates";
import { caregiverLoads, staffOnShift, whereIsEveryone } from "@/lib/attendance";
import { Badge, Card, Page, PageHeader, Stat, Tabs, linkCls } from "@/components/ui";
import { ATTENDANCE_TABS } from "../tabs";

export default async function LivePage() {
  const user = await requireRole(CLASSROOM);
  const [kids, areas, onShift] = await Promise.all([
    whereIsEveryone(prisma),
    prisma.area.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    staffOnShift(prisma),
  ]);
  const { loads, unassigned } = caregiverLoads(kids);
  const overloaded = loads.filter((l) => l.overloaded);
  const occupied = areas.filter((a) => kids.some((k) => k.areaId === a.id));
  const unknown = kids.filter((k) => !k.areaId);

  return (
    <Page wide>
      <PageHeader title="Where is everyone" subtitle={`Live as of ${formatTime(new Date())} — every child in the building, the area they're in and who's responsible for them.`} />
      <Tabs items={ATTENDANCE_TABS} active="/attendance/live" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Children in building" value={kids.length} />
        <Stat label="Staff on shift" value={onShift.length} />
        <Stat label="Areas in use" value={occupied.length} />
        <Stat
          label="Needs attention"
          value={overloaded.length + unassigned + unknown.length}
          hint={`${overloaded.length} over ratio · ${unassigned} without caregiver`}
          tone={overloaded.length + unassigned + unknown.length ? "bad" : "good"}
        />
      </div>

      <Card title="Caregiver load" className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loads.map((l) => (
            <span
              key={l.caregiverId}
              className={`rounded-lg border px-3 py-2 text-sm ${l.overloaded ? "border-red-300 bg-red-50 text-red-800" : "border-zinc-200 bg-zinc-50"} ${l.caregiverId === user.id ? "ring-2 ring-teal-600" : ""}`}
            >
              <strong>{l.caregiverName}</strong> · {l.children} {l.children === 1 ? "child" : "children"}
              {Number.isFinite(l.limit) && <span className="text-xs"> (max {l.limit})</span>}
              {l.overloaded && <> · <strong>over ratio</strong></>}
            </span>
          ))}
          {onShift.filter((s) => !loads.some((l) => l.caregiverId === s.id)).map((s) => (
            <span key={s.id} className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500">{s.name} · free</span>
          ))}
          {loads.length === 0 && onShift.length === 0 && <span className="text-sm text-zinc-500">No staff clocked in.</span>}
        </div>
        <p className="mt-3 text-xs text-zinc-500">Each caregiver&apos;s limit is the strictest classroom ratio among the children with them — one infant in a mixed group sets the infant ratio.</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {occupied.map((area) => {
          const here = kids.filter((k) => k.areaId === area.id);
          const groups = new Map<string, typeof here>();
          for (const k of here) groups.set(k.caregiverName ?? "", [...(groups.get(k.caregiverName ?? "") ?? []), k]);
          return (
            <Card key={area.id} title={`📍 ${area.name}`} actions={<Badge tone="teal">{here.length}</Badge>}>
              <div className="space-y-3">
                {[...groups].map(([caregiver, list]) => (
                  <div key={caregiver}>
                    <div className="mb-1 text-xs font-semibold uppercase text-zinc-500">
                      {caregiver ? `With ${caregiver}` : <span className="text-red-700">No caregiver assigned</span>}
                    </div>
                    <ul className="space-y-1 text-sm">
                      {list.map((k) => (
                        <li key={k.childId} className="flex justify-between gap-2">
                          <span>
                            {k.childName} {k.allergies && <Badge tone="red">allergy</Badge>}
                            <span className="text-xs text-zinc-400"> {k.classroomName}</span>
                          </span>
                          <span className="text-xs text-zinc-500">since {formatTime(k.since)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
        {unknown.length > 0 && (
          <Card title="Location not recorded">
            <ul className="text-sm">
              {unknown.map((k) => <li key={k.childId}>{k.childName}</li>)}
            </ul>
          </Card>
        )}
      </div>
      {kids.length === 0 && <p className="text-sm text-zinc-500">Nobody is checked in. <Link href="/attendance" className={linkCls}>Go to check-in</Link></p>}
    </Page>
  );
}
