"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE, STAFF } from "@/lib/roles";
import { optStr, str, toActionError, type ActionState } from "@/lib/actions";
import { parseDay } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";

export async function createFamily(_: ActionState, formData: FormData): Promise<ActionState> {
  let familyId: string;
  try {
    await requireRole(STAFF);
    const firstName = str(formData, "firstName");
    const lastName = str(formData, "lastName");
    if (!firstName || !lastName) return { error: "Guardian first and last name are required." };
    familyId = await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({ data: { name: str(formData, "name") || `${lastName} Family` } });
      const guardian = await tx.guardian.create({
        data: {
          familyId: family.id,
          firstName,
          lastName,
          email: optStr(formData, "email"),
          phone: optStr(formData, "phone"),
          relationship: optStr(formData, "relationship"),
          isPrimary: true,
        },
      });
      await tx.payer.create({
        data: { name: `${firstName} ${lastName}`, kind: "GUARDIAN", email: guardian.email, familyId: family.id, guardianId: guardian.id },
      });
      return family.id;
    });
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/families/${familyId}`);
}

export async function addGuardian(familyId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(STAFF);
    const firstName = str(formData, "firstName");
    const lastName = str(formData, "lastName");
    if (!firstName || !lastName) return { error: "Name is required." };
    await prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.create({
        data: {
          familyId,
          firstName,
          lastName,
          email: optStr(formData, "email"),
          phone: optStr(formData, "phone"),
          relationship: optStr(formData, "relationship"),
          canPickup: formData.get("canPickup") === "on",
        },
      });
      if (formData.get("billable") === "on") {
        await tx.payer.create({
          data: { name: `${firstName} ${lastName}`, kind: "GUARDIAN", email: guardian.email, familyId, guardianId: guardian.id },
        });
      }
    });
    revalidatePath(`/families/${familyId}`);
    return { ok: "Guardian added." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addChild(familyId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(STAFF);
    const dob = parseDay(str(formData, "dateOfBirth"));
    if (!str(formData, "firstName") || !dob) return { error: "First name and date of birth are required." };
    const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId }, include: { guardians: true } });
    await prisma.child.create({
      data: {
        familyId,
        firstName: str(formData, "firstName"),
        lastName: str(formData, "lastName") || family.guardians[0]?.lastName || "",
        dateOfBirth: dob,
        classroomId: optStr(formData, "classroomId"),
        status: str(formData, "status") === "WAITLIST" ? "WAITLIST" : "ENROLLED",
        allergies: optStr(formData, "allergies"),
        immunizationsDue: parseDay(str(formData, "immunizationsDue")),
      },
    });
    revalidatePath(`/families/${familyId}`);
    return { ok: "Child added." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function enrollChild(familyId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const childId = str(formData, "childId");
    const feePlanId = str(formData, "feePlanId");
    const startDate = parseDay(str(formData, "startDate"));
    if (!childId || !feePlanId || !startDate) return { error: "Child, plan and start date are required." };
    const discountPct = Number(str(formData, "discountPct") || "0");
    if (!(discountPct >= 0 && discountPct <= 100)) return { error: "Discount must be 0–100%." };

    const splitPayerId = optStr(formData, "splitPayerId");
    const splitKind = str(formData, "splitKind");
    const splitValueRaw = str(formData, "splitValue");
    let split: { payerId: string; kind: "FIXED" | "PERCENT"; value: number } | null = null;
    if (splitPayerId) {
      if (splitKind === "FIXED") {
        const cents = parseMoneyToCents(splitValueRaw);
        if (!cents || cents <= 0) return { error: "Enter the amount the other payer covers." };
        split = { payerId: splitPayerId, kind: "FIXED", value: cents };
      } else {
        const pct = Number(splitValueRaw);
        if (!(pct > 0 && pct < 100)) return { error: "Split percentage must be between 0 and 100." };
        split = { payerId: splitPayerId, kind: "PERCENT", value: Math.round(pct * 100) };
      }
    }

    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          childId,
          feePlanId,
          startDate,
          endDate: parseDay(str(formData, "endDate")),
          discountBps: Math.round(discountPct * 100),
          discountReason: optStr(formData, "discountReason"),
        },
      });
      await tx.child.update({ where: { id: childId }, data: { status: "ENROLLED" } });
      if (split) {
        await tx.billingSplit.create({ data: { enrollmentId: enrollment.id, ...split } });
        if (split.kind === "PERCENT") {
          // The primary payer gets the remaining percentage explicitly.
          const family = await tx.family.findUniqueOrThrow({ where: { id: familyId }, include: { payers: true, guardians: true } });
          const primary = family.guardians.find((g) => g.isPrimary);
          const primaryPayer = family.payers.find((p) => p.guardianId === primary?.id) ?? family.payers[0];
          if (primaryPayer && primaryPayer.id !== split.payerId) {
            await tx.billingSplit.create({
              data: { enrollmentId: enrollment.id, payerId: primaryPayer.id, kind: "PERCENT", value: 10_000 - split.value },
            });
          }
        }
      }
    });
    revalidatePath(`/families/${familyId}`);
    return { ok: "Enrolled. The next billing run will invoice this plan." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function endEnrollment(familyId: string, enrollmentId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const endDate = parseDay(str(formData, "endDate"));
    if (!endDate) return { error: "Pick the last day of care." };
    await prisma.enrollment.update({ where: { id: enrollmentId }, data: { endDate } });
    revalidatePath(`/families/${familyId}`);
    return { ok: "End date set — final period will be prorated." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleAutopay(familyId: string, payerId: string) {
  await requireRole(FINANCE);
  const payer = await prisma.payer.findUniqueOrThrow({ where: { id: payerId } });
  await prisma.payer.update({ where: { id: payerId }, data: { autopay: !payer.autopay } });
  revalidatePath(`/families/${familyId}`);
}

export async function postMessage(familyId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(["ADMIN", "DIRECTOR", "BOOKKEEPER", "TEACHER", "PARENT"]);
    if (user.role === "PARENT") {
      const me = await prisma.user.findUnique({ where: { id: user.id }, include: { guardian: true } });
      if (me?.guardian?.familyId !== familyId) return { error: "Not authorized" };
    }
    const body = str(formData, "body");
    if (!body) return { error: "Message is empty." };
    await prisma.message.create({ data: { familyId, authorId: user.id, body } });
    revalidatePath(`/families/${familyId}`);
    revalidatePath("/portal");
    return { ok: "Sent." };
  } catch (e) {
    return toActionError(e);
  }
}
