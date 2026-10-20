"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { toActionError, type ActionState } from "@/lib/actions";
import { today } from "@/lib/dates";
import { payerLedgerBalance, recordPayment } from "@/lib/accounting/receivables";

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
