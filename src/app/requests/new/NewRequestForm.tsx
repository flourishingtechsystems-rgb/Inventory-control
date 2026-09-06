"use client";

import { useActionState } from "react";
import { createRequest, type NewRequestState } from "./actions";

type Item = {
  id: string;
  name: string;
  unit: string;
  category: string | null;
};

export function NewRequestForm({ itemsByCategory }: { itemsByCategory: [string, Item[]][] }) {
  const [state, formAction, isPending] = useActionState<NewRequestState, FormData>(
    createRequest,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {itemsByCategory.map(([category, items]) => (
        <section key={category}>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">
            {category}
          </h2>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-4 px-4 py-3 ${
                  idx > 0 ? "border-t border-zinc-100" : ""
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {item.name}
                  </p>
                  <p className="text-xs text-zinc-500">per {item.unit}</p>
                </div>
                <input
                  type="number"
                  name={`qty_${item.id}`}
                  min={0}
                  step={1}
                  defaultValue={0}
                  className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm focus:border-zinc-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium text-zinc-700">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="Anything the manager should know..."
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isPending ? "Submitting..." : "Submit request"}
      </button>
    </form>
  );
}
