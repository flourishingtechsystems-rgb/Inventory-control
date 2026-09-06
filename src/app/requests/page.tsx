import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";

export default async function MyRequestsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const requests = await prisma.orderRequest.findMany({
    where: { requesterId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      items: { include: { inventoryItem: true } },
      decidedBy: true,
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">My Requests</h1>
        <Link
          href="/requests/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-zinc-500">
          You haven&apos;t submitted any requests yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((req) => (
            <li
              key={req.id}
              className="rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  {req.createdAt.toLocaleString()}
                </p>
                <StatusBadge status={req.status} />
              </div>
              <ul className="text-sm text-zinc-800">
                {req.items.map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.inventoryItem.name} (
                    {line.inventoryItem.unit})
                  </li>
                ))}
              </ul>
              {req.notes && (
                <p className="mt-2 text-sm italic text-zinc-500">
                  &ldquo;{req.notes}&rdquo;
                </p>
              )}
              {req.status !== "PENDING" && req.decidedBy && (
                <p className="mt-2 text-xs text-zinc-500">
                  {req.status === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                  {req.decidedBy.name}
                  {req.decidedAt ? ` on ${req.decidedAt.toLocaleDateString()}` : ""}
                  {req.decisionNote ? ` — ${req.decisionNote}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
