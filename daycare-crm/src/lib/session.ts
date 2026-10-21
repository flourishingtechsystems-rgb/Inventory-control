import { auth } from "@/auth";
import type { Role } from "@/lib/roles";

export class NotAuthorizedError extends Error {}

/** Server-side guard for pages and server actions (the proxy alone isn't enough). */
export async function requireRole(roles: Role[]) {
  const session = await auth();
  if (!session?.user || !roles.includes(session.user.role)) {
    throw new NotAuthorizedError("Not authorized");
  }
  return session.user;
}
