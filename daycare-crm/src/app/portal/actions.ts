"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { str, toActionError, type ActionState } from "@/lib/actions";
import { today } from "@/lib/dates";
import { payerLedgerBalance, recordPayment } from "@/lib/accounting/receivables";
import { isLockedOut, selfCheckIn, selfCheckOut } from "@/lib/attendance";
import { isValidPin, pinDigest, verifyCenterCode } from "@/lib/presence";

async function myPayer() {
  const user = await requireRole(["PARENT"]);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { guardian: { include: { payer: true } } } });
  if (!me.guardian?.payer) throw new Error("No billing account is linked to your login.");
  return { user, payer: me.guardian.payer };
}

// Card capture is delegated to the payment processor in production; this
// records the settled charge exactly as the processor webhook would.
export async function payBalanceAction(): Promise<ActionState> {
  let paid: number;
  try {
    const { user, payer } = await myPayer();
    const result = await prisma.$transaction(async (tx) => {
      const balance = await payerLedgerBalance(tx, payer.id);
      if (balance <= 0) return null;
      await recordPayment(tx, {
        payerId: payer.id,
        amountCents: balance,
        method: "CARD",
        receivedAt: today(),
        reference: `Parent portal${payer.paymentMethodLabel ? ` · ${payer.paymentMethodLabel}` : ""}`,
        userId: user.id,
      });
      return balance;
    });
    if (!result) return { ok: "You're all paid up." };
    paid = result;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/portal");
  redirect(`/portal?paid=${paid}`);
}

export async function toggleMyAutopay() {
  const { payer } = await myPayer();
  await prisma.payer.update({ where: { id: payer.id }, data: { autopay: !payer.autopay } });
  revalidatePath("/portal");
}

async function myGuardian() {
  const user = await requireRole(["PARENT"]);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!me.guardianId) throw new Error("No family is linked to your login.");
  return { user, guardianId: me.guardianId };
}

/** Check in/out from the parent's phone — only works with the code shown at the center. */
export async function phoneCheckAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, guardianId } = await myGuardian();
    if (await isLockedOut(prisma, user.id, "selfcheck.code_failed")) {
      return { error: "Too many incorrect codes. Please check in at the front desk." };
    }
    if (!verifyCenterCode(str(formData, "code"))) {
      await prisma.auditLog.create({ data: { userId: user.id, action: "selfcheck.code_failed", entity: "Attendance" } });
      return { error: "That code doesn't match the one at the front desk — it changes every 15 minutes." };
    }
    const [op, childId] = str(formData, "op").split(":");
    const message = await prisma.$transaction(async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId } });
      if (op === "out") {
        await selfCheckOut(tx, { guardianId, childId, via: "phone" });
        return `${child.firstName} is checked out.`;
      }
      await selfCheckIn(tx, { guardianId, childId, via: "phone" });
      return `${child.firstName} is checked in.`;
    });
    revalidatePath("/portal");
    revalidatePath("/attendance");
    return { ok: message };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setMyPinAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, guardianId } = await myGuardian();
    const pin = str(formData, "pin");
    if (pin !== str(formData, "confirm")) return { error: "PINs don't match." };
    if (!isValidPin(pin)) return { error: "Use 6 digits, not all the same and not 123456." };
    await prisma.guardian.update({ where: { id: guardianId }, data: { pinDigest: pinDigest(pin), pinSetAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: user.id, action: "kiosk.pin_set", entity: "Guardian", entityId: guardianId, detail: "by parent" } });
    revalidatePath("/portal");
    return { ok: "Your kiosk PIN is set." };
  } catch (e) {
    const result = toActionError(e);
    return result?.error === "That record already exists." ? { error: "Please choose a different PIN." } : result;
  }
}
