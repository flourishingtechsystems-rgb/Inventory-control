"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function markFinanceRead() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "FINANCE" && session.user.role !== "ADMIN")) {
    throw new Error("Not authorized");
  }
  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/finance");
}
