import Link from "next/link";
import { auth, signOut } from "@/auth";
import { ROLE_LABELS, canAccess, homeForRole } from "@/lib/roles";
import { NavLink } from "./NavLink";

const SECTIONS: { heading: string; links: { href: string; label: string }[] }[] = [
  { heading: "Overview", links: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    heading: "Enrollment",
    links: [
      { href: "/leads", label: "Leads & Tours" },
      { href: "/families", label: "Families" },
    ],
  },
  {
    heading: "Classrooms",
    links: [
      { href: "/attendance", label: "Check-in / out" },
      { href: "/classrooms", label: "Rooms & Ratios" },
    ],
  },
  {
    heading: "Billing",
    links: [
      { href: "/billing", label: "Receivables" },
      { href: "/billing/run", label: "Billing Run" },
      { href: "/billing/payments", label: "Payments" },
      { href: "/billing/deposits", label: "Deposits" },
      { href: "/billing/plans", label: "Tuition Plans" },
    ],
  },
  {
    heading: "Accounting",
    links: [
      { href: "/accounting", label: "Financial Reports" },
      { href: "/accounting/journal", label: "General Ledger" },
      { href: "/accounting/accounts", label: "Chart of Accounts" },
      { href: "/accounting/statements", label: "Tax Statements" },
      { href: "/accounting/settings", label: "Close & Settings" },
      { href: "/integrations", label: "QuickBooks & Xero" },
    ],
  },
  { heading: "Family", links: [{ href: "/portal", label: "My Family" }] },
];

export async function Sidebar() {
  const session = await auth();
  if (!session?.user) return null;
  const role = session.user.role;
  const allHrefs = SECTIONS.flatMap((s) => s.links.map((l) => l.href));

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-teal-900 text-white print:hidden">
      <Link href={homeForRole(role)} className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-300 text-sm font-bold text-teal-900">N</span>
        <span className="text-lg font-semibold tracking-tight">Nestwise</span>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {SECTIONS.map((section) => {
          const links = section.links.filter((l) => canAccess(role, l.href));
          if (links.length === 0) return null;
          return (
            <div key={section.heading}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-teal-300/80">
                {section.heading}
              </div>
              <div className="space-y-0.5">
                {links.map((l) => (
                  <NavLink key={l.href} href={l.href} label={l.label} siblings={allHrefs} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-teal-800 px-5 py-4">
        <div className="text-sm font-medium">{session.user.name}</div>
        <div className="text-xs text-teal-300">{ROLE_LABELS[role]}</div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="mt-3 text-xs text-teal-200 hover:text-white">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
