import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM } from "@/lib/roles";
import { formatTime, today } from "@/lib/dates";
import { fullName, staffOnShift } from "@/lib/attendance";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Page, PageHeader, Tabs, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { ATTENDANCE_TABS } from "./tabs";
import { checkInAction, checkOutAction, clockIn, clockOutAction, moveAction } from "./actions";

export default async function AttendancePage(props: PageProps<"/attendance">) {
  const user = await requireRole(CLASSROOM);
  const sp = await props.searchParams;
  const [rooms, me, areas, onShift] = await Promise.all([
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { staffShifts: { where: { clockOutAt: null } } } }),
    prisma.area.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    staffOnShift(prisma),
  ]);
  const roomId = (typeof sp.room === "string" && sp.room) || me.classroomId || rooms[0]?.id;
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return <Page><PageHeader title="Check-in / out" subtitle="Create a classroom first." /></Page>;

  const day = today();
  const children = await prisma.child.findMany({
    where: { classroomId: room.id, status: "ENROLLED" },
    include: {
      attendance: {
        where: { day },
        orderBy: { checkInAt: "desc" },
        include: { movements: { where: { endedAt: null }, include: { area: true, caregiver: true } } },
      },
      family: { include: { guardians: true } },
    },
    orderBy: { firstName: "asc" },
  });
  const staffHere = onShift.filter((s) => s.classroomId === room.id);
  const present = children.filter((c) => c.attendance[0] && !c.attendance[0].checkOutAt).length;
  const needed = Math.ceil(present / room.ratio);
  const myShift = me.staffShifts[0];
  const myKids = await prisma.childMovement.count({ where: { caregiverId: user.id, endedAt: null } });

  const areaSelect = (placeholder: string) => (
    <select name="areaId" defaultValue="" className={inputCls} aria-label="Area">
      <option value="">{placeholder}</option>
      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
  const caregiverSelect = (placeholder: string) => (
    <select name="caregiverId" defaultValue="" className={inputCls} aria-label="Caregiver">
      <option value="">{placeholder}</option>
      {onShift.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  return (
    <Page wide>
      <PageHeader
        title={room.name}
        subtitle={`${present} in the building of ${children.length} enrolled · ratio 1:${room.ratio}`}
        actions={
          <form className="flex gap-2">
            <select name="room" defaultValue={room.id} className={inputCls}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className={btnSecondary}>Switch</button>
          </form>
        }
      />
      <Tabs items={ATTENDANCE_TABS} active="/attendance" />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card title="Room staffing">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-zinc-600">{staffHere.map((s) => s.name).join(", ") || "Nobody clocked in"}</span>
            {present === 0 ? <Badge>No children</Badge> : staffHere.length >= needed ? <Badge tone="green">In ratio</Badge> : <Badge tone="red">Need {needed - staffHere.length} more</Badge>}
          </div>
        </Card>
        <Card title="My shift">
          {myShift ? (
            <div className="flex flex-col gap-3 text-sm">
              <span>
                On since {formatTime(myShift.clockInAt)} · <strong>{myKids}</strong> {myKids === 1 ? "child" : "children"} with me
              </span>
              <ActionForm action={clockOutAction} submitLabel="Clock out" buttonClassName={btnSecondary} className="flex flex-col gap-1" />
            </div>
          ) : (
            <form action={clockIn.bind(null, room.id)} className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Not clocked in</span>
              <button className={btnPrimary}>Clock in here</button>
            </form>
          )}
        </Card>
        <Card title="Move selected children">
          <ActionForm id="bulk-move" action={moveAction} submitLabel="Move selected" buttonClassName={btnSecondary} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              {areaSelect("Same area")}
              {caregiverSelect("Same caregiver")}
            </div>
          </ActionForm>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {children.map((c) => {
          const a = c.attendance[0];
          const status = !a ? "absent" : a.checkOutAt ? "out" : "in";
          const placement = a?.movements[0];
          const authorized = c.family.guardians.filter((g) => g.canPickup);
          return (
            <div key={c.id} className={`rounded-xl border bg-white p-4 shadow-sm ${status === "in" ? "border-emerald-300" : "border-zinc-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-start gap-2">
                  {status === "in" && <input type="checkbox" name="childId" value={c.id} form="bulk-move" className="mt-1" aria-label={`Select ${c.firstName}`} />}
                  <span>
                    <span className="block font-medium">{fullName(c)}</span>
                    <span className="block text-xs text-zinc-500">
                      {status === "in" && `Dropped off ${formatTime(a!.checkInAt)}${a!.droppedOffBy ? ` by ${a!.droppedOffBy}` : ""}`}
                      {status === "out" && `Picked up ${formatTime(a!.checkOutAt)}${a!.pickedUpBy ? ` by ${a!.pickedUpBy}` : ""}`}
                      {status === "absent" && "Not here yet"}
                    </span>
                  </span>
                </label>
                {c.allergies && <Badge tone="red">Allergy</Badge>}
              </div>
              {c.allergies && <div className="mt-1 text-xs text-red-700">{c.allergies}</div>}

              {status === "in" && (
                <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-sm text-emerald-900">
                  {placement ? (
                    <>
                      📍 <strong>{placement.area.name}</strong> · {placement.caregiver ? <>with <strong>{placement.caregiver.name}</strong></> : <span className="text-red-700">no caregiver assigned</span>}
                      <span className="text-xs text-emerald-700"> since {formatTime(placement.startedAt)}</span>
                    </>
                  ) : (
                    "Location not recorded"
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {status === "in" ? (
                  <>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-teal-700">Move / hand off</summary>
                      <ActionForm action={moveAction} submitLabel="Move" buttonClassName={btnSecondary} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="childId" value={c.id} />
                        {areaSelect("Same area")}
                        {caregiverSelect("Same caregiver")}
                      </ActionForm>
                    </details>
                    <ActionForm action={checkOutAction.bind(null, c.id)} submitLabel="Check out" buttonClassName={btnSecondary} className="flex flex-col gap-2">
                      <select name="pickedUpBy" className={inputCls} aria-label="Picked up by">
                        {authorized.map((g) => <option key={g.id}>{fullName(g)}</option>)}
                      </select>
                      {authorized.length === 0 && <p className="text-xs text-red-700">No authorized pickups on file.</p>}
                    </ActionForm>
                  </>
                ) : (
                  <ActionForm action={checkInAction.bind(null, c.id)} submitLabel={status === "out" ? "Check in again" : "Check in"} className="flex flex-col gap-2">
                    <select name="droppedOffBy" className={inputCls} aria-label="Dropped off by">
                      {c.family.guardians.map((g) => <option key={g.id}>{fullName(g)}</option>)}
                      <option value="__other">Someone else…</option>
                    </select>
                    <input name="droppedOffOther" placeholder="If someone else: their name" className={inputCls} />
                    <details>
                      <summary className="cursor-pointer text-xs text-zinc-500">Area & caregiver (defaults to home room)</summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {areaSelect("Home room")}
                        {caregiverSelect("Room staff")}
                      </div>
                    </details>
                  </ActionForm>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
