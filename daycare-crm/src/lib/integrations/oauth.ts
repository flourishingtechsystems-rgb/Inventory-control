// OAuth 2.0 (authorization code + refresh) for QuickBooks Online and Xero.

import type { FetchLike } from "./clients";
import type { ProviderKey } from "./mappers";

export const PROVIDER_SLUGS: Record<string, ProviderKey> = {
  quickbooks: "QUICKBOOKS",
  xero: "XERO",
};

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  QUICKBOOKS: "QuickBooks Online",
  XERO: "Xero",
};

export function slugFor(provider: ProviderKey) {
  return provider === "QUICKBOOKS" ? "quickbooks" : "xero";
}

function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function oauthConfig(provider: ProviderKey) {
  if (provider === "QUICKBOOKS") {
    return {
      authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      clientId: process.env.QBO_CLIENT_ID ?? "",
      clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
      scopes: "com.intuit.quickbooks.accounting",
      redirectUri: `${appUrl()}/api/integrations/quickbooks/callback`,
    };
  }
  return {
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    revokeUrl: "https://identity.xero.com/connect/revocation",
    clientId: process.env.XERO_CLIENT_ID ?? "",
    clientSecret: process.env.XERO_CLIENT_SECRET ?? "",
    scopes:
      process.env.XERO_SCOPES ??
      "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings",
    redirectUri: `${appUrl()}/api/integrations/xero/callback`,
  };
}

export function isConfigured(provider: ProviderKey) {
  const c = oauthConfig(provider);
  return Boolean(c.clientId && c.clientSecret);
}

export function authorizeUrl(provider: ProviderKey, state: string) {
  const c = oauthConfig(provider);
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    scope: c.scopes,
    redirect_uri: c.redirectUri,
    state,
  });
  return `${c.authorizeUrl}?${params}`;
}

export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: Date };

async function tokenRequest(provider: ProviderKey, form: Record<string, string>, fetchImpl: FetchLike): Promise<TokenSet> {
  const c = oauthConfig(provider);
  const res = await fetchImpl(c.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      `Token request failed (${res.status}): ${body.error_description ?? body.error ?? "unknown error"}`,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 1800) * 1000),
  };
}

export function exchangeCode(provider: ProviderKey, code: string, fetchImpl: FetchLike = fetch) {
  return tokenRequest(
    provider,
    { grant_type: "authorization_code", code, redirect_uri: oauthConfig(provider).redirectUri },
    fetchImpl,
  );
}

// Both providers rotate refresh tokens, so the new one must always be stored.
export function refreshTokens(provider: ProviderKey, refreshToken: string, fetchImpl: FetchLike = fetch) {
  return tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

export async function revokeToken(provider: ProviderKey, refreshToken: string, fetchImpl: FetchLike = fetch) {
  const c = oauthConfig(provider);
  const auth = `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  await fetchImpl(c.revokeUrl, provider === "QUICKBOOKS"
    ? {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: refreshToken }),
      }
    : {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
}

/** Xero issues one token for many organisations; pick the first connected one. */
export async function xeroTenants(accessToken: string, fetchImpl: FetchLike = fetch) {
  const res = await fetchImpl("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Could not list Xero organisations (${res.status}).`);
  return (await res.json()) as { tenantId: string; tenantName: string; tenantType: string }[];
}
