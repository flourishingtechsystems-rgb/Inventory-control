import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM, STAFF } from "@/lib/roles";
import { today } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, inputCls, linkCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { createClassroom } from "../attendance/actions";

export default async function ClassroomsPage() {
  const user = await requireRole(CLASSROOM);
  const day = today();
  const rooms = await prisma.classroom.findMany({
    include: {
      children: { where: { status: { in: ["ENROLLED", "WAITLIST"] } } },
      attendance: { where: { day, checkOutAt: null } },
      staffShifts: { where: { clockOutAt: null } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <Page>
      <PageHeader title="Rooms & ratios" subtitle="Live headcount and staffing against each room's licensing ratio." />
      <Card flush>
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Room</th>
              <th className={thCls}>Ages</th>
              <th className={thRight}>Enrolled</th>
              <th className={thRight}>Waitlist</th>
              <th className={thRight}>Open seats</th>
              <th className={thRight}>Present</th>
              <th className={thRight}>Staff</th>
              <th className={thCls}>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const enrolled = r.children.filter((c) => c.status === "ENROLLED").length;
              const waitlist = r.children.length - enrolled;
              const present = r.attendance.length;
              const needed = Math.ceil(present / r.ratio);
              return (
                <tr key={r.id} className={trCls}>
                  <td className={tdCls}><Link href={`/attendance?room=${r.id}`} className={linkCls}>{r.name}</Link></td>
                  <td className={tdCls}>{r.ageGroup}</td>
                  <td className={tdRight}>{enrolled} / {r.capacity}</td>
                  <td className={tdRight}>{waitlist}</td>
                  <td className={`${tdRight} ${r.capacity - enrolled > 0 ? "text-emerald-700" : "text-zinc-400"}`}>{Math.max(0, r.capacity - enrolled)}</td>
                  <td className={tdRight}>{present}</td>
                  <td className={tdRight}>{r.staffShifts.length}</td>
                  <td className={tdCls}>
                    1:{r.ratio}{" "}
                    {present > 0 && (r.staffShifts.length >= needed ? <Badge tone="green">ok</Badge> : <Badge tone="red">short {needed - r.staffShifts.length}</Badge>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {STAFF.includes(user.role) && (
        <Card title="New classroom" className="mt-6 max-w-2xl">
          <ActionForm action={createClassroom} submitLabel="Create" className="grid gap-3 sm:grid-cols-4">
            <Field label="Name"><input name="name" required className={inputCls} /></Field>
            <Field label="Age group"><input name="ageGroup" className={inputCls} /></Field>
            <Field label="Capacity"><input name="capacity" type="number" min={1} required className={inputCls} /></Field>
            <Field label="Children per staff"><input name="ratio" type="number" min={1} required className={inputCls} /></Field>
          </ActionForm>
        </Card>
      )}
    </Page>
  );
}
