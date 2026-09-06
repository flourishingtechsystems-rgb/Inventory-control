import { prisma } from "@/lib/prisma";
import { NewItemForm } from "./NewItemForm";
import { toggleActive, deleteItem } from "./actions";

export default async function InventoryCatalogPage() {
  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
    include: { _count: { select: { lines: true } } },
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">
        Inventory Catalog
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        Items requesters can choose from when submitting an order.
      </p>

      <div className="mb-8">
        <NewItemForm />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Unit</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-2 text-zinc-900">{item.name}</td>
                <td className="px-4 py-2 text-zinc-600">{item.unit}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {item.category ?? "—"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.active
                        ? "bg-green-100 text-green-800"
                        : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {item.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <form action={toggleActive.bind(null, item.id, !item.active)}>
                      <button
                        type="submit"
                        className="text-xs text-zinc-600 hover:text-zinc-900"
                      >
                        {item.active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                    <form action={deleteItem.bind(null, item.id)}>
                      <button
                        type="submit"
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        {item._count.lines > 0 ? "Deactivate & remove" : "Delete"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
