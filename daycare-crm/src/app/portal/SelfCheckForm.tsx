"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { phoneCheckAction } from "./actions";

type Child = { id: string; firstName: string; checkedIn: boolean };

export function SelfCheckForm({ kids, canPickup }: { kids: Child[]; canPickup: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(phoneCheckAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600">Center code (shown on the check-in screen at the front desk)</span>
        <input name="code" inputMode="numeric" autoComplete="off" maxLength={7} required placeholder="6 digits" className={`${inputCls} font-mono tracking-widest`} />
      </label>
      <div className="flex flex-wrap gap-2">
        {kids.map((c) => (
          <button
            key={c.id}
            name="op"
            value={`${c.checkedIn ? "out" : "in"}:${c.id}`}
            disabled={pending || (c.checkedIn && !canPickup)}
            className={c.checkedIn ? btnSecondary : btnPrimary}
          >
            {c.checkedIn ? `Check out ${c.firstName}` : `Check in ${c.firstName}`}
          </button>
        ))}
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}
