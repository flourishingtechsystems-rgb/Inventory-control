"use server";

import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
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

export type ImportState = { error?: string; success?: string } | undefined;

type CsvRow = { name?: string; unit?: string; category?: string };

export async function importItemsCsv(
  _prevState: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload." };
  }

  const text = await file.text();
  let rows: CsvRow[];
  try {
    rows = parse(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  } catch (e) {
    return { error: `Could not parse CSV: ${(e as Error).message}` };
  }

  if (rows.length === 0) {
    return { error: "The CSV file has no data rows." };
  }

  let created = 0;
  let updated = 0;
  const rowErrors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const name = row.name?.trim();
    const unit = row.unit?.trim();
    const category = row.category?.trim() || null;

    if (!name || !unit) {
      rowErrors.push(`Row ${index + 2}: name and unit are required.`);
      continue;
    }

    const existing = await prisma.inventoryItem.findUnique({
      where: { name_unit: { name, unit } },
    });

    if (existing) {
      await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: { category, active: true },
      });
      updated += 1;
    } else {
      await prisma.inventoryItem.create({ data: { name, unit, category } });
      created += 1;
    }
  }

  revalidatePath("/admin/items");

  const summary = `Imported ${created + updated} item${created + updated === 1 ? "" : "s"} (${created} added, ${updated} updated).`;
  if (rowErrors.length > 0) {
    return {
      error: `${summary} ${rowErrors.length} row${rowErrors.length === 1 ? "" : "s"} skipped: ${rowErrors.join(" ")}`,
    };
  }
  return { success: summary };
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
