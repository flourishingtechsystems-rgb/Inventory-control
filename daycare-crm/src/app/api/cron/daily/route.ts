import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/dates";
import { applyLateFees } from "@/lib/accounting/receivables";
import { syncAll } from "@/lib/integrations/sync";

// Nightly job: late fees, then push the day to QuickBooks/Xero.
// POST with `Authorization: Bearer $CRON_SECRET`.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const lateFees = await prisma.$transaction((tx) => applyLateFees(tx, today()));
  return NextResponse.json({ lateFees: lateFees.length, sync: await syncAll() });
}
