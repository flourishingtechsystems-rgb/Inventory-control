import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FINANCE } from "@/lib/roles";
import { formatDayISO, parseDay } from "@/lib/dates";
import { generalLedgerCsv, quickbooksIif, xeroManualJournalCsv, type ExportEntry } from "@/lib/integrations/mappers";

const FORMATS = {
  gl: { build: generalLedgerCsv, type: "text/csv", ext: "csv", name: "general-ledger" },
  xero: { build: xeroManualJournalCsv, type: "text/csv", ext: "csv", name: "xero-manual-journals" },
  iif: { build: quickbooksIif, type: "application/octet-stream", ext: "iif", name: "quickbooks-desktop" },
} as const;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/exports/[format]">) {
  const session = await auth();
  if (!session?.user || !FINANCE.includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { format } = await ctx.params;
  const spec = FORMATS[format as keyof typeof FORMATS];
  if (!spec) return NextResponse.json({ error: "Unknown format" }, { status: 404 });

  const from = parseDay(req.nextUrl.searchParams.get("from") ?? "");
  const to = parseDay(req.nextUrl.searchParams.get("to") ?? "");
  const entries = await prisma.journalEntry.findMany({
    where: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
    include: { lines: { include: { account: true, classroom: true } } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  const rows: ExportEntry[] = entries.map((e) => ({
    id: e.id,
    number: e.number,
    date: e.date,
    memo: e.memo,
    lines: e.lines.map((l) => ({
      accountId: l.accountId,
      classroomId: l.classroomId,
      payerId: l.payerId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      memo: l.memo,
      accountCode: l.account.code,
      accountName: l.account.name,
      classroomName: l.classroom?.name ?? null,
    })),
  }));
  const range = [from && formatDayISO(from), to && formatDayISO(to)].filter(Boolean).join("_to_") || "all";
  return new NextResponse(spec.build(rows), {
    headers: {
      "Content-Type": `${spec.type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${spec.name}-${range}.${spec.ext}"`,
    },
  });
}
