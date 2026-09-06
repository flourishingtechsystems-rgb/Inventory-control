import Link from "next/link";
import { auth } from "@/auth";
import { getUnreadCount } from "@/lib/notifications";
import { ROLE_LABELS, homeForRole, type Role } from "@/lib/types";
import { SignOutButton } from "./SignOutButton";

const NAV_LINKS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/requests", label: "My Requests", roles: ["REQUESTER", "ADMIN"] },
  { href: "/requests/new", label: "New Request", roles: ["REQUESTER", "ADMIN"] },
  { href: "/approvals", label: "Approvals", roles: ["MANAGER", "ADMIN"] },
  { href: "/finance", label: "Finance", roles: ["FINANCE", "ADMIN"] },
  { href: "/admin/items", label: "Inventory Catalog", roles: ["ADMIN"] },
];

export async function Navbar() {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role;
  const unread = await getUnreadCount(session.user.id);
  const links = NAV_LINKS.filter((l) => l.roles.includes(role));

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link
            href={homeForRole(role)}
            className="text-sm font-semibold text-zinc-900"
          >
            Inventory Control
          </Link>
          <nav className="flex items-center gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-zinc-600 hover:text-zinc-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {unread > 0 && (
            <Link
              href={role === "FINANCE" ? "/finance" : "/approvals"}
              className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
            >
              {unread} new
            </Link>
          )}
          <span className="text-sm text-zinc-500">
            {session.user.name}{" "}
            <span className="text-zinc-400">({ROLE_LABELS[role]})</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
