import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FINANCE } from "@/lib/roles";
import { encrypt } from "@/lib/integrations/crypto";
import { QuickBooksClient, XeroClient } from "@/lib/integrations/clients";
import { PROVIDER_SLUGS, exchangeCode, xeroTenants } from "@/lib/integrations/oauth";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const session = await auth();
  if (!session?.user || !FINANCE.includes(session.user.role)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const { provider: slug } = await ctx.params;
  const provider = PROVIDER_SLUGS[slug];
  if (!provider) return new NextResponse("Unknown provider", { status: 404 });

  const fail = (message: string) => {
    const res = NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(message)}`, req.url));
    res.cookies.delete(`oauth_state_${slug}`);
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error_description") ?? params.get("error")!);
  const state = params.get("state");
  if (!state || state !== req.cookies.get(`oauth_state_${slug}`)?.value) return fail("Authorization expired — please try again.");
  const code = params.get("code");
  if (!code) return fail("No authorization code returned.");

  try {
    const tokens = await exchangeCode(provider, code);
    let tenantId: string;
    let companyName: string;
    if (provider === "QUICKBOOKS") {
      tenantId = params.get("realmId") ?? "";
      if (!tenantId) return fail("QuickBooks did not return a company id.");
      companyName = await new QuickBooksClient(tokens.accessToken, tenantId).companyName();
    } else {
      const tenants = await xeroTenants(tokens.accessToken);
      const org = tenants.find((t) => t.tenantType === "ORGANISATION") ?? tenants[0];
      if (!org) return fail("No Xero organisation was authorised.");
      tenantId = org.tenantId;
      companyName = (await new XeroClient(tokens.accessToken, tenantId).companyName()) || org.tenantName;
    }
    const data = {
      tenantId,
      companyName,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      connectedAt: new Date(),
      lastError: null,
    };
    await prisma.integration.upsert({ where: { provider }, update: data, create: { provider, ...data } });
    await prisma.auditLog.create({
      data: { userId: session.user.id, action: "integration.connected", entity: "Integration", detail: `${provider}: ${companyName}` },
    });
    const res = NextResponse.redirect(new URL(`/integrations/${slug}`, req.url));
    res.cookies.delete(`oauth_state_${slug}`);
    return res;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Connection failed.");
  }
}
