"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { STAFF } from "@/lib/roles";
import { optStr, str, toActionError, type ActionState } from "@/lib/actions";
import { parseDay } from "@/lib/dates";
import type { LeadStage } from "@/generated/prisma/client";


export async function createLead(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(STAFF);
    const parentName = str(formData, "parentName");
    const childName = str(formData, "childName");
    if (!parentName || !childName) return { error: "Parent and child names are required." };
    const lead = await prisma.lead.create({
      data: {
        parentName,
        childName,
        email: optStr(formData, "email"),
        phone: optStr(formData, "phone"),
        source: optStr(formData, "source"),
        classroomId: optStr(formData, "classroomId"),
        childDob: parseDay(str(formData, "childDob")),
        desiredStart: parseDay(str(formData, "desiredStart")),
        notes: optStr(formData, "notes"),
        activities: { create: { kind: "NOTE", body: "Lead created.", userId: user.id } },
      },
    });
    revalidatePath("/leads");
    return { ok: `Added ${lead.parentName}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveLead(leadId: string, stage: LeadStage) {
  const user = await requireRole(STAFF);
  const lead = await prisma.lead.update({ where: { id: leadId }, data: { stage } });
  await prisma.leadActivity.create({
    data: { leadId, userId: user.id, kind: "STAGE", body: `Moved to ${stage.replace("_", " ").toLowerCase()}.` },
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${lead.id}`);
}

export async function scheduleTour(leadId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(STAFF);
    const when = str(formData, "tourAt");
    const tourAt = when ? new Date(when) : null;
    if (!tourAt || Number.isNaN(tourAt.getTime())) return { error: "Pick a date and time." };
    await prisma.lead.update({ where: { id: leadId }, data: { tourAt, stage: "TOUR_SCHEDULED" } });
    await prisma.leadActivity.create({
      data: { leadId, userId: user.id, kind: "TOUR", body: `Tour scheduled for ${tourAt.toLocaleString()}.` },
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Tour scheduled." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addLeadNote(leadId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(STAFF);
    const body = str(formData, "body");
    if (!body) return { error: "Write a note first." };
    await prisma.leadActivity.create({
      data: { leadId, userId: user.id, kind: str(formData, "kind") || "NOTE", body },
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Logged." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function markLost(leadId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(STAFF);
    const reason = str(formData, "lostReason");
    await prisma.lead.update({ where: { id: leadId }, data: { stage: "LOST", lostReason: reason || null } });
    await prisma.leadActivity.create({
      data: { leadId, userId: user.id, kind: "STAGE", body: `Marked lost${reason ? `: ${reason}` : ""}.` },
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Marked lost." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Converts a lead into a family, guardian, billing payer and child in one step. */
export async function convertLead(leadId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  let familyId: string;
  try {
    const user = await requireRole(STAFF);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (lead.familyId) return { error: "This lead was already converted." };
    const status = str(formData, "status") === "WAITLIST" ? "WAITLIST" : "ENROLLED";
    const [parentFirst, ...parentRest] = lead.parentName.split(" ");
    const parentLast = parentRest.join(" ") || parentFirst;
    const [childFirst, ...childRest] = lead.childName.split(" ");

    familyId = await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({ data: { name: `${parentLast} Family` } });
      const guardian = await tx.guardian.create({
        data: {
          familyId: family.id,
          firstName: parentFirst,
          lastName: parentLast,
          email: lead.email,
          phone: lead.phone,
          isPrimary: true,
        },
      });
      await tx.payer.create({
        data: { name: lead.parentName, kind: "GUARDIAN", email: lead.email, familyId: family.id, guardianId: guardian.id },
      });
      await tx.child.create({
        data: {
          familyId: family.id,
          firstName: childFirst,
          lastName: childRest.join(" ") || parentLast,
          dateOfBirth: lead.childDob ?? new Date(),
          classroomId: lead.classroomId,
          status,
        },
      });
      await tx.lead.update({ where: { id: lead.id }, data: { familyId: family.id, stage: status === "WAITLIST" ? "WAITLIST" : "ENROLLED" } });
      await tx.leadActivity.create({
        data: { leadId: lead.id, userId: user.id, kind: "STAGE", body: `Converted to family (${status.toLowerCase()}).` },
      });
      return family.id;
    });
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/families/${familyId}`);
}
