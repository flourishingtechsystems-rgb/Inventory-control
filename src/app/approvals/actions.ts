"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyRole, notifyUser } from "@/lib/notifications";

async function requireManager() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
    throw new Error("Not authorized");
  }
  return session.user;
}

export async function approveRequest(requestId: string) {
  const manager = await requireManager();

  const request = await prisma.orderRequest.update({
    where: { id: requestId, status: "PENDING" },
    data: { status: "APPROVED", decidedById: manager.id, decidedAt: new Date() },
    include: { requester: true, items: { include: { inventoryItem: true } } },
  });

  const summary = request.items
    .map((line) => `${line.quantity} × ${line.inventoryItem.name}`)
    .join(", ");

  await notifyUser(
    request.requesterId,
    `Your order request (${summary}) was approved by ${manager.name}.`,
    "/requests",
  );
  await notifyRole(
    "FINANCE",
    `${manager.name} approved an order for ${request.requester.name}: ${summary}.`,
    "/finance",
  );

  revalidatePath("/approvals");
}

export async function rejectRequest(requestId: string, formData: FormData) {
  const manager = await requireManager();
  const reason = (formData.get("reason") as string | null)?.trim() || null;

  const request = await prisma.orderRequest.update({
    where: { id: requestId, status: "PENDING" },
    data: {
      status: "REJECTED",
      decidedById: manager.id,
      decidedAt: new Date(),
      decisionNote: reason,
    },
    include: { requester: true },
  });

  await notifyUser(
    request.requesterId,
    `Your order request was rejected by ${manager.name}${reason ? `: ${reason}` : "."}`,
    "/requests",
  );

  revalidatePath("/approvals");
}

export async function markApprovalsRead() {
  const manager = await requireManager();
  await prisma.notification.updateMany({
    where: { userId: manager.id, read: false },
    data: { read: true },
  });
  revalidatePath("/approvals");
}
