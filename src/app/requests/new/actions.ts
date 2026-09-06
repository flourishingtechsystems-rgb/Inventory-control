"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyRole } from "@/lib/notifications";

export type NewRequestState = { error?: string } | undefined;

export async function createRequest(
  _prevState: NewRequestState,
  formData: FormData,
): Promise<NewRequestState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const notes = (formData.get("notes") as string | null)?.trim() || null;

  const items = await prisma.inventoryItem.findMany({
    where: { active: true },
    select: { id: true },
  });
  const validIds = new Set(items.map((i) => i.id));

  const lines: { inventoryItemId: string; quantity: number }[] = [];
  for (const id of validIds) {
    const raw = formData.get(`qty_${id}`);
    const quantity = raw ? Number(raw) : 0;
    if (Number.isFinite(quantity) && quantity > 0) {
      lines.push({ inventoryItemId: id, quantity: Math.floor(quantity) });
    }
  }

  if (lines.length === 0) {
    return { error: "Enter a quantity for at least one item before submitting." };
  }

  const request = await prisma.orderRequest.create({
    data: {
      requesterId: session.user.id,
      notes,
      items: { create: lines },
    },
  });

  await notifyRole(
    "MANAGER",
    `${session.user.name} submitted a new order request (${lines.length} item${lines.length === 1 ? "" : "s"}).`,
    "/approvals",
  );

  redirect(`/requests?submitted=${request.id}`);
}
