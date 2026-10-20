import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM } from "@/lib/roles";
import { today } from "@/lib/dates";
import { Badge, Card, Page, PageHeader, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { checkIn, checkOut, clockIn, clockOut } from "./actions";

const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default async function AttendancePage(props: PageProps<"/attendance">) {
  const user = await requireRole(CLASSROOM);
  const sp = await props.searchParams;
  const [rooms, me] = await Promise.all([
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { staffShifts: { where: { clockOutAt: null } } } }),
  ]);
  const roomId = (typeof sp.room === "string" && sp.room) || me.classroomId || rooms[0]?.id;
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return <Page><PageHeader title="Check-in / out" subtitle="Create a classroom first." /></Page>;

  const day = today();
  const [children, staffOn] = await Promise.all([
    prisma.child.findMany({
      where: { classroomId: room.id, status: "ENROLLED" },
      include: { attendance: { where: { day } }, family: { include: { guardians: { where: { canPickup: true } } } } },
      orderBy: { firstName: "asc" },
    }),
    prisma.staffShift.findMany({ where: { classroomId: room.id, clockOutAt: null }, include: { user: true } }),
  ]);
  const present = children.filter((c) => c.attendance[0] && !c.attendance[0].checkOutAt).length;
  const needed = Math.ceil(present / room.ratio);
  const myShift = me.staffShifts[0];

  return (
    <Page>
      <PageHeader
        title={room.name}
        subtitle={`${present} present of ${children.length} enrolled · ratio 1:${room.ratio}`}
        actions={
          <form className="flex gap-2">
            <select name="room" defaultValue={room.id} className={inputCls}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className={btnSecondary}>Switch</button>
          </form>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card title="Ratio">
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-600">
              {staffOn.length} staff on the floor: {staffOn.map((s) => s.user.name).join(", ") || "none"}
            </div>
            {present === 0 ? <Badge>No children</Badge> : staffOn.length >= needed ? <Badge tone="green">In ratio</Badge> : <Badge tone="red">Out of ratio — need {needed - staffOn.length}</Badge>}
          </div>
        </Card>
        <Card title="My shift">
          {myShift ? (
            <form action={clockOut} className="flex items-center justify-between text-sm">
              <span>Clocked in {time(myShift.clockInAt)} · {rooms.find((r) => r.id === myShift.classroomId)?.name}</span>
              <button className={btnSecondary}>Clock out</button>
            </form>
          ) : (
            <form action={clockIn.bind(null, room.id)} className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Not clocked in</span>
              <button className={btnPrimary}>Clock in here</button>
            </form>
          )}
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((c) => {
          const a = c.attendance[0];
          const status = !a ? "absent" : a.checkOutAt ? "out" : "in";
          return (
            <div key={c.id} className={`rounded-xl border bg-white p-4 shadow-sm ${status === "in" ? "border-emerald-300" : "border-zinc-200"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{c.firstName} {c.lastName}</div>
                  <div className="text-xs text-zinc-500">
                    {status === "in" && `In since ${time(a!.checkInAt)}`}
                    {status === "out" && `Picked up ${time(a!.checkOutAt!)}${a!.pickedUpBy ? ` by ${a!.pickedUpBy}` : ""}`}
                    {status === "absent" && "Not here yet"}
                  </div>
                </div>
                {c.allergies && <Badge tone="red">Allergy</Badge>}
              </div>
              {c.allergies && <div className="mt-1 text-xs text-red-700">{c.allergies}</div>}
              <div className="mt-3">
                {status === "in" ? (
                  <form action={checkOut.bind(null, c.id)} className="flex gap-2">
                    <select name="pickedUpBy" className={inputCls} aria-label="Picked up by">
                      {c.family.guardians.map((g) => (
                        <option key={g.id}>{g.firstName} {g.lastName}</option>
                      ))}
                    </select>
                    <button className={btnSecondary}>Check out</button>
                  </form>
                ) : (
                  <form action={checkIn.bind(null, c.id)}>
                    <button className={`${btnPrimary} w-full`}>{status === "out" ? "Check in again" : "Check in"}</button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
