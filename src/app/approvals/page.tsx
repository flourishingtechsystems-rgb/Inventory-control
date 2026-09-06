import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { approveRequest, rejectRequest, markApprovalsRead } from "./actions";

export default async function ApprovalsPage() {
  const [pending, recentDecided] = await Promise.all([
    prisma.orderRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { requester: true, items: { include: { inventoryItem: true } } },
    }),
    prisma.orderRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: { requester: true, decidedBy: true, items: { include: { inventoryItem: true } } },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">
          Pending Approvals
        </h1>
        <form action={markApprovalsRead}>
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            Mark notifications as read
          </button>
        </form>
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing waiting on your review right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((req) => (
            <li
              key={req.id}
              className="rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-900">
                  {req.requester.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {req.createdAt.toLocaleString()}
                </p>
              </div>
              <ul className="mb-3 text-sm text-zinc-800">
                {req.items.map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.inventoryItem.name} (
                    {line.inventoryItem.unit})
                  </li>
                ))}
              </ul>
              {req.notes && (
                <p className="mb-3 text-sm italic text-zinc-500">
                  &ldquo;{req.notes}&rdquo;
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <form action={approveRequest.bind(null, req.id)}>
                  <button
                    type="submit"
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                  >
                    Approve
                  </button>
                </form>
                <form
                  action={rejectRequest.bind(null, req.id)}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    name="reason"
                    placeholder="Reason (optional)"
                    className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {recentDecided.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            Recently decided
          </h2>
          <ul className="flex flex-col gap-2">
            {recentDecided.map((req) => (
              <li
                key={req.id}
                className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm"
              >
                <span className="text-zinc-700">
                  {req.requester.name} —{" "}
                  {req.items
                    .map((l) => `${l.quantity} × ${l.inventoryItem.name}`)
                    .join(", ")}
                </span>
                <StatusBadge status={req.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
