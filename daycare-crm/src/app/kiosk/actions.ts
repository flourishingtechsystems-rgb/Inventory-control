"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { KIOSK_OPERATORS } from "@/lib/roles";
import { AttendanceError, guardianChildren, isLockedOut, selfCheckIn, selfCheckOut } from "@/lib/attendance";
import { isValidPin, pinDigest, signKioskToken, verifyKioskToken } from "@/lib/presence";

export type KioskChild = { id: string; firstName: string; classroomName: string; checkedIn: boolean };
export type KioskState =
  | { stage: "pin"; error?: string }
  | { stage: "family"; token: string; guardianName: string; canPickup: boolean; children: KioskChild[]; message?: string; error?: string };

async function familyState(guardianId: string, extra: { message?: string; error?: string } = {}): Promise<KioskState> {
  const { guardian, children } = await guardianChildren(prisma, guardianId);
  return {
    stage: "family",
    token: signKioskToken(guardianId),
    guardianName: guardian.firstName,
    canPickup: guardian.canPickup,
    children: children.map(({ id, firstName, classroomName, checkedIn }) => ({ id, firstName, classroomName, checkedIn })),
    ...extra,
  };
}

export async function kioskEnterPin(pin: string): Promise<KioskState> {
  const kiosk = await requireRole(KIOSK_OPERATORS);
  if (await isLockedOut(prisma, kiosk.id, "kiosk.pin_failed")) {
    return { stage: "pin", error: "Too many incorrect PINs. Please see the front desk." };
  }
  const guardian = isValidPin(pin) ? await prisma.guardian.findUnique({ where: { pinDigest: pinDigest(pin) } }) : null;
  if (!guardian) {
    await prisma.auditLog.create({ data: { userId: kiosk.id, action: "kiosk.pin_failed", entity: "Kiosk" } });
    return { stage: "pin", error: "PIN not recognized. Try again." };
  }
  return familyState(guardian.id);
}

export async function kioskToggle(token: string, childId: string): Promise<KioskState> {
  await requireRole(KIOSK_OPERATORS);
  const guardianId = verifyKioskToken(token);
  if (!guardianId) return { stage: "pin", error: "Session timed out — enter your PIN again." };
  try {
    const message = await prisma.$transaction(async (tx) => {
      const open = await tx.attendance.findFirst({ where: { childId, checkOutAt: null }, include: { child: true } });
      if (open) {
        await selfCheckOut(tx, { guardianId, childId, via: "kiosk" });
        return `${open.child.firstName} is checked out. Have a great evening!`;
      }
      const att = await selfCheckIn(tx, { guardianId, childId, via: "kiosk" });
      const child = await tx.child.findUniqueOrThrow({ where: { id: att.childId } });
      return `${child.firstName} is checked in. Have a great day!`;
    });
    revalidatePath("/attendance");
    revalidatePath("/attendance/live");
    return familyState(guardianId, { message });
  } catch (e) {
    if (e instanceof AttendanceError) return familyState(guardianId, { error: e.message });
    throw e;
  }
}
