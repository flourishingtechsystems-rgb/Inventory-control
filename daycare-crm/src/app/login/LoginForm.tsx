"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";
import { btnPrimary, inputCls } from "@/components/ui";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Email</span>
        <input name="email" type="email" required autoComplete="email" className={inputCls} placeholder="you@center.com" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={inputCls} placeholder="••••••••" />
      </label>
      {errorMessage && (
        <p className="text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
      <button type="submit" disabled={isPending} className={`${btnPrimary} mt-2`}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
