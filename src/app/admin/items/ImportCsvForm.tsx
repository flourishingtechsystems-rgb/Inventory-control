"use client";

import { useActionState } from "react";
import { importItemsCsv, type ImportState } from "./actions";

export function ImportCsvForm() {
  const [state, formAction, isPending] = useActionState<ImportState, FormData>(
    importItemsCsv,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">
          Upload CSV
        </label>
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isPending ? "Importing..." : "Import"}
      </button>
      <a
        href="/inventory-template.csv"
        download
        className="text-sm text-zinc-500 underline hover:text-zinc-800"
      >
        Download template
      </a>
      <p className="w-full text-xs text-zinc-500">
        Columns: <code>name</code>, <code>unit</code>,{" "}
        <code>category</code> (optional). Existing items (matched by name +
        unit) are updated; new rows are added.
      </p>
      {state?.error && (
        <p className="w-full text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="w-full text-sm text-green-700" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
