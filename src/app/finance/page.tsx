import { prisma } from "@/lib/prisma";
import { markFinanceRead } from "./actions";

export default async function FinancePage() {
  const [approvedLines, recentApproved] = await Promise.all([
    prisma.orderRequestItem.findMany({
      where: { orderRequest: { status: "APPROVED" } },
      include: { inventoryItem: true, orderRequest: true },
    }),
    prisma.orderRequest.findMany({
      where: { status: "APPROVED" },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: {
        requester: true,
        decidedBy: true,
        items: { include: { inventoryItem: true } },
      },
    }),
  ]);

  type Row = {
    id: string;
    name: string;
    unit: string;
    category: string | null;
    totalQty: number;
    orderCount: number;
    lastOrdered: Date;
  };

  const byItem = new Map<string, Row>();
  for (const line of approvedLines) {
    const existing = byItem.get(line.inventoryItemId);
    if (existing) {
      existing.totalQty += line.quantity;
      existing.orderCount += 1;
      if (line.orderRequest.createdAt > existing.lastOrdered) {
        existing.lastOrdered = line.orderRequest.createdAt;
      }
    } else {
      byItem.set(line.inventoryItemId, {
        id: line.inventoryItem.id,
        name: line.inventoryItem.name,
        unit: line.inventoryItem.unit,
        category: line.inventoryItem.category,
        totalQty: line.quantity,
        orderCount: 1,
        lastOrdered: line.orderRequest.createdAt,
      });
    }
  }
  const rows = Array.from(byItem.values()).sort(
    (a, b) => b.orderCount - a.orderCount || b.totalQty - a.totalQty,
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">
          Finance Overview
        </h1>
        <form action={markFinanceRead}>
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            Mark notifications as read
          </button>
        </form>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Purchase frequency by item
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No approved orders yet — this will fill in once managers start
            approving requests.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium text-right">
                    Times ordered
                  </th>
                  <th className="px-4 py-2 font-medium text-right">
                    Total quantity
                  </th>
                  <th className="px-4 py-2 font-medium text-right">
                    Last ordered
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2 text-zinc-900">
                      {row.name}{" "}
                      <span className="text-xs text-zinc-400">
                        ({row.unit})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-500">
                      {row.category ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-900">
                      {row.orderCount}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-900">
                      {row.totalQty}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-500">
                      {row.lastOrdered.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Recently approved orders
        </h2>
        {recentApproved.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing approved yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentApproved.map((req) => (
              <li
                key={req.id}
                className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-zinc-900">
                    {req.requester.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    approved by {req.decidedBy?.name} on{" "}
                    {req.decidedAt?.toLocaleDateString()}
                  </span>
                </div>
                <span className="text-zinc-600">
                  {req.items
                    .map((l) => `${l.quantity} × ${l.inventoryItem.name}`)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
