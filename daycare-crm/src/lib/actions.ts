import { Prisma } from "@/generated/prisma/client";
import { AccountingError, PeriodLockedError } from "@/lib/accounting/posting";
import { UnbalancedEntryError } from "@/lib/accounting/ledger";
import { NotAuthorizedError } from "@/lib/session";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Turns expected business errors into form messages; rethrows the rest. */
export function toActionError(error: unknown): ActionState {
  if (
    error instanceof AccountingError ||
    error instanceof PeriodLockedError ||
    error instanceof UnbalancedEntryError ||
    error instanceof NotAuthorizedError
  ) {
    return { error: error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { error: "That record already exists." };
  }
  throw error;
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(formData: FormData, key: string): string | null {
  return str(formData, key) || null;
}
