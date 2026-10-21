"use client";

import { useTransition } from "react";
import type { LeadStage } from "@/generated/prisma/enums";
import { moveLead } from "./actions";

const LABELS: Record<LeadStage, string> = {
  INQUIRY: "Inquiry",
  TOUR_SCHEDULED: "Tour scheduled",
  TOURED: "Toured",
  APPLIED: "Applied",
  WAITLIST: "Waitlist",
  ENROLLED: "Enrolled",
  LOST: "Lost",
};

export function LeadStageSelect({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Stage"
      defaultValue={stage}
      disabled={pending}
      onChange={(e) => start(() => moveLead(leadId, e.target.value as LeadStage))}
      className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-600"
    >
      {Object.entries(LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
