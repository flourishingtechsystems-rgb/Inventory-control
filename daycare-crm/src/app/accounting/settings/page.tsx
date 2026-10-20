import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatDay, formatDayISO } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Page, PageHeader, inputCls, tdCls, thCls, trCls } from "@/components/ui";
import { lockPeriodAction, saveSettingsAction } from "../actions";

export default async function SettingsPage() {
  const user = await requireRole(FINANCE);
  const [center, logs] = await Promise.all([
    prisma.center.findUniqueOrThrow({ where: { id: "center" } }),
    prisma.auditLog.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const canEdit = user.role !== "BOOKKEEPER";
  const money = (cents: number) => (cents / 100).toFixed(2);

  return (
    <Page>
      <PageHeader title="Close & settings" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Period close">
          <p className="mb-3 text-sm text-zinc-600">
            {center.lockDate ? <>Books are closed through <strong>{formatDay(center.lockDate)}</strong>.</> : "No periods are closed."} Nothing can be
            posted, voided or backdated on or before the lock date, so filed reports and synced books can&apos;t drift.
          </p>
          <ActionForm action={lockPeriodAction} submitLabel="Update lock date">
            <Field label="Close books through" hint="Clear to reopen all periods">
              <input type="date" name="lockDate" defaultValue={center.lockDate ? formatDayISO(center.lockDate) : ""} className={inputCls} />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Center, billing & processor settings" className="lg:col-span-2">
          <ActionForm action={saveSettingsAction} submitLabel={canEdit ? "Save settings" : "Directors can edit"} className="grid gap-3 sm:grid-cols-2">
            <Field label="Center name"><input name="name" defaultValue={center.name} className={inputCls} /></Field>
            <Field label="Legal name"><input name="legalName" defaultValue={center.legalName ?? ""} className={inputCls} /></Field>
            <Field label="EIN (shown on tax statements)"><input name="ein" defaultValue={center.ein ?? ""} className={inputCls} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={center.phone ?? ""} className={inputCls} /></Field>
            <div className="sm:col-span-2"><Field label="Address"><input name="address" defaultValue={center.address ?? ""} className={inputCls} /></Field></div>
            <Field label="Email"><input name="email" defaultValue={center.email ?? ""} className={inputCls} /></Field>
            <Field label="Invoice terms (days)"><input name="invoiceDueDays" defaultValue={center.invoiceDueDays} className={inputCls} /></Field>
            <Field label="Late fee ($)"><input name="lateFee" defaultValue={money(center.lateFeeCents)} className={inputCls} /></Field>
            <Field label="Late fee grace (days)"><input name="lateFeeGraceDays" defaultValue={center.lateFeeGraceDays} className={inputCls} /></Field>
            <Field label="Sibling discount (%)"><input name="siblingDiscountPct" defaultValue={center.siblingDiscountBps / 100} className={inputCls} /></Field>
            <div />
            <Field label="Card fee (%)"><input name="cardFeePct" defaultValue={center.cardFeeBps / 100} className={inputCls} /></Field>
            <Field label="Card fee fixed ($)"><input name="cardFeeFixed" defaultValue={money(center.cardFeeFixedCents)} className={inputCls} /></Field>
            <Field label="ACH fee (%)"><input name="achFeePct" defaultValue={center.achFeeBps / 100} className={inputCls} /></Field>
            <Field label="ACH fee cap ($)"><input name="achFeeCap" defaultValue={money(center.achFeeCapCents)} className={inputCls} /></Field>
          </ActionForm>
        </Card>
      </div>

      <Card title="Audit log" flush className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>When</th>
              <th className={thCls}>Who</th>
              <th className={thCls}>Action</th>
              <th className={thCls}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className={trCls}>
                <td className={tdCls}>{l.createdAt.toLocaleString()}</td>
                <td className={tdCls}>{l.user?.name ?? "system"}</td>
                <td className={`${tdCls} font-mono text-xs`}>{l.action}</td>
                <td className={tdCls}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
