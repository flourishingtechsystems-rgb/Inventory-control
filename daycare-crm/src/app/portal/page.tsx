import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { formatDay, formatTime, today } from "@/lib/dates";
import { payerStatement } from "@/lib/accounting/statement";
import { payerLedgerBalance } from "@/lib/accounting/receivables";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Notice, Page, PageHeader, inputCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { postMessage } from "../families/actions";
import { payBalanceAction, toggleMyAutopay } from "./actions";

export default async function PortalPage(props: PageProps<"/portal">) {
  const user = await requireRole(["PARENT"]);
  const { paid } = await props.searchParams;
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: {
      guardian: {
        include: {
          payer: true,
          family: {
            include: {
              children: {
                include: {
                  classroom: true,
                  attendance: {
                    where: { day: today() },
                    orderBy: { checkInAt: "desc" },
                    include: { movements: { include: { area: true, caregiver: true }, orderBy: { startedAt: "asc" } } },
                  },
                },
              },
              messages: { include: { author: true }, orderBy: { createdAt: "desc" }, take: 15 },
            },
          },
        },
      },
    },
  });
  const guardian = me.guardian;
  if (!guardian) return <Page><PageHeader title="Welcome" subtitle="Your login isn't linked to a family yet — please contact the center." /></Page>;
  const payer = guardian.payer;
  const [balance, rows, center] = await Promise.all([
    payer ? payerLedgerBalance(prisma, payer.id) : 0,
    payer ? payerStatement(payer.id) : [],
    prisma.center.findUnique({ where: { id: "center" } }),
  ]);

  return (
    <Page>
      <PageHeader title={`Hi, ${guardian.firstName}`} subtitle={center?.name} />
      {typeof paid === "string" && Number(paid) > 0 && <Notice>Thank you! Your payment of {formatCents(Number(paid))} was received.</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {guardian.family.children.map((c) => {
              const a = c.attendance[0];
              const now = a && !a.checkOutAt ? a.movements.find((m) => !m.endedAt) : undefined;
              return (
                <Card key={c.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{c.firstName}</div>
                      <div className="text-xs text-zinc-500">{c.classroom?.name}</div>
                    </div>
                    {a && !a.checkOutAt ? (
                      <Badge tone="green">Here since {formatTime(a.checkInAt)}</Badge>
                    ) : a?.checkOutAt ? (
                      <Badge>Picked up {formatTime(a.checkOutAt)}</Badge>
                    ) : (
                      <Badge tone="amber">Not checked in</Badge>
                    )}
                  </div>
                  {now && (
                    <p className="mt-3 rounded-md bg-emerald-50 px-2 py-1.5 text-sm text-emerald-900">
                      📍 {now.area.name}{now.caregiver ? ` with ${now.caregiver.name}` : ""}
                    </p>
                  )}
                  {a && (
                    <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
                      <li>{formatTime(a.checkInAt)} dropped off by {a.droppedOffBy ?? "—"}</li>
                      {a.movements.slice(1).map((m) => (
                        <li key={m.id}>{formatTime(m.startedAt)} {m.area.name}{m.caregiver ? ` with ${m.caregiver.name}` : ""}</li>
                      ))}
                      {a.checkOutAt && <li>{formatTime(a.checkOutAt)} picked up by {a.pickedUpBy ?? "—"}</li>}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>

          {payer && (
            <Card title="Billing history" flush>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Item</th>
                    <th className={thRight}>Charge</th>
                    <th className={thRight}>Payment</th>
                    <th className={thRight}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(-15).reverse().map((r, i) => (
                    <tr key={i} className={trCls}>
                      <td className={tdDate}>{formatDay(r.date)}</td>
                      <td className={tdCls}>{r.kind} {r.reference} <span className="text-xs text-zinc-400">{r.description}</span></td>
                      <td className={tdRight}>{r.chargeCents ? formatCents(r.chargeCents) : ""}</td>
                      <td className={tdRight}>{r.creditCents ? formatCents(r.creditCents) : ""}</td>
                      <td className={tdRight}>{formatCents(r.balanceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                Need a statement for your FSA or taxes? Your center can provide one for any year; it includes provider EIN {center?.ein ?? ""}.
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {payer && (
            <Card title="Your balance">
              <div className={`text-3xl font-semibold tabular-nums ${balance > 0 ? "text-zinc-900" : "text-emerald-700"}`}>
                {balance < 0 ? `${formatCents(-balance)} credit` : formatCents(balance)}
              </div>
              <div className="mt-1 text-xs text-zinc-500">{payer.paymentMethodLabel ?? "No saved payment method"}</div>
              {balance > 0 && (
                <ActionForm action={payBalanceAction} submitLabel={`Pay ${formatCents(balance)}`} pendingLabel="Processing…" className="mt-4 flex flex-col gap-2" />
              )}
              <form action={toggleMyAutopay} className="mt-3">
                <button className="text-sm text-teal-700 hover:underline">{payer.autopay ? "Autopay is on — turn off" : "Turn on autopay"}</button>
              </form>
            </Card>
          )}
          <Card title="Messages">
            <ActionForm action={postMessage.bind(null, guardian.familyId)} submitLabel="Send" className="mb-4 flex flex-col gap-2">
              <textarea name="body" rows={2} placeholder="Message your child's teachers…" className={inputCls} />
            </ActionForm>
            <ul className="space-y-3">
              {guardian.family.messages.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="text-zinc-800">{m.body}</div>
                  <div className="text-xs text-zinc-400">{m.author.name} · {m.createdAt.toLocaleString()}</div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-center text-xs text-zinc-400">
            Questions about your bill? <Link href={`mailto:${center?.email ?? ""}`} className="underline">Email the office</Link>
          </p>
        </div>
      </div>
    </Page>
  );
}
