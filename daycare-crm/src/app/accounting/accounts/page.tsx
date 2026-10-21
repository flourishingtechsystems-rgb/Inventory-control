import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/accounting/accounts";
import { naturalBalance } from "@/lib/accounting/ledger";
import { accountTotals } from "@/lib/accounting/reports";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, inputCls, linkCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { saveAccountAction, toggleAccountAction } from "../actions";

export default async function AccountsPage() {
  await requireRole(FINANCE);
  const [accounts, totals] = await Promise.all([prisma.account.findMany({ orderBy: { code: "asc" } }), accountTotals({})]);
  const byId = new Map(totals.map((t) => [t.id, t]));

  return (
    <Page>
      <PageHeader title="Chart of accounts" subtitle="Accounts marked “system” are used by automatic postings and can be renamed or renumbered, not removed." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card flush className="lg:col-span-2">
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Code</th>
                <th className={thCls}>Name</th>
                <th className={thCls}>Type</th>
                <th className={thRight}>Balance</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const t = byId.get(a.id)!;
                return (
                  <tr key={a.id} className={`${trCls} ${a.active ? "" : "opacity-50"}`}>
                    <td className={`${tdCls} font-mono`}>{a.code}</td>
                    <td className={tdCls}>
                      <Link href={`/accounting/journal?account=${a.id}`} className={linkCls}>{a.name}</Link>{" "}
                      {a.systemKey && <Badge tone="teal">system</Badge>}
                    </td>
                    <td className={tdCls}>{ACCOUNT_TYPE_LABELS[a.type]}</td>
                    <td className={tdRight}>{formatCents(naturalBalance(a.type, t.debitCents, t.creditCents))}</td>
                    <td className={tdCls}>
                      {!a.systemKey && (
                        <form action={toggleAccountAction.bind(null, a.id)}>
                          <button className="text-xs text-zinc-500 hover:text-zinc-800">{a.active ? "Deactivate" : "Activate"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="New account">
          <ActionForm action={saveAccountAction} submitLabel="Add account">
            <Field label="Code"><input name="code" required className={inputCls} /></Field>
            <Field label="Name"><input name="name" required className={inputCls} /></Field>
            <Field label="Type">
              <select name="type" className={inputCls}>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </Page>
  );
}
