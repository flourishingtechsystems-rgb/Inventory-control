// HTTP clients for QuickBooks Online and Xero. `fetch` is injectable so the
// request shapes can be verified in tests without network access.

import {
  toQboCustomer,
  toQboJournalEntry,
  toXeroManualJournal,
  type ProviderKey,
  type RemoteJournal,
} from "./mappers";

export type FetchLike = typeof fetch;

export type RemoteAccount = {
  id: string;
  name: string;
  type: string;
  // Why this account can't take Nestwise journals, if it can't.
  unusableReason?: string;
};

export type RemoteOption = { id: string; name: string };

export interface AccountingClient {
  provider: ProviderKey;
  companyName(): Promise<string>;
  listAccounts(): Promise<RemoteAccount[]>;
  listClasses(): Promise<RemoteOption[]>;
  /** Posts a journal; `idempotencyKey` makes retries safe. Returns the remote id. */
  postJournal(journal: RemoteJournal, idempotencyKey: string): Promise<string>;
  /** Detailed mode customer sub-ledger; null when the provider can't attach customers to journals. */
  ensureCustomer:
    | ((payer: { id: string; name: string; email: string | null }) => Promise<string>)
    | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  describeError: (status: number, body: unknown) => string,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.ok) return body;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
      continue;
    }
    throw new ProviderError(describeError(res.status, body), res.status);
  }
}

// --- QuickBooks Online -----------------------------------------------------

const QBO_MINOR_VERSION = "75";

type QboFault = { Fault?: { Error?: { Message?: string; Detail?: string }[] } };

export class QuickBooksClient implements AccountingClient {
  provider = "QUICKBOOKS" as const;
  private base: string;

  constructor(
    private accessToken: string,
    private realmId: string,
    environment: string = process.env.QBO_ENVIRONMENT ?? "sandbox",
    private fetchImpl: FetchLike = fetch,
  ) {
    const host =
      environment === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";
    this.base = `${host}/v3/company/${encodeURIComponent(realmId)}`;
  }

  private request(method: string, path: string, opts: { body?: unknown; query?: Record<string, string> } = {}) {
    const params = new URLSearchParams({ minorversion: QBO_MINOR_VERSION, ...opts.query });
    return requestJson(
      this.fetchImpl,
      `${this.base}${path}?${params}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      },
      (status, body) => {
        const err = (body as QboFault)?.Fault?.Error?.[0];
        return `QuickBooks ${status}: ${err?.Detail ?? err?.Message ?? JSON.stringify(body)}`;
      },
    );
  }

  private async query<T>(sql: string, entity: string): Promise<T[]> {
    const body = (await this.request("GET", "/query", { query: { query: sql } })) as {
      QueryResponse?: Record<string, T[]>;
    };
    return body.QueryResponse?.[entity] ?? [];
  }

  async companyName() {
    const body = (await this.request("GET", `/companyinfo/${encodeURIComponent(this.realmId)}`)) as {
      CompanyInfo?: { CompanyName?: string };
    };
    return body.CompanyInfo?.CompanyName ?? "QuickBooks company";
  }

  async listAccounts(): Promise<RemoteAccount[]> {
    const rows = await this.query<{ Id: string; FullyQualifiedName: string; AcctNum?: string; AccountType: string }>(
      "select * from Account where Active = true maxresults 1000",
      "Account",
    );
    return rows.map((a) => ({
      id: a.Id,
      name: a.AcctNum ? `${a.AcctNum} ${a.FullyQualifiedName}` : a.FullyQualifiedName,
      type: a.AccountType,
      unusableReason:
        a.AccountType === "Accounts Payable"
          ? "Accounts Payable lines require a vendor"
          : undefined,
    }));
  }

  async listClasses(): Promise<RemoteOption[]> {
    const rows = await this.query<{ Id: string; FullyQualifiedName: string }>(
      "select * from Class where Active = true maxresults 1000",
      "Class",
    );
    return rows.map((c) => ({ id: c.Id, name: c.FullyQualifiedName }));
  }

  async postJournal(journal: RemoteJournal, idempotencyKey: string) {
    const docNumber = journal.reference.slice(0, 21);
    // A previous attempt may have succeeded before we could record it.
    const existing = await this.query<{ Id: string }>(
      `select Id from JournalEntry where DocNumber = '${docNumber.replaceAll("'", "\\'")}'`,
      "JournalEntry",
    );
    if (existing[0]) return existing[0].Id;
    const body = (await this.request("POST", "/journalentry", {
      body: toQboJournalEntry(journal),
      query: { requestid: idempotencyKey.slice(0, 50) },
    })) as { JournalEntry: { Id: string } };
    return body.JournalEntry.Id;
  }

  ensureCustomer = async (payer: { id: string; name: string; email: string | null }) => {
    const payload = toQboCustomer(payer);
    const existing = await this.query<{ Id: string }>(
      `select Id from Customer where DisplayName = '${payload.DisplayName.replaceAll("'", "\\'")}'`,
      "Customer",
    );
    if (existing[0]) return existing[0].Id;
    const body = (await this.request("POST", "/customer", {
      body: payload,
      query: { requestid: `cust-${payer.id}`.slice(0, 50) },
    })) as { Customer: { Id: string } };
    return body.Customer.Id;
  };
}

// --- Xero ------------------------------------------------------------------

type XeroError = { Message?: string; Detail?: string; Elements?: { ValidationErrors?: { Message: string }[] }[] };

export class XeroClient implements AccountingClient {
  provider = "XERO" as const;
  private base = "https://api.xero.com/api.xro/2.0";

  constructor(
    private accessToken: string,
    private tenantId: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private request(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string } = {}) {
    return requestJson(
      this.fetchImpl,
      `${this.base}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "xero-tenant-id": this.tenantId,
          Accept: "application/json",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
          ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      },
      (status, body) => {
        const err = body as XeroError;
        const validation = err?.Elements?.flatMap((e) => e.ValidationErrors ?? []).map((v) => v.Message);
        return `Xero ${status}: ${validation?.length ? validation.join("; ") : err?.Detail ?? err?.Message ?? JSON.stringify(body)}`;
      },
    );
  }

  async companyName() {
    const body = (await this.request("GET", "/Organisation")) as { Organisations?: { Name: string }[] };
    return body.Organisations?.[0]?.Name ?? "Xero organisation";
  }

  async listAccounts(): Promise<RemoteAccount[]> {
    const body = (await this.request("GET", "/Accounts")) as {
      Accounts: { Code?: string; Name: string; Type: string; SystemAccount?: string; Status: string }[];
    };
    return body.Accounts.filter((a) => a.Status === "ACTIVE").map((a) => ({
      id: a.Code ?? "",
      name: a.Code ? `${a.Code} ${a.Name}` : a.Name,
      type: a.Type,
      unusableReason: !a.Code
        ? "Account has no code (manual journals post by code)"
        : a.SystemAccount
          ? "Xero system accounts can't be used in manual journals — map to a regular account such as “Tuition Receivable (Nestwise)”"
          : undefined,
    }));
  }

  async listClasses(): Promise<RemoteOption[]> {
    const body = (await this.request("GET", "/TrackingCategories")) as {
      TrackingCategories: { Name: string; Options: { Name: string }[] }[];
    };
    return body.TrackingCategories.flatMap((c) =>
      c.Options.map((o) => ({ id: `${c.Name}::${o.Name}`, name: `${c.Name}: ${o.Name}` })),
    );
  }

  async postJournal(journal: RemoteJournal, idempotencyKey: string) {
    const body = (await this.request("PUT", "/ManualJournals", {
      body: { ManualJournals: [toXeroManualJournal(journal)] },
      idempotencyKey,
    })) as { ManualJournals: { ManualJournalID: string }[] };
    return body.ManualJournals[0].ManualJournalID;
  }

  // Xero manual journals can't carry a contact; payer names go in line descriptions.
  ensureCustomer = null;
}
