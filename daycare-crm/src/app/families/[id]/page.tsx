import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE, STAFF } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { daysBetween, formatDay, formatDayISO, formatTime, today } from "@/lib/dates";
import { payerStatement } from "@/lib/accounting/statement";
import { payerLedgerBalance } from "@/lib/accounting/receivables";
import { ActionForm } from "@/components/ActionForm";
import { AdjustmentForm, ChargeForm, PaymentForm } from "@/components/BillingForms";
import { Badge, Card, Field, Page, PageHeader, btnSecondary, inputCls, linkCls, tdCls, tdDate, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { addChild, addGuardian, clearPinAction, endEnrollment, enrollChild, issuePinAction, postMessage, toggleAutopay } from "../actions";

function age(dob: Date) {
  const months = Math.floor(daysBetween(dob, today()) / 30.44);
  return months < 24 ? `${months} mo` : `${Math.floor(months / 12)} yrs`;
}

export default async function FamilyPage(props: PageProps<"/families/[id]">) {
  const user = await requireRole(FINANCE);
  const { id } = await props.params;
  const family = await prisma.family.findUnique({
    where: { id },
    include: {
      guardians: true,
      payers: true,
      children: {
        include: {
          classroom: true,
          attendance: {
            orderBy: { checkInAt: "desc" },
            take: 10,
            include: { movements: { where: { endedAt: null }, include: { area: true, caregiver: true } } },
          },
          enrollments: { include: { feePlan: true, splits: { include: { payer: true } } }, orderBy: { startDate: "desc" } },
        },
      },
      messages: { include: { author: true }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!family) notFound();

  const [rooms, plans, agencies, revenueAccounts, statements] = await Promise.all([
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.feePlan.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.payer.findMany({ where: { kind: { not: "GUARDIAN" } }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: { type: "REVENUE", active: true }, orderBy: { code: "asc" } }),
    Promise.all(
      family.payers.map(async (p) => ({ payer: p, rows: await payerStatement(p.id), balance: await payerLedgerBalance(prisma, p.id) })),
    ),
  ]);
  const total = statements.reduce((a, s) => a + s.balance, 0);
  const payerOptions = family.payers.map((p) => ({ id: p.id, name: p.name }));
  const splitPayers = [...family.payers, ...agencies];
  const path = `/families/${family.id}`;
  const isStaff = STAFF.includes(user.role);

  return (
    <Page wide>
      <PageHeader
        title={family.name}
        subtitle={<Link href="/families" className={linkCls}>All families</Link>}
        actions={
          <div className="text-right">
            <div className="text-xs uppercase text-zinc-500">Family balance</div>
            <div className={`text-2xl font-semibold tabular-nums ${total > 0 ? "text-amber-700" : "text-emerald-700"}`}>
              {total < 0 ? `${formatCents(-total)} credit` : formatCents(total)}
            </div>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Children & enrollments">
            <div className="space-y-5">
              {family.children.map((child) => (
                <div key={child.id} className="rounded-lg border border-zinc-100 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-900">{child.firstName} {child.lastName}</span>
                    <span className="text-xs text-zinc-500">{age(child.dateOfBirth)} · {child.classroom?.name ?? "No room"}</span>
                    <Badge tone={child.status === "ENROLLED" ? "green" : child.status === "WAITLIST" ? "amber" : "neutral"}>{child.status.toLowerCase()}</Badge>
                    {child.allergies && <Badge tone="red">Allergy: {child.allergies}</Badge>}
                    {child.immunizationsDue && <Badge tone="amber">Immunizations due {formatDay(child.immunizationsDue)}</Badge>}
                  </div>
                  <TodayLine child={child} />
                  {child.enrollments.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {child.enrollments.map((e) => (
                        <li key={e.id} className="rounded bg-zinc-50 px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <span className="font-medium">{e.feePlan.name}</span> · {formatCents(e.feePlan.amountCents)}/{e.feePlan.frequency === "WEEKLY" ? "wk" : "mo"} ·{" "}
                              {formatDay(e.startDate)} → {e.endDate ? formatDay(e.endDate) : "ongoing"}
                              {e.discountBps > 0 && <> · {e.discountBps / 100}% {e.discountReason ?? "discount"}</>}
                            </span>
                            {!e.endDate && (
                              <ActionForm action={endEnrollment.bind(null, family.id, e.id)} submitLabel="Set end date" buttonClassName={btnSecondary} className="flex items-center gap-2">
                                <input type="date" name="endDate" className={`${inputCls} w-40`} />
                              </ActionForm>
                            )}
                          </div>
                          {e.splits.length > 0 && (
                            <div className="mt-1 text-xs text-zinc-500">
                              Split billing:{" "}
                              {e.splits.map((s) => `${s.payer.name} ${s.kind === "FIXED" ? formatCents(s.value) : `${s.value / 100}%`}`).join(" · ")}
                              {e.splits.every((s) => s.kind === "FIXED") && " · remainder to primary payer"}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-teal-700">Enroll in a tuition plan</summary>
              <ActionForm action={enrollChild.bind(null, family.id)} submitLabel="Enroll" className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Child">
                  <select name="childId" className={inputCls}>
                    {family.children.map((c) => <option key={c.id} value={c.id}>{c.firstName}</option>)}
                  </select>
                </Field>
                <Field label="Plan">
                  <select name="feePlanId" className={inputCls}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatCents(p.amountCents)}</option>)}
                  </select>
                </Field>
                <Field label="Start"><input type="date" name="startDate" defaultValue={formatDayISO(today())} className={inputCls} /></Field>
                <Field label="End (optional)"><input type="date" name="endDate" className={inputCls} /></Field>
                <Field label="Discount %"><input name="discountPct" inputMode="decimal" placeholder="0" className={inputCls} /></Field>
                <Field label="Discount reason"><input name="discountReason" placeholder="Staff, scholarship…" className={inputCls} /></Field>
                <Field label="Split with (optional)">
                  <select name="splitPayerId" className={inputCls}>
                    <option value="">— primary payer pays 100% —</option>
                    {splitPayers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind !== "GUARDIAN" ? ` (${p.kind.toLowerCase()})` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Split type">
                  <select name="splitKind" className={inputCls}>
                    <option value="FIXED">Fixed amount (subsidy)</option>
                    <option value="PERCENT">Percentage (co-parent)</option>
                  </select>
                </Field>
                <Field label="Split value" hint="$ for fixed, % for percentage"><input name="splitValue" inputMode="decimal" className={inputCls} /></Field>
              </ActionForm>
            </details>
            {isStaff && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-teal-700">Add a child</summary>
                <ActionForm action={addChild.bind(null, family.id)} submitLabel="Add child" className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="First name"><input name="firstName" required className={inputCls} /></Field>
                  <Field label="Last name"><input name="lastName" className={inputCls} /></Field>
                  <Field label="Date of birth"><input type="date" name="dateOfBirth" required className={inputCls} /></Field>
                  <Field label="Classroom">
                    <select name="classroomId" className={inputCls}>
                      <option value="">—</option>
                      {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select name="status" className={inputCls}>
                      <option value="ENROLLED">Enrolled</option>
                      <option value="WAITLIST">Waitlist</option>
                    </select>
                  </Field>
                  <Field label="Immunizations due"><input type="date" name="immunizationsDue" className={inputCls} /></Field>
                  <div className="sm:col-span-3"><Field label="Allergies"><input name="allergies" className={inputCls} /></Field></div>
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Drop-off & pick-up history" flush>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Child</th>
                  <th className={thCls}>Dropped off</th>
                  <th className={thCls}>Picked up</th>
                </tr>
              </thead>
              <tbody>
                {family.children
                  .flatMap((c) => c.attendance.map((a) => ({ ...a, childName: c.firstName })))
                  .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime())
                  .slice(0, 12)
                  .map((a) => (
                    <tr key={a.id} className={trCls}>
                      <td className={tdDate}>
                        <Link href={`/attendance/log?day=${formatDayISO(a.day)}`} className={linkCls}>{formatDay(a.day)}</Link>
                      </td>
                      <td className={tdCls}>{a.childName}</td>
                      <td className={tdCls}>{formatTime(a.checkInAt)} <span className="text-xs text-zinc-500">by {a.droppedOffBy ?? "—"}</span></td>
                      <td className={tdCls}>
                        {a.checkOutAt ? <>{formatTime(a.checkOutAt)} <span className="text-xs text-zinc-500">by {a.pickedUpBy ?? "—"}</span></> : <Badge tone="green">still here</Badge>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <Card title="Account statement" flush>
            {statements.map(({ payer, rows, balance }) => (
              <div key={payer.id} className="border-b border-zinc-100 last:border-0">
                <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 text-sm">
                  <span className="font-medium">{payer.name}</span>
                  <span className="tabular-nums">Balance {formatCents(balance)}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Type</th>
                      <th className={thCls}>Description</th>
                      <th className={thRight}>Charge</th>
                      <th className={thRight}>Credit</th>
                      <th className={thRight}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(-12).map((r, i) => (
                      <tr key={i} className={trCls}>
                        <td className={tdDate}>{formatDay(r.date)}</td>
                        <td className={tdCls}>
                          {r.invoiceId ? <Link href={`/billing/invoices/${r.invoiceId}`} className={linkCls}>{r.kind} {r.reference}</Link> : `${r.kind} ${r.reference}`}
                        </td>
                        <td className={`${tdCls} max-w-xs truncate`}>{r.description}</td>
                        <td className={tdRight}>{r.chargeCents ? formatCents(r.chargeCents) : ""}</td>
                        <td className={tdRight}>{r.creditCents ? formatCents(r.creditCents) : ""}</td>
                        <td className={tdRight}>{formatCents(r.balanceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Card>

          <Card title="Billing actions">
            <div className="space-y-6">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Record payment</h3>
                <PaymentForm payers={payerOptions} returnPath={path} />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">One-off charge</h3>
                <ChargeForm payers={payerOptions} accounts={revenueAccounts.map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }))} returnPath={path} />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Credit or write-off</h3>
                <AdjustmentForm payers={payerOptions} returnPath={path} />
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Guardians & pickup">
            <ul className="space-y-3 text-sm">
              {family.guardians.map((g) => (
                <li key={g.id}>
                  <div className="font-medium">
                    {g.firstName} {g.lastName} {g.isPrimary && <Badge tone="teal">primary</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500">{[g.relationship, g.email, g.phone].filter(Boolean).join(" · ")}</div>
                  <div className="text-xs text-zinc-500">{g.canPickup ? "Authorized for pickup" : "Not authorized for pickup"}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Kiosk PIN: {g.pinSetAt ? `set ${formatDay(g.pinSetAt)}` : "not set"}
                  </div>
                  {isStaff && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <ActionForm action={issuePinAction.bind(null, family.id, g.id)} submitLabel={g.pinSetAt ? "Reset PIN" : "Issue PIN"} buttonClassName="text-xs font-medium text-teal-700 hover:underline" className="flex flex-col gap-1" />
                      {g.pinSetAt && (
                        <ActionForm action={clearPinAction.bind(null, family.id, g.id)} submitLabel="Remove PIN" buttonClassName="text-xs text-zinc-500 hover:underline" className="flex flex-col gap-1" confirm="Remove this kiosk PIN?" />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {isStaff && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-teal-700">Add guardian / pickup</summary>
                <ActionForm action={addGuardian.bind(null, family.id)} submitLabel="Add" className="mt-3 flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input name="firstName" placeholder="First" required className={inputCls} />
                    <input name="lastName" placeholder="Last" required className={inputCls} />
                  </div>
                  <input name="relationship" placeholder="Relationship" className={inputCls} />
                  <input name="email" type="email" placeholder="Email" className={inputCls} />
                  <input name="phone" placeholder="Phone" className={inputCls} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canPickup" defaultChecked /> Authorized for pickup</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billable" /> Separate billing account (split household)</label>
                </ActionForm>
              </details>
            )}
          </Card>

          <Card title="Billing accounts">
            <ul className="space-y-3 text-sm">
              {statements.map(({ payer, balance }) => (
                <li key={payer.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{payer.name}</div>
                    <div className="text-xs text-zinc-500">{payer.paymentMethodLabel ?? "No saved method"}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums">{formatCents(balance)}</div>
                    <form action={toggleAutopay.bind(null, family.id, payer.id)}>
                      <button className="text-xs text-teal-700 hover:underline">{payer.autopay ? "Autopay on — turn off" : "Turn on autopay"}</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Messages">
            <ActionForm action={postMessage.bind(null, family.id)} submitLabel="Send" className="mb-4 flex flex-col gap-2">
              <textarea name="body" rows={2} placeholder="Message the family…" className={inputCls} />
            </ActionForm>
            <ul className="space-y-3">
              {family.messages.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="text-zinc-800">{m.body}</div>
                  <div className="text-xs text-zinc-400">{m.author.name} · {m.createdAt.toLocaleString()}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function TodayLine({
  child,
}: {
  child: {
    attendance: {
      day: Date;
      checkInAt: Date;
      checkOutAt: Date | null;
      droppedOffBy: string | null;
      pickedUpBy: string | null;
      movements: { area: { name: string }; caregiver: { name: string } | null; startedAt: Date }[];
    }[];
  };
}) {
  const a = child.attendance.find((x) => x.day.getTime() === today().getTime());
  if (!a) return <p className="mt-1 text-xs text-zinc-500">Not checked in today.</p>;
  if (a.checkOutAt) {
    return (
      <p className="mt-1 text-xs text-zinc-500">
        Today: dropped off {formatTime(a.checkInAt)} by {a.droppedOffBy ?? "—"} · picked up {formatTime(a.checkOutAt)} by {a.pickedUpBy ?? "—"}
      </p>
    );
  }
  const m = a.movements[0];
  return (
    <p className="mt-1 text-xs text-emerald-800">
      Here now{m ? <> · 📍 {m.area.name}{m.caregiver ? ` with ${m.caregiver.name}` : ""} since {formatTime(m.startedAt)}</> : null} · dropped off {formatTime(a.checkInAt)} by {a.droppedOffBy ?? "—"}
    </p>
  );
}
