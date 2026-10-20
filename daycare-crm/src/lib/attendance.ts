// Drop-off, pick-up and in-center movement tracking.
//
// An Attendance row is one drop-off → pick-up session. While a child is in
// the building they always have exactly one open ChildMovement saying which
// area they are in and which caregiver is responsible for them, so "where is
// everyone right now" and the full day timeline both come straight from data.

import type { Tx } from "@/lib/prisma";
import { dayOf } from "@/lib/dates";

export class AttendanceError extends Error {}

const CAREGIVER_ROLES = ["ADMIN", "DIRECTOR", "TEACHER"] as const;

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

/** A classroom's home area, created on first use. */
export async function homeArea(tx: Tx, classroomId: string) {
  const existing = await tx.area.findUnique({ where: { classroomId } });
  if (existing) return existing;
  const room = await tx.classroom.findUniqueOrThrow({ where: { id: classroomId } });
  const taken = await tx.area.findUnique({ where: { name: room.name } });
  return tx.area.create({ data: { name: taken ? `${room.name} (room)` : room.name, classroomId } });
}

export async function openSession(tx: Tx, childId: string) {
  return tx.attendance.findFirst({
    where: { childId, checkOutAt: null },
    orderBy: { checkInAt: "desc" },
    include: { movements: { where: { endedAt: null } } },
  });
}

/** Staff currently clocked in (the only people who can be assigned children). */
export async function staffOnShift(tx: Tx) {
  const shifts = await tx.staffShift.findMany({
    where: { clockOutAt: null, user: { role: { in: [...CAREGIVER_ROLES] } } },
    include: { user: true },
    orderBy: { clockInAt: "asc" },
  });
  return shifts.map((s) => ({ id: s.user.id, name: s.user.name, classroomId: s.classroomId }));
}

async function resolveCaregiver(tx: Tx, caregiverId: string | null | undefined, classroomId: string) {
  const onShift = await staffOnShift(tx);
  if (caregiverId) {
    const match = onShift.find((s) => s.id === caregiverId);
    if (!match) {
      const user = await tx.user.findUnique({ where: { id: caregiverId } });
      throw new AttendanceError(`${user?.name ?? "That caregiver"} isn't clocked in — clock in before taking children.`);
    }
    return match.id;
  }
  // Default: whoever has been on the floor longest in the child's room.
  return onShift.find((s) => s.classroomId === classroomId)?.id ?? null;
}

async function resolveArea(tx: Tx, areaId: string | null | undefined, classroomId: string) {
  if (!areaId) return homeArea(tx, classroomId);
  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area || !area.active) throw new AttendanceError("Pick an active area.");
  return area;
}

export async function checkInChild(
  tx: Tx,
  input: {
    childId: string;
    droppedOffBy: string;
    areaId?: string | null;
    caregiverId?: string | null;
    recordedBy?: string | null;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();
  const child = await tx.child.findUniqueOrThrow({ where: { id: input.childId } });
  const name = fullName(child);
  if (!child.classroomId) throw new AttendanceError(`${name} isn't assigned to a classroom yet.`);
  if (child.status !== "ENROLLED") throw new AttendanceError(`${name} isn't currently enrolled.`);
  if (!input.droppedOffBy.trim()) throw new AttendanceError("Record who dropped the child off.");
  if (await openSession(tx, child.id)) throw new AttendanceError(`${name} is already checked in.`);

  const area = await resolveArea(tx, input.areaId, child.classroomId);
  const caregiverId = await resolveCaregiver(tx, input.caregiverId, child.classroomId);
  return tx.attendance.create({
    data: {
      childId: child.id,
      classroomId: child.classroomId,
      day: dayOf(at),
      checkInAt: at,
      droppedOffBy: input.droppedOffBy.trim(),
      checkInBy: input.recordedBy ?? null,
      movements: {
        create: { childId: child.id, areaId: area.id, caregiverId, startedAt: at, recordedBy: input.recordedBy ?? null },
      },
    },
  });
}

/** Moves one or more checked-in children to an area and/or caregiver (e.g. a whole group heading outside). */
export async function moveChildren(
  tx: Tx,
  input: {
    childIds: string[];
    areaId?: string | null;
    caregiverId?: string | null;
    recordedBy?: string | null;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();
  if (input.childIds.length === 0) throw new AttendanceError("Select at least one child.");
  if (!input.areaId && !input.caregiverId) throw new AttendanceError("Choose a new area, a new caregiver, or both.");

  const sessions = await Promise.all(input.childIds.map((id) => openSession(tx, id)));
  const missing = input.childIds.filter((_, i) => !sessions[i]);
  if (missing.length) {
    const kids = await tx.child.findMany({ where: { id: { in: missing } } });
    throw new AttendanceError(`Not checked in: ${kids.map(fullName).join(", ")}.`);
  }

  let moved = 0;
  for (const session of sessions) {
    const current = session!.movements[0];
    const area = input.areaId
      ? await resolveArea(tx, input.areaId, session!.classroomId)
      : current
        ? { id: current.areaId }
        : await homeArea(tx, session!.classroomId);
    const caregiverId = input.caregiverId
      ? await resolveCaregiver(tx, input.caregiverId, session!.classroomId)
      : (current?.caregiverId ?? null);
    if (current && current.areaId === area.id && current.caregiverId === caregiverId) continue;
    if (current) await tx.childMovement.update({ where: { id: current.id }, data: { endedAt: at } });
    await tx.childMovement.create({
      data: {
        attendanceId: session!.id,
        childId: session!.childId,
        areaId: area.id,
        caregiverId,
        startedAt: at,
        recordedBy: input.recordedBy ?? null,
      },
    });
    moved++;
  }
  return moved;
}

/** Adults allowed to collect a child: guardians marked as authorized for pickup. */
export async function authorizedPickups(tx: Tx, childId: string) {
  const child = await tx.child.findUniqueOrThrow({
    where: { id: childId },
    include: { family: { include: { guardians: { where: { canPickup: true } } } } },
  });
  return child.family.guardians.map(fullName);
}

export async function checkOutChild(
  tx: Tx,
  input: { childId: string; pickedUpBy: string; recordedBy?: string | null; at?: Date },
) {
  const at = input.at ?? new Date();
  const session = await openSession(tx, input.childId);
  if (!session) throw new AttendanceError("This child isn't checked in.");
  const allowed = await authorizedPickups(tx, input.childId);
  if (!allowed.includes(input.pickedUpBy.trim())) {
    throw new AttendanceError(
      `${input.pickedUpBy || "That person"} is not on the authorized pickup list. Authorized: ${allowed.join(", ") || "nobody — add one on the family page"}.`,
    );
  }
  await tx.childMovement.updateMany({ where: { attendanceId: session.id, endedAt: null }, data: { endedAt: at } });
  return tx.attendance.update({
    where: { id: session.id },
    data: { checkOutAt: at, pickedUpBy: input.pickedUpBy.trim(), checkOutBy: input.recordedBy ?? null },
  });
}

/** Every child in the building right now with their area and caregiver. */
export async function whereIsEveryone(tx: Tx) {
  const sessions = await tx.attendance.findMany({
    where: { checkOutAt: null },
    include: {
      child: { include: { classroom: true } },
      movements: { where: { endedAt: null }, include: { area: true, caregiver: true } },
    },
    orderBy: { checkInAt: "asc" },
  });
  return sessions.map((s) => {
    const m = s.movements[0];
    return {
      attendanceId: s.id,
      childId: s.childId,
      childName: fullName(s.child),
      classroomName: s.child.classroom?.name ?? null,
      ratio: s.child.classroom?.ratio ?? null,
      allergies: s.child.allergies,
      checkInAt: s.checkInAt,
      droppedOffBy: s.droppedOffBy,
      areaId: m?.areaId ?? null,
      areaName: m?.area.name ?? null,
      caregiverId: m?.caregiverId ?? null,
      caregiverName: m?.caregiver?.name ?? null,
      since: m?.startedAt ?? s.checkInAt,
    };
  });
}

export type Placement = { caregiverId: string | null; caregiverName: string | null; ratio: number | null };

/**
 * Children per caregiver, checked against the strictest ratio among the
 * children they hold (an infant in the group means the infant ratio applies).
 */
export function caregiverLoads(placements: Placement[]) {
  const map = new Map<string, { caregiverId: string; caregiverName: string; children: number; limit: number }>();
  let unassigned = 0;
  for (const p of placements) {
    if (!p.caregiverId) {
      unassigned++;
      continue;
    }
    const row = map.get(p.caregiverId) ?? {
      caregiverId: p.caregiverId,
      caregiverName: p.caregiverName ?? "Caregiver",
      children: 0,
      limit: Number.POSITIVE_INFINITY,
    };
    row.children++;
    if (p.ratio) row.limit = Math.min(row.limit, p.ratio);
    map.set(p.caregiverId, row);
  }
  const loads = [...map.values()]
    .map((r) => ({ ...r, overloaded: r.children > r.limit }))
    .sort((a, b) => a.caregiverName.localeCompare(b.caregiverName));
  return { loads, unassigned };
}

/** All sessions for a day with their movement timeline (licensing sign-in/out record). */
export async function dayLog(tx: Tx, day: Date, filter: { classroomId?: string; childId?: string } = {}) {
  return tx.attendance.findMany({
    where: { day, ...(filter.classroomId ? { classroomId: filter.classroomId } : {}), ...(filter.childId ? { childId: filter.childId } : {}) },
    include: {
      child: true,
      classroom: true,
      movements: { include: { area: true, caregiver: true }, orderBy: { startedAt: "asc" } },
    },
    orderBy: [{ checkInAt: "asc" }],
  });
}
