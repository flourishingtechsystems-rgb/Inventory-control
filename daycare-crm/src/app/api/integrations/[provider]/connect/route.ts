import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { FINANCE } from "@/lib/roles";
import { PROVIDER_SLUGS, authorizeUrl, isConfigured } from "@/lib/integrations/oauth";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/connect">) {
  const session = await auth();
  if (!session?.user || !FINANCE.includes(session.user.role)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const { provider: slug } = await ctx.params;
  const provider = PROVIDER_SLUGS[slug];
  if (!provider) return new NextResponse("Unknown provider", { status: 404 });
  if (!isConfigured(provider)) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(`${slug} client id/secret are not configured`)}`, req.url));
  }
  // CSRF protection: the callback must present the same state we set here.
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(provider, state));
  res.cookies.set(`oauth_state_${slug}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/api/integrations",
  });
  return res;
}
