import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Page, PageHeader, btnSecondary, inputCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { savePlanAction } from "../actions";

export default async function PlansPage() {
  await requireRole(FINANCE);
  const [plans, rooms, revenue] = await Promise.all([
    prisma.feePlan.findMany({ include: { classroom: true, revenueAccount: true, _count: { select: { enrollments: { where: { endDate: null } } } } }, orderBy: { name: "asc" } }),
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: { type: "REVENUE", active: true }, orderBy: { code: "asc" } }),
  ]);

  const fields = (plan?: (typeof plans)[number]) => (
    <>
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <Field label="Name"><input name="name" defaultValue={plan?.name} required className={inputCls} /></Field>
      <Field label="Rate"><input name="amount" defaultValue={plan ? (plan.amountCents / 100).toFixed(2) : ""} inputMode="decimal" required className={inputCls} /></Field>
      <Field label="Billed">
        <select name="frequency" defaultValue={plan?.frequency ?? "MONTHLY"} className={inputCls}>
          <option value="MONTHLY">Monthly</option>
          <option value="WEEKLY">Weekly</option>
        </select>
      </Field>
      <Field label="Classroom (class tracking)">
        <select name="classroomId" defaultValue={plan?.classroomId ?? ""} className={inputCls}>
          <option value="">—</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Revenue account">
        <select name="revenueAccountId" defaultValue={plan?.revenueAccountId} className={inputCls}>
          {revenue.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
        </select>
      </Field>
    </>
  );

  return (
    <Page wide>
      <PageHeader title="Tuition plans" subtitle="Each plan posts to its own revenue account and classroom, so your P&L and QuickBooks/Xero classes show revenue by program." />
      <Card flush className="mb-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>Plan</th>
              <th className={thCls}>Classroom</th>
              <th className={thCls}>Revenue account</th>
              <th className={thRight}>Active enrollments</th>
              <th className={thRight}>Rate</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={`${trCls} align-top`}>
                <td className={tdCls}>{p.name}</td>
                <td className={tdCls}>{p.classroom?.name ?? "—"}</td>
                <td className={tdCls}>{p.revenueAccount.code} {p.revenueAccount.name}</td>
                <td className={tdRight}>{p._count.enrollments}</td>
                <td className={tdRight}>{formatCents(p.amountCents)}/{p.frequency === "WEEKLY" ? "wk" : "mo"}</td>
                <td className={tdCls}>
                  <details>
                    <summary className="cursor-pointer text-xs text-teal-700">Edit</summary>
                    <ActionForm action={savePlanAction} submitLabel="Save" buttonClassName={btnSecondary} className="mt-2 flex w-64 flex-col gap-2">
                      {fields(p)}
                    </ActionForm>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="New plan" className="max-w-3xl">
        <ActionForm action={savePlanAction} submitLabel="Create plan" className="grid gap-3 sm:grid-cols-2">
          {fields()}
        </ActionForm>
      </Card>
    </Page>
  );
}
