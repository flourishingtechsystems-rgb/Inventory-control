import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { formatDayISO, monthPeriod, today } from "@/lib/dates";
import { PROVIDER_LABELS, isConfigured, slugFor } from "@/lib/integrations/oauth";
import { pendingEntries } from "@/lib/integrations/sync";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, btnDanger, btnPrimary, btnSecondary, inputCls, linkCls } from "@/components/ui";
import { disconnectAction, saveSyncSettings, syncNowAction } from "./actions";

const PROVIDERS = ["QUICKBOOKS", "XERO"] as const;

export default async function IntegrationsPage(props: PageProps<"/integrations">) {
  await requireRole(FINANCE);
  const { error } = await props.searchParams;
  const integrations = await prisma.integration.findMany();
  const month = monthPeriod(today());
  const cards = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const i = integrations.find((x) => x.provider === provider);
      const connected = Boolean(i?.accessTokenEnc);
      return {
        provider,
        i,
        connected,
        mappedCount: connected ? await prisma.externalRef.count({ where: { provider, entityType: "ACCOUNT" } }) : 0,
        pending: connected && i ? (await pendingEntries(i, { includeToday: true })).length : 0,
        logs: await prisma.syncLog.findMany({ where: { provider }, orderBy: { createdAt: "desc" }, take: 6 }),
      };
    }),
  );

  return (
    <Page>
      <PageHeader
        title="QuickBooks & Xero"
        subtitle="Nestwise keeps a full double-entry ledger and pushes it to your accounting system — balanced journals, mapped to your chart of accounts and classes, with idempotent retries so nothing posts twice."
      />
      {typeof error === "string" && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {cards.map(({ provider, i, connected, mappedCount, pending, logs }) => {
          const slug = slugFor(provider);
          return (
            <Card
              key={provider}
              title={PROVIDER_LABELS[provider]}
              actions={connected ? <Badge tone={i?.lastError ? "red" : "green"}>{i?.lastError ? "Sync error" : "Connected"}</Badge> : <Badge>Not connected</Badge>}
            >
              {connected && i ? (
                <div className="space-y-4">
                  <div className="text-sm">
                    <div className="font-medium">{i.companyName}</div>
                    <div className="text-xs text-zinc-500">
                      Connected {i.connectedAt?.toLocaleDateString()} · last sync {i.lastSyncAt ? i.lastSyncAt.toLocaleString() : "never"}
                    </div>
                    {i.lastError && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{i.lastError}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge tone="teal">{pending} transactions waiting</Badge>
                    <Badge tone={mappedCount ? "green" : "amber"}>{mappedCount} accounts mapped</Badge>
                  </div>
                  <ActionForm action={saveSyncSettings.bind(null, provider)} submitLabel="Save" buttonClassName={btnSecondary} className="grid gap-3 sm:grid-cols-2">
                    <Field label="Sync mode">
                      <select name="syncMode" defaultValue={i.syncMode} className={inputCls}>
                        <option value="SUMMARY">Daily summary journal (recommended)</option>
                        <option value="DETAILED">
                          {provider === "QUICKBOOKS" ? "Every transaction, with customers" : "Every transaction"}
                        </option>
                      </select>
                    </Field>
                    <Field label="Start syncing from" hint="Skip history already in your books">
                      <input type="date" name="syncFrom" defaultValue={i.syncFrom ? formatDayISO(i.syncFrom) : ""} className={inputCls} />
                    </Field>
                  </ActionForm>
                  <div className="flex flex-wrap items-start gap-2">
                    <Link href={`/integrations/${slug}`} className={btnSecondary}>Map accounts & classes</Link>
                    <ActionForm action={syncNowAction.bind(null, provider)} submitLabel="Sync now" pendingLabel="Syncing…" className="flex flex-col gap-2" />
                  </div>
                  {logs.length > 0 && (
                    <ul className="space-y-1 border-t border-zinc-100 pt-3 text-xs">
                      {logs.map((l) => (
                        <li key={l.id} className="flex gap-2">
                          <span className={l.status === "ERROR" ? "text-red-600" : "text-emerald-700"}>{l.status === "ERROR" ? "✕" : "✓"}</span>
                          <span className="text-zinc-400">{l.createdAt.toLocaleString()}</span>
                          <span className="text-zinc-700">{l.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ActionForm action={disconnectAction.bind(null, provider)} submitLabel="Disconnect" buttonClassName={btnDanger} confirm={`Disconnect ${PROVIDER_LABELS[provider]}?`} className="flex" />
                </div>
              ) : (
                <div className="space-y-3 text-sm text-zinc-600">
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Secure OAuth 2.0 — tokens encrypted at rest (AES-256-GCM), refreshed automatically.</li>
                    <li>Map every Nestwise account and classroom to your {provider === "QUICKBOOKS" ? "accounts and Classes" : "accounts and tracking categories"}.</li>
                    <li>Processor fees, discounts, refunds and deposits post to the right accounts — bank reconciliation matches payouts 1:1.</li>
                  </ul>
                  {isConfigured(provider) ? (
                    <a href={`/api/integrations/${slug}/connect`} className={btnPrimary}>Connect {PROVIDER_LABELS[provider]}</a>
                  ) : (
                    <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                      Set {provider === "QUICKBOOKS" ? "QBO_CLIENT_ID / QBO_CLIENT_SECRET" : "XERO_CLIENT_ID / XERO_CLIENT_SECRET"} in the server environment to enable connecting. File exports below work without it.
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="File exports (no connection needed)" className="mt-6">
        <form method="get" className="flex flex-wrap items-end gap-3" action="/api/exports/xero">
          <Field label="From"><input type="date" name="from" defaultValue={formatDayISO(month.start)} className={inputCls} /></Field>
          <Field label="To"><input type="date" name="to" defaultValue={formatDayISO(month.end)} className={inputCls} /></Field>
          <button formAction="/api/exports/xero" className={btnSecondary}>Xero manual journal CSV</button>
          <button formAction="/api/exports/iif" className={btnSecondary}>QuickBooks Desktop IIF</button>
          <button formAction="/api/exports/gl" className={btnSecondary}>General ledger CSV</button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          For accountants on QuickBooks Desktop or who prefer to import. Account codes and classroom tracking are included. See also{" "}
          <Link href="/accounting/statements" className={linkCls}>tax statements</Link>.
        </p>
      </Card>
    </Page>
  );
}
