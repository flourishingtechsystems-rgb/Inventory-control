"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** `siblings` lets a parent link (/billing) step aside when a more specific one (/billing/run) matches. */
export function NavLink({ href, label, siblings }: { href: string; label: string; siblings: string[] }) {
  const pathname = usePathname();
  const active =
    matches(pathname, href) && !siblings.some((s) => s !== href && s.length > href.length && matches(pathname, s));
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-1.5 text-sm ${
        active ? "bg-teal-800 font-medium text-white" : "text-teal-100 hover:bg-teal-800/60 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}
