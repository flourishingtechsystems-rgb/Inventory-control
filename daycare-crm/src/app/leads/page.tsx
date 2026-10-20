import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { STAFF } from "@/lib/roles";
import { formatDay } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Page, PageHeader, inputCls } from "@/components/ui";
import { createLead } from "./actions";
import { LeadStageSelect } from "./LeadStageSelect";

const COLUMNS = [
  { stage: "INQUIRY", label: "Inquiry" },
  { stage: "TOUR_SCHEDULED", label: "Tour scheduled" },
  { stage: "TOURED", label: "Toured" },
  { stage: "APPLIED", label: "Applied" },
  { stage: "WAITLIST", label: "Waitlist" },
] as const;

export default async function LeadsPage() {
  await requireRole(STAFF);
  const [leads, rooms, closed] = await Promise.all([
    prisma.lead.findMany({
      where: { stage: { in: COLUMNS.map((c) => c.stage) } },
      include: { classroom: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.classroom.findMany({ orderBy: { name: "asc" } }),
    prisma.lead.groupBy({ by: ["stage"], where: { stage: { in: ["ENROLLED", "LOST"] } }, _count: true }),
  ]);
  const won = closed.find((c) => c.stage === "ENROLLED")?._count ?? 0;
  const lost = closed.find((c) => c.stage === "LOST")?._count ?? 0;

  return (
    <Page wide>
      <PageHeader
        title="Leads & Tours"
        subtitle={`${leads.length} open · ${won} enrolled · ${lost} lost · ${won + lost ? Math.round((won / (won + lost)) * 100) : 0}% conversion`}
      />

      <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = leads.filter((l) => l.stage === col.stage);
          return (
            <div key={col.stage} className="min-w-52 rounded-xl bg-zinc-100 p-2">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{col.label}</span>
                <span className="text-xs text-zinc-500">{items.length}</span>
              </div>
              <div className="mt-1 space-y-2">
                {items.map((lead) => (
                  <div key={lead.id} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                    <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-zinc-900 hover:underline">
                      {lead.parentName}
                    </Link>
                    <div className="text-xs text-zinc-500">for {lead.childName}</div>
                    {lead.classroom && <div className="mt-1 text-xs text-zinc-500">{lead.classroom.name}</div>}
                    {lead.tourAt && col.stage === "TOUR_SCHEDULED" && (
                      <div className="mt-1 text-xs font-medium text-teal-700">Tour {lead.tourAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                    )}
                    {lead.desiredStart && <div className="text-xs text-zinc-400">Start {formatDay(lead.desiredStart)}</div>}
                    <div className="mt-2">
                      <LeadStageSelect leadId={lead.id} stage={lead.stage} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Card title="New inquiry" className="mt-8 max-w-3xl">
        <ActionForm action={createLead} submitLabel="Add lead" className="grid gap-3 sm:grid-cols-2">
          <Field label="Parent name"><input name="parentName" required className={inputCls} /></Field>
          <Field label="Child name"><input name="childName" required className={inputCls} /></Field>
          <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
          <Field label="Phone"><input name="phone" className={inputCls} /></Field>
          <Field label="Child date of birth"><input name="childDob" type="date" className={inputCls} /></Field>
          <Field label="Desired start"><input name="desiredStart" type="date" className={inputCls} /></Field>
          <Field label="Program interest">
            <select name="classroomId" className={inputCls}>
              <option value="">—</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Source"><input name="source" placeholder="Website, Google, referral…" className={inputCls} /></Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><textarea name="notes" rows={2} className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>
    </Page>
  );
}
