"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { FINANCE } from "@/lib/roles";
import { str, toActionError, type ActionState } from "@/lib/actions";
import { parseDay } from "@/lib/dates";
import { audit } from "@/lib/accounting/posting";
import { decrypt } from "@/lib/integrations/crypto";
import { PROVIDER_LABELS, revokeToken, slugFor } from "@/lib/integrations/oauth";
import { ENTITY, syncProvider } from "@/lib/integrations/sync";
import type { Provider } from "@/generated/prisma/client";

function refresh(provider: Provider) {
  revalidatePath("/integrations");
  revalidatePath(`/integrations/${slugFor(provider)}`);
}

export async function saveSyncSettings(provider: Provider, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const syncMode = str(formData, "syncMode") === "DETAILED" ? "DETAILED" : "SUMMARY";
    const syncFrom = parseDay(str(formData, "syncFrom"));
    await prisma.integration.update({ where: { provider }, data: { syncMode, syncFrom } });
    await prisma.auditLog.create({
      data: { userId: user.id, action: "integration.settings", entity: "Integration", detail: `${provider} ${syncMode} from ${str(formData, "syncFrom") || "beginning"}` },
    });
    refresh(provider);
    return { ok: "Saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function syncNowAction(provider: Provider): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    const result = await syncProvider(provider);
    refresh(provider);
    if (result.errors.length) return { error: result.errors.join(" ") };
    return { ok: result.pushed ? `Pushed ${result.pushed} transactions in ${result.journals} journals to ${PROVIDER_LABELS[provider]}.` : "Already up to date." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function disconnectAction(provider: Provider): Promise<ActionState> {
  try {
    const user = await requireRole(FINANCE);
    const integration = await prisma.integration.findUnique({ where: { provider } });
    if (integration?.refreshTokenEnc) {
      await revokeToken(provider, decrypt(integration.refreshTokenEnc)).catch(() => undefined);
    }
    await prisma.integration.update({
      where: { provider },
      data: { accessTokenEnc: null, refreshTokenEnc: null, expiresAt: null },
    });
    await prisma.$transaction((tx) => audit(tx, { userId: user.id, action: "integration.disconnected", entity: "Integration", detail: provider }));
    refresh(provider);
    return { ok: "Disconnected. Mappings and sync history are kept for when you reconnect." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveMappingsAction(provider: Provider, _: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(FINANCE);
    let saved = 0;
    for (const [key, value] of formData.entries()) {
      const match = /^(account|class):(.+)$/.exec(key);
      if (!match || typeof value !== "string") continue;
      const entityType = match[1] === "account" ? ENTITY.ACCOUNT : ENTITY.CLASS;
      const localId = match[2];
      const [remoteId, ...nameParts] = value.split("|");
      const where = { provider_entityType_localId: { provider, entityType, localId } };
      if (!remoteId) {
        await prisma.externalRef.deleteMany({ where: { provider, entityType, localId } });
        continue;
      }
      await prisma.externalRef.upsert({
        where,
        update: { remoteId, remoteName: nameParts.join("|"), syncedAt: new Date() },
        create: { provider, entityType, localId, remoteId, remoteName: nameParts.join("|") },
      });
      saved++;
    }
    refresh(provider);
    return { ok: `Saved ${saved} mappings.` };
  } catch (e) {
    return toActionError(e);
  }
}
