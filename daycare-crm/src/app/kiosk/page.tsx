import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { KIOSK_OPERATORS } from "@/lib/roles";
import { centerCode, centerCodeExpiresAt } from "@/lib/presence";
import { KioskClient } from "./KioskClient";

export default async function KioskPage() {
  const user = await requireRole(KIOSK_OPERATORS);
  const center = await prisma.center.findUnique({ where: { id: "center" } });
  return (
    <div className="fixed inset-0 z-50 overflow-auto">
      <KioskClient centerName={center?.name ?? "Welcome"} code={centerCode()} codeExpires={centerCodeExpiresAt().toISOString()} exitHref={user.role === "KIOSK" ? undefined : "/attendance"} />
    </div>
  );
}
