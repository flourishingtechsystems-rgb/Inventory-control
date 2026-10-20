"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { CLASSROOM, STAFF } from "@/lib/roles";
import { str, toActionError, type ActionState } from "@/lib/actions";
import { today } from "@/lib/dates";

function refresh() {
  revalidatePath("/attendance");
  revalidatePath("/classrooms");
  revalidatePath("/dashboard");
}

export async function checkIn(childId: string) {
  const user = await requireRole(CLASSROOM);
  const child = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
  if (!child.classroomId) throw new Error("Assign the child to a classroom first.");
  await prisma.attendance.upsert({
    where: { childId_day: { childId, day: today() } },
    update: { checkOutAt: null, checkOutBy: null, pickedUpBy: null },
    create: { childId, classroomId: child.classroomId, day: today(), checkInAt: new Date(), checkInBy: user.name },
  });
  refresh();
}

export async function checkOut(childId: string, formData: FormData) {
  const user = await requireRole(CLASSROOM);
  await prisma.attendance.update({
    where: { childId_day: { childId, day: today() } },
    data: { checkOutAt: new Date(), checkOutBy: user.name, pickedUpBy: str(formData, "pickedUpBy") || null },
  });
  refresh();
}

export async function clockIn(classroomId: string) {
  const user = await requireRole(CLASSROOM);
  await prisma.staffShift.updateMany({ where: { userId: user.id, clockOutAt: null }, data: { clockOutAt: new Date() } });
  await prisma.staffShift.create({ data: { userId: user.id, classroomId, clockInAt: new Date() } });
  refresh();
}

export async function clockOut() {
  const user = await requireRole(CLASSROOM);
  await prisma.staffShift.updateMany({ where: { userId: user.id, clockOutAt: null }, data: { clockOutAt: new Date() } });
  refresh();
}

export async function createClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(STAFF);
    const name = str(formData, "name");
    const capacity = Number(str(formData, "capacity"));
    const ratio = Number(str(formData, "ratio"));
    if (!name || !(capacity > 0) || !(ratio > 0)) return { error: "Name, capacity and ratio are required." };
    await prisma.classroom.create({ data: { name, ageGroup: str(formData, "ageGroup"), capacity, ratio } });
    refresh();
    return { ok: `${name} created.` };
  } catch (e) {
    return toActionError(e);
  }
}
