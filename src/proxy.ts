import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { homeForRole, type Role } from "@/lib/types";

const ROLE_PREFIXES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/requests", roles: ["REQUESTER", "ADMIN"] },
  { prefix: "/approvals", roles: ["MANAGER", "ADMIN"] },
  { prefix: "/finance", roles: ["FINANCE", "ADMIN"] },
  { prefix: "/admin", roles: ["ADMIN"] },
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });

  if (pathname === "/login") {
    if (token) {
      return NextResponse.redirect(new URL(homeForRole(token.role as Role), req.url));
    }
    return NextResponse.next();
  }

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = token.role as Role;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(homeForRole(role), req.url));
  }

  const rule = ROLE_PREFIXES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(role)) {
    return NextResponse.redirect(new URL(homeForRole(role), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
