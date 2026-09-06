import { prisma } from "@/lib/prisma";
import { NewRequestForm } from "./NewRequestForm";

export default async function NewRequestPage() {
  const items = await prisma.inventoryItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, unit: true, category: true },
  });

  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.category ?? "Uncategorized";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-900">New Order Request</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        Enter a quantity for anything you need. Your manager will review it
        before it&apos;s purchased.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No inventory items are set up yet. Ask an admin to add some to the
          catalog first.
        </p>
      ) : (
        <NewRequestForm itemsByCategory={Array.from(grouped.entries())} />
      )}
    </div>
  );
}
