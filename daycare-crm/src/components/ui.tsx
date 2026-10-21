import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
export const btnPrimary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";
export const linkCls = "font-medium text-teal-700 hover:text-teal-900 hover:underline";
export const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500";
export const thRight = `${thCls} text-right`;
export const tdCls = "px-4 py-2.5 text-sm text-zinc-700";
export const tdRight = `${tdCls} whitespace-nowrap text-right tabular-nums`;
export const tdDate = `${tdCls} whitespace-nowrap`;
export const trCls = "border-t border-zinc-100";

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? "max-w-7xl" : "max-w-6xl"} px-6 py-8`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className={flush ? "overflow-x-auto" : "p-4"}>{children}</div>
    </section>
  );
}

const tones = {
  neutral: "bg-zinc-100 text-zinc-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  teal: "bg-teal-50 text-teal-800 ring-teal-600/20",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-zinc-500/10 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-zinc-500">{children}</p>;
}

export function Tabs({ items, active }: { items: { href: string; label: string }[]; active: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-zinc-200">
      {items.map((t) => (
        <a
          key={t.href}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            t.href === active ? "border-teal-700 text-teal-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {children}
    </div>
  );
}
