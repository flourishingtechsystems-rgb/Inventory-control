import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE, STAFF } from "@/lib/roles";
import { formatCents } from "@/lib/money";
import { systemAccounts } from "@/lib/accounting/posting";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, inputCls, linkCls, tdCls, tdRight, thCls, thRight, trCls } from "@/components/ui";
import { createFamily } from "./actions";

export default async function FamiliesPage(props: PageProps<"/families">) {
  const user = await requireRole(FINANCE);
  const { q } = await props.searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const accounts = await systemAccounts(prisma);

  const [families, balances] = await Promise.all([
    prisma.family.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query } },
              { children: { some: { firstName: { contains: query } } } },
              { guardians: { some: { OR: [{ firstName: { contains: query } }, { email: { contains: query } }] } } },
            ],
          }
        : undefined,
      include: { children: { include: { classroom: true } }, guardians: true, payers: true },
      orderBy: { name: "asc" },
    }),
    prisma.journalLine.groupBy({
      by: ["payerId"],
      where: { accountId: accounts.AR, payerId: { not: null } },
      _sum: { debitCents: true, creditCents: true },
    }),
  ]);
  const balanceByPayer = new Map(balances.map((b) => [b.payerId, (b._sum.debitCents ?? 0) - (b._sum.creditCents ?? 0)]));

  return (
    <Page wide>
      <PageHeader title="Families" subtitle={`${families.length} families`} />
      <form className="mb-4 flex max-w-md gap-2">
        <input name="q" defaultValue={query} placeholder="Search family, child, guardian or email" className={inputCls} />
      </form>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card flush className="lg:col-span-2">
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Family</th>
                <th className={thCls}>Children</th>
                <th className={thCls}>Guardians</th>
                <th className={thRight}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => {
                const balance = f.payers.reduce((a, p) => a + (balanceByPayer.get(p.id) ?? 0), 0);
                return (
                  <tr key={f.id} className={trCls}>
                    <td className={tdCls}>
                      <Link href={`/families/${f.id}`} className={linkCls}>{f.name}</Link>
                      {f.status === "INACTIVE" && <Badge>inactive</Badge>}
                    </td>
                    <td className={tdCls}>
                      {f.children.map((c) => (
                        <div key={c.id}>
                          {c.firstName}{" "}
                          <span className="text-xs text-zinc-400">{c.classroom?.name ?? c.status.toLowerCase()}</span>
                        </div>
                      ))}
                    </td>
                    <td className={tdCls}>{f.guardians.map((g) => `${g.firstName} ${g.lastName}`).join(", ")}</td>
                    <td className={`${tdRight} ${balance > 0 ? "text-amber-700" : balance < 0 ? "text-emerald-700" : ""}`}>
                      {balance < 0 ? `${formatCents(-balance)} credit` : formatCents(balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {STAFF.includes(user.role) && (
          <Card title="New family">
            <ActionForm action={createFamily} submitLabel="Create family">
              <Field label="Family name" hint="Defaults to “<Last name> Family”"><input name="name" className={inputCls} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Guardian first name"><input name="firstName" required className={inputCls} /></Field>
                <Field label="Last name"><input name="lastName" required className={inputCls} /></Field>
              </div>
              <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
              <Field label="Phone"><input name="phone" className={inputCls} /></Field>
              <Field label="Relationship"><input name="relationship" placeholder="Mother, Father, Grandparent…" className={inputCls} /></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </Page>
  );
}
