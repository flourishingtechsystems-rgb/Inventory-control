import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CLASSROOM } from "@/lib/roles";
import { formatDayISO, formatTime, parseDay, today } from "@/lib/dates";
import { dayLog, fullName } from "@/lib/attendance";

function cell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !CLASSROOM.includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = parseDay(req.nextUrl.searchParams.get("day") ?? "") ?? today();
  const room = req.nextUrl.searchParams.get("room") || undefined;
  const sessions = await dayLog(prisma, day, { classroomId: room });
  const rows = [["Date", "Child", "Classroom", "Drop-off time", "Dropped off by", "Pick-up time", "Picked up by", "Area", "Caregiver", "From", "To"]];
  for (const s of sessions) {
    const base = [
      formatDayISO(day),
      fullName(s.child),
      s.classroom.name,
      formatTime(s.checkInAt),
      s.droppedOffBy ?? "",
      s.checkOutAt ? formatTime(s.checkOutAt) : "",
      s.pickedUpBy ?? "",
    ];
    if (s.movements.length === 0) rows.push([...base, "", "", "", ""]);
    for (const m of s.movements) {
      rows.push([...base, m.area.name, m.caregiver?.name ?? "", formatTime(m.startedAt), m.endedAt ? formatTime(m.endedAt) : ""]);
    }
  }
  return new NextResponse(rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${formatDayISO(day)}.csv"`,
    },
  });
}
