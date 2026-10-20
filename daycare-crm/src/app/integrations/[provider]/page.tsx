import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { PROVIDER_LABELS, PROVIDER_SLUGS } from "@/lib/integrations/oauth";
import { ENTITY, clientFor } from "@/lib/integrations/sync";
import type { RemoteAccount, RemoteOption } from "@/lib/integrations/clients";
import { ActionForm } from "@/components/ActionForm";
import { Card, Page, PageHeader, inputCls, linkCls, tdCls, thCls, trCls } from "@/components/ui";
import { saveMappingsAction } from "../actions";

export default async function MappingPage(props: PageProps<"/integrations/[provider]">) {
  await requireRole(FINANCE);
  const { provider: slug } = await props.params;
  const provider = PROVIDER_SLUGS[slug];
  if (!provider) notFound();

  const integration = await prisma.integration.findUnique({ where: { provider } });
  if (!integration?.accessTokenEnc) {
    return (
      <Page>
        <PageHeader title={`${PROVIDER_LABELS[provider]} mapping`} />
        <p className="text-sm text-zinc-600">Connect {PROVIDER_LABELS[provider]} first on the <Link href="/integrations" className={linkCls}>integrations page</Link>.</p>
      </Page>
    );
  }

  let remoteAccounts: RemoteAccount[] = [];
  let remoteClasses: RemoteOption[] = [];
  let loadError: string | null = null;
  try {
    const client = await clientFor(integration);
    [remoteAccounts, remoteClasses] = await Promise.all([client.listAccounts(), client.listClasses()]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const [accounts, rooms, refs] = await Promise.all([
    prisma.account.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.externalRef.findMany({ where: { provider, entityType: { in: [ENTITY.ACCOUNT, ENTITY.CLASS] } } }),
  ]);
  const current = new Map(refs.map((r) => [`${r.entityType}:${r.localId}`, r]));
  // Summary journals carry no customer, so QuickBooks rejects A/R-type accounts there.
  const summaryQbo = provider === "QUICKBOOKS" && integration.syncMode === "SUMMARY";
  const reasonFor = (a: RemoteAccount) =>
    a.unusableReason ?? (summaryQbo && a.type === "Accounts Receivable" ? "Summary journals can't post to A/R in QuickBooks — map to an Other Current Asset like “Tuition Receivable (Nestwise)”, or use detailed mode" : undefined);

  return (
    <Page>
      <PageHeader
        title={`${PROVIDER_LABELS[provider]} mapping`}
        subtitle={<>{integration.companyName} · <Link href="/integrations" className={linkCls}>Back to integrations</Link></>}
      />
      {loadError && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t load your {PROVIDER_LABELS[provider]} chart: {loadError}</p>}
      <ActionForm action={saveMappingsAction.bind(null, provider)} submitLabel="Save mappings" className="flex flex-col gap-6">
        <Card title="Accounts" flush>
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Nestwise account</th>
                <th className={thCls}>{PROVIDER_LABELS[provider]} account</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const ref = current.get(`${ENTITY.ACCOUNT}:${a.id}`);
                return (
                  <tr key={a.id} className={trCls}>
                    <td className={tdCls}>{a.code} {a.name}</td>
                    <td className={tdCls}>
                      <select name={`account:${a.id}`} defaultValue={ref ? `${ref.remoteId}|${ref.remoteName ?? ""}` : ""} className={inputCls}>
                        <option value="">— not mapped —</option>
                        {ref && !remoteAccounts.some((r) => r.id === ref.remoteId) && (
                          <option value={`${ref.remoteId}|${ref.remoteName ?? ""}`}>{ref.remoteName ?? ref.remoteId}</option>
                        )}
                        {remoteAccounts.map((r) => {
                          const reason = reasonFor(r);
                          return (
                            <option key={r.id || r.name} value={`${r.id}|${r.name}`} disabled={Boolean(reason) || !r.id} title={reason}>
                              {r.name} ({r.type}){reason ? " — unavailable" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title={provider === "QUICKBOOKS" ? "Classes" : "Tracking categories"} flush>
          <table className="w-full">
            <tbody>
              {rooms.map((r) => {
                const ref = current.get(`${ENTITY.CLASS}:${r.id}`);
                return (
                  <tr key={r.id} className={trCls}>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdCls}>
                      <select name={`class:${r.id}`} defaultValue={ref ? `${ref.remoteId}|${ref.remoteName ?? ""}` : ""} className={inputCls}>
                        <option value="">— no class —</option>
                        {remoteClasses.map((c) => (
                          <option key={c.id} value={`${c.id}|${c.name}`}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </ActionForm>
    </Page>
  );
}
