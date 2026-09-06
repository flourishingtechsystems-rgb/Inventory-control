"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Not authorized");
  }
  return session.user;
}

export type ItemFormState = { error?: string } | undefined;

export async function createItem(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  await requireAdmin();

  const name = (formData.get("name") as string | null)?.trim();
  const unit = (formData.get("unit") as string | null)?.trim();
  const category = (formData.get("category") as string | null)?.trim() || null;

  if (!name || !unit) {
    return { error: "Name and unit are required." };
  }

  try {
    await prisma.inventoryItem.create({ data: { name, unit, category } });
  } catch {
    return { error: `"${name}" (${unit}) already exists in the catalog.` };
  }

  revalidatePath("/admin/items");
}

export async function toggleActive(itemId: string, active: boolean) {
  await requireAdmin();
  await prisma.inventoryItem.update({
    where: { id: itemId },
    data: { active },
  });
  revalidatePath("/admin/items");
}

export async function deleteItem(itemId: string) {
  await requireAdmin();
  const usageCount = await prisma.orderRequestItem.count({
    where: { inventoryItemId: itemId },
  });
  if (usageCount > 0) {
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { active: false },
    });
  } else {
    await prisma.inventoryItem.delete({ where: { id: itemId } });
  }
  revalidatePath("/admin/items");
}
