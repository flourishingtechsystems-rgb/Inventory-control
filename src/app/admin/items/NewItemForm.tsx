"use client";

import { useActionState } from "react";
import { createItem, type ItemFormState } from "./actions";

export function NewItemForm() {
  const [state, formAction, isPending] = useActionState<ItemFormState, FormData>(
    createItem,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Name</label>
        <input
          name="name"
          required
          className="w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="e.g. Toilet Paper"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Unit</label>
        <input
          name="unit"
          required
          className="w-32 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="e.g. roll"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">
          Category (optional)
        </label>
        <input
          name="category"
          className="w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="e.g. Restroom Supplies"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isPending ? "Adding..." : "Add item"}
      </button>
      {state?.error && (
        <p className="w-full text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
