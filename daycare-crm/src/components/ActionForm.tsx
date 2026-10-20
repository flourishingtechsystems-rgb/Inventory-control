"use client";

import { startTransition, useActionState, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";
import { btnPrimary } from "./ui";

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  className = "flex flex-col gap-3",
  buttonClassName = btnPrimary,
  confirm,
  onSuccess,
  id,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClassName?: string;
  confirm?: string;
  onSuccess?: () => void;
  id?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok && !result.error) {
      formRef.current?.reset();
      onSuccess?.();
    }
    return result;
  }, undefined);

  return (
    <form
      id={id}
      ref={formRef}
      className={className}
      // Submitting manually (instead of <form action>) stops React from
      // clearing the user's input when the server returns a validation error.
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {state?.error && (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p className="text-sm text-emerald-700" role="status">
            {state.ok}
          </p>
        )}
      </div>
    </form>
  );
}
