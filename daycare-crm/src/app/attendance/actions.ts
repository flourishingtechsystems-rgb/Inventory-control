"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { APPROVERS, CLASSROOM, STAFF } from "@/lib/roles";
import { optStr, str, toActionError, type ActionState } from "@/lib/actions";
import { checkInChild, checkOutChild, decideRelease, moveChildren, requestRelease } from "@/lib/attendance";

function refresh() {
  for (const p of ["/attendance", "/attendance/live", "/attendance/log", "/classrooms", "/dashboard", "/portal"]) revalidatePath(p);
}

export async function checkInAction(childId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(CLASSROOM);
    const choice = str(formData, "droppedOffBy");
    const droppedOffBy = choice === "__other" ? str(formData, "droppedOffOther") : choice;
    await prisma.$transaction((tx) =>
      checkInChild(tx, {
        childId,
        droppedOffBy,
        areaId: optStr(formData, "areaId"),
        caregiverId: optStr(formData, "caregiverId"),
        recordedBy: user.name,
      }),
    );
    refresh();
    return { ok: "Checked in." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkOutAction(childId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(CLASSROOM);
    await prisma.$transaction((tx) =>
      checkOutChild(tx, { childId, pickedUpBy: str(formData, "pickedUpBy"), recordedBy: user.name }),
    );
    refresh();
    return { ok: "Checked out." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Moves one child (card form) or a selected group (bulk bar) to an area and/or caregiver. */
export async function moveAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(CLASSROOM);
    const childIds = formData.getAll("childId").filter((v): v is string => typeof v === "string" && v !== "");
    const moved = await prisma.$transaction((tx) =>
      moveChildren(tx, {
        childIds,
        areaId: optStr(formData, "areaId"),
        caregiverId: optStr(formData, "caregiverId"),
        recordedBy: user.name,
      }),
    );
    refresh();
    return { ok: moved ? `Moved ${moved} ${moved === 1 ? "child" : "children"}.` : "Already there." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function clockIn(classroomId: string) {
  const user = await requireRole(CLASSROOM);
  await prisma.$transaction(async (tx) => {
    await tx.staffShift.updateMany({ where: { userId: user.id, clockOutAt: null }, data: { clockOutAt: new Date() } });
    await tx.staffShift.create({ data: { userId: user.id, classroomId, clockInAt: new Date() } });
  });
  refresh();
}

export async function clockOutAction(): Promise<ActionState> {
  try {
    const user = await requireRole(CLASSROOM);
    // Nobody leaves the floor while children are still assigned to them.
    const assigned = await prisma.childMovement.count({ where: { caregiverId: user.id, endedAt: null } });
    if (assigned > 0) {
      return { error: `You still have ${assigned} ${assigned === 1 ? "child" : "children"} assigned — hand them off to another caregiver first.` };
    }
    await prisma.staffShift.updateMany({ where: { userId: user.id, clockOutAt: null }, data: { clockOutAt: new Date() } });
    refresh();
    return { ok: "Clocked out." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(STAFF);
    const name = str(formData, "name");
    const capacity = Number(str(formData, "capacity"));
    const ratio = Number(str(formData, "ratio"));
    if (!name || !(capacity > 0) || !(ratio > 0)) return { error: "Name, capacity and ratio are required." };
    await prisma.$transaction(async (tx) => {
      const room = await tx.classroom.create({ data: { name, ageGroup: str(formData, "ageGroup"), capacity, ratio } });
      const taken = await tx.area.findUnique({ where: { name } });
      await tx.area.create({ data: { name: taken ? `${name} (room)` : name, classroomId: room.id } });
    });
    refresh();
    return { ok: `${name} created.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createArea(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(STAFF);
    const name = str(formData, "name");
    if (!name) return { error: "Name the area." };
    await prisma.area.create({ data: { name } });
    refresh();
    return { ok: `${name} added.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleArea(areaId: string) {
  await requireRole(STAFF);
  const area = await prisma.area.findUniqueOrThrow({ where: { id: areaId } });
  if (area.classroomId) return;
  await prisma.area.update({ where: { id: areaId }, data: { active: !area.active } });
  refresh();
}

export async function requestReleaseAction(childId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(CLASSROOM);
    const release = await prisma.$transaction((tx) =>
      requestRelease(tx, {
        childId,
        personName: str(formData, "personName"),
        relationship: str(formData, "relationship"),
        idType: str(formData, "idType"),
        idNumber: str(formData, "idNumber"),
        consentFrom: str(formData, "consentFrom"),
        consentMethod: str(formData, "consentMethod"),
        notes: optStr(formData, "notes"),
        actor: user,
      }),
    );
    refresh();
    return release.status === "APPROVED"
      ? { ok: "Approved and released. The family has been notified." }
      : { ok: "Sent to a director for approval — keep the child with staff until it's approved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideReleaseAction(releaseId: string, approve: boolean, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(APPROVERS);
    await prisma.$transaction((tx) => decideRelease(tx, { releaseId, approve, note: optStr(formData, "note"), actor: user }));
    refresh();
    return { ok: approve ? "Approved — child released and family notified." : "Denied. The child stays in care." };
  } catch (e) {
    return toActionError(e);
  }
}
