import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { STAFF } from "@/lib/roles";
import { formatDay } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Page, PageHeader, btnSecondary, inputCls, linkCls } from "@/components/ui";
import { addLeadNote, convertLead, markLost, scheduleTour } from "../actions";
import { LeadStageSelect } from "../LeadStageSelect";

export default async function LeadPage(props: PageProps<"/leads/[id]">) {
  await requireRole(STAFF);
  const { id } = await props.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { classroom: true, activities: { include: { user: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!lead) notFound();

  return (
    <Page>
      <PageHeader
        title={lead.parentName}
        subtitle={<>Inquiry for {lead.childName} · <Link href="/leads" className={linkCls}>All leads</Link></>}
        actions={<LeadStageSelect leadId={lead.id} stage={lead.stage} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              {[
                ["Email", lead.email],
                ["Phone", lead.phone],
                ["Child DOB", formatDay(lead.childDob)],
                ["Desired start", formatDay(lead.desiredStart)],
                ["Program", lead.classroom?.name],
                ["Source", lead.source],
                ["Tour", lead.tourAt?.toLocaleString()],
                ["Lost reason", lead.lostReason],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="text-right text-zinc-800">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {lead.notes && <p className="mt-3 rounded bg-zinc-50 p-2 text-sm text-zinc-600">{lead.notes}</p>}
          </Card>

          {lead.familyId ? (
            <Card title="Converted">
              <Link href={`/families/${lead.familyId}`} className={linkCls}>Open family record →</Link>
            </Card>
          ) : (
            <Card title="Convert to family">
              <p className="mb-3 text-sm text-zinc-500">Creates the family, guardian, billing account and child in one step.</p>
              <ActionForm action={convertLead.bind(null, lead.id)} submitLabel="Convert">
                <Field label="Child status">
                  <select name="status" className={inputCls}>
                    <option value="ENROLLED">Enrolled</option>
                    <option value="WAITLIST">Waitlist</option>
                  </select>
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-6 sm:grid-cols-2">
            <Card title="Schedule tour">
              <ActionForm action={scheduleTour.bind(null, lead.id)} submitLabel="Schedule">
                <input type="datetime-local" name="tourAt" required className={inputCls} />
              </ActionForm>
            </Card>
            <Card title="Mark lost">
              <ActionForm action={markLost.bind(null, lead.id)} submitLabel="Mark lost" buttonClassName={btnSecondary}>
                <input name="lostReason" placeholder="Reason (price, location…)" className={inputCls} />
              </ActionForm>
            </Card>
          </div>
          <Card title="Activity">
            <ActionForm action={addLeadNote.bind(null, lead.id)} submitLabel="Log activity" className="mb-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <select name="kind" className={`${inputCls} w-32`}>
                  <option value="NOTE">Note</option>
                  <option value="CALL">Call</option>
                  <option value="EMAIL">Email</option>
                </select>
                <input name="body" placeholder="What happened?" className={inputCls} />
              </div>
            </ActionForm>
            <ul className="space-y-3">
              {lead.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <Badge tone={a.kind === "STAGE" ? "teal" : a.kind === "TOUR" ? "blue" : "neutral"}>{a.kind.toLowerCase()}</Badge>
                  <div className="flex-1">
                    <div className="text-zinc-800">{a.body}</div>
                    <div className="text-xs text-zinc-400">
                      {a.user?.name ?? "System"} · {a.createdAt.toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
