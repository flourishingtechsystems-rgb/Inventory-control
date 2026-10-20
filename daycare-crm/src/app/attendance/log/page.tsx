import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM } from "@/lib/roles";
import { formatDay, formatDayISO, formatTime, parseDay, today } from "@/lib/dates";
import { dayLog, fullName } from "@/lib/attendance";
import { Badge, Card, Empty, Field, Page, PageHeader, Tabs, btnSecondary, inputCls, tdCls, thCls, trCls } from "@/components/ui";
import { ATTENDANCE_TABS } from "../tabs";

function duration(from: Date, to: Date | null) {
  const mins = Math.round(((to ?? new Date()).getTime() - from.getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export default async function LogPage(props: PageProps<"/attendance/log">) {
  await requireRole(CLASSROOM);
  const sp = await props.searchParams;
  const day = (typeof sp.day === "string" && parseDay(sp.day)) || today();
  const classroomId = typeof sp.room === "string" && sp.room ? sp.room : undefined;
  const [rooms, sessions] = await Promise.all([
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    dayLog(prisma, day, { classroomId }),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="Daily log"
        subtitle="Sign-in / sign-out record with every move between areas and caregivers — the record licensing inspectors ask for."
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <Field label="Day"><input type="date" name="day" defaultValue={formatDayISO(day)} className={inputCls} /></Field>
            <Field label="Room">
              <select name="room" defaultValue={classroomId ?? ""} className={inputCls}>
                <option value="">All rooms</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <button className={btnSecondary}>Show</button>
          </form>
        }
      />
      <Tabs items={ATTENDANCE_TABS} active="/attendance/log" />
      <Card
        title={`${formatDay(day)} · ${sessions.length} ${sessions.length === 1 ? "visit" : "visits"}`}
        actions={<form action="/api/exports/attendance"><input type="hidden" name="day" value={formatDayISO(day)} />{classroomId && <input type="hidden" name="room" value={classroomId} />}<button className={btnSecondary}>Download CSV</button></form>}
        flush
      >
        {sessions.length === 0 ? (
          <Empty>No check-ins on this day.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Child</th>
                <th className={thCls}>Drop-off</th>
                <th className={thCls}>Pick-up</th>
                <th className={thCls}>Time in care</th>
                <th className={thCls}>Where & with whom</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={`${trCls} align-top`}>
                  <td className={tdCls}>
                    <div className="font-medium">{fullName(s.child)}</div>
                    <div className="text-xs text-zinc-400">{s.classroom.name}</div>
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {formatTime(s.checkInAt)}
                    <div className="text-xs text-zinc-500">{s.droppedOffBy ?? "—"}</div>
                    {s.checkInBy && <div className="text-xs text-zinc-400">recorded by {s.checkInBy}</div>}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {s.checkOutAt ? (
                      <>
                        {formatTime(s.checkOutAt)}
                        <div className="text-xs text-zinc-500">{s.pickedUpBy ?? "—"}</div>
                        {s.releases.filter((r) => r.status === "APPROVED").map((r) => (
                          <div key={r.id} className="mt-1">
                            <Badge tone="amber">one-time release</Badge>
                            <div className="text-xs text-zinc-500">{r.idType} …{r.idLast4} · consent {r.consentFrom} · approved by {r.decidedBy?.name}</div>
                          </div>
                        ))}
                        {s.checkOutBy && <div className="text-xs text-zinc-400">recorded by {s.checkOutBy}</div>}
                      </>
                    ) : (
                      <Badge tone="green">still here</Badge>
                    )}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>{duration(s.checkInAt, s.checkOutAt)}</td>
                  <td className={tdCls}>
                    <ol className="space-y-0.5 text-sm">
                      {s.movements.map((m) => (
                        <li key={m.id}>
                          <span className="tabular-nums text-zinc-500">{formatTime(m.startedAt)}–{m.endedAt ? formatTime(m.endedAt) : "now"}</span>{" "}
                          <strong>{m.area.name}</strong> · {m.caregiver?.name ?? <span className="text-red-700">no caregiver</span>}
                        </li>
                      ))}
                    </ol>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
