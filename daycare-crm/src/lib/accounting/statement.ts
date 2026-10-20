import { prisma } from "@/lib/prisma";

export type StatementRow = {
  date: Date;
  kind: "Invoice" | "Payment" | "Credit" | "Write-off" | "Refund" | "Void";
  reference: string;
  description: string;
  chargeCents: number;
  creditCents: number;
  balanceCents: number;
  invoiceId?: string;
  paymentId?: string;
};

/** Customer statement for one payer with a running balance. */
export async function payerStatement(payerId: string): Promise<StatementRow[]> {
  const [invoices, payments, adjustments] = await Promise.all([
    prisma.invoice.findMany({ where: { payerId }, include: { lines: true } }),
    prisma.payment.findMany({ where: { payerId }, include: { refunds: true } }),
    prisma.adjustment.findMany({ where: { payerId } }),
  ]);
  const rows: Omit<StatementRow, "balanceCents">[] = [];
  for (const inv of invoices) {
    rows.push({
      date: inv.issueDate,
      kind: "Invoice",
      reference: `#${inv.number}`,
      description: inv.memo ?? inv.lines[0]?.description ?? "",
      chargeCents: inv.totalCents,
      creditCents: 0,
      invoiceId: inv.id,
    });
    if (inv.status === "VOID") {
      rows.push({ date: inv.issueDate, kind: "Void", reference: `#${inv.number}`, description: "Invoice voided", chargeCents: 0, creditCents: inv.totalCents, invoiceId: inv.id });
    }
  }
  for (const p of payments) {
    rows.push({
      date: p.receivedAt,
      kind: "Payment",
      reference: p.reference ?? p.method.toLowerCase(),
      description: `${p.method.charAt(0)}${p.method.slice(1).toLowerCase()} payment`,
      chargeCents: 0,
      creditCents: p.amountCents,
      paymentId: p.id,
    });
    for (const r of p.refunds) {
      rows.push({ date: r.date, kind: "Refund", reference: p.reference ?? "", description: r.reason, chargeCents: r.amountCents, creditCents: 0, paymentId: p.id });
    }
  }
  for (const a of adjustments) {
    rows.push({
      date: a.date,
      kind: a.kind === "WRITE_OFF" ? "Write-off" : "Credit",
      reference: "",
      description: a.reason,
      chargeCents: 0,
      creditCents: a.amountCents,
    });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || b.chargeCents - a.chargeCents);
  let balance = 0;
  return rows.map((r) => {
    balance += r.chargeCents - r.creditCents;
    return { ...r, balanceCents: balance };
  });
}
