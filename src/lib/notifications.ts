import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/types";

export async function notifyRole(role: Role, message: string, link?: string) {
  const users = await prisma.user.findMany({
    where: { role },
    select: { id: true },
  });

  if (users.length === 0) return;

  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, message, link })),
  });
}

export async function notifyUser(userId: string, message: string, link?: string) {
  await prisma.notification.create({ data: { userId, message, link } });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}
