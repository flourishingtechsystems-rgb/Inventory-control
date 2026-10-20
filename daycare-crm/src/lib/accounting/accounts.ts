import type { AccountType } from "./ledger";

// Accounts the posting engine relies on, addressed by a stable key rather than
// by code so centers can renumber their chart freely.
export const SYSTEM_KEYS = [
  "OPERATING_BANK",
  "UNDEPOSITED_FUNDS",
  "AR",
  "OPENING_BALANCE",
  "TUITION",
  "REGISTRATION",
  "LATE_FEES",
  "DISCOUNTS",
  "MERCHANT_FEES",
  "BAD_DEBT",
] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

export const DEFAULT_CHART: {
  code: string;
  name: string;
  type: AccountType;
  systemKey?: SystemKey;
}[] = [
  { code: "1000", name: "Operating Checking", type: "ASSET", systemKey: "OPERATING_BANK" },
  { code: "1050", name: "Undeposited Funds", type: "ASSET", systemKey: "UNDEPOSITED_FUNDS" },
  { code: "1100", name: "Accounts Receivable – Tuition", type: "ASSET", systemKey: "AR" },
  { code: "2100", name: "Enrollment Deposits Held", type: "LIABILITY" },
  { code: "2200", name: "Payroll Liabilities", type: "LIABILITY" },
  { code: "3000", name: "Owner's Equity", type: "EQUITY" },
  { code: "3900", name: "Opening Balance Equity", type: "EQUITY", systemKey: "OPENING_BALANCE" },
  { code: "4000", name: "Tuition Revenue", type: "REVENUE", systemKey: "TUITION" },
  { code: "4100", name: "Registration Fees", type: "REVENUE", systemKey: "REGISTRATION" },
  { code: "4200", name: "Late Fees", type: "REVENUE", systemKey: "LATE_FEES" },
  { code: "4300", name: "Before & After School Revenue", type: "REVENUE" },
  { code: "4400", name: "Summer Camp Revenue", type: "REVENUE" },
  { code: "4900", name: "Tuition Discounts", type: "REVENUE", systemKey: "DISCOUNTS" },
  { code: "6000", name: "Payroll Expense", type: "EXPENSE" },
  { code: "6100", name: "Payment Processing Fees", type: "EXPENSE", systemKey: "MERCHANT_FEES" },
  { code: "6200", name: "Bad Debt Expense", type: "EXPENSE", systemKey: "BAD_DEBT" },
  { code: "6300", name: "Food & Classroom Supplies", type: "EXPENSE" },
  { code: "6400", name: "Rent", type: "EXPENSE" },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
};
