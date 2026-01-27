/**
 * Auth Extractor — Determine authentication method and build auth.json.
 *
 * Ported from meta_learner_simple.py guess_auth_method() + generate_auth_json().
 */

import type { ApiData, AuthInfo } from "./types.js";

/**
 * Determine the auth method from extracted headers and cookies.
 */
export function guessAuthMethod(
  authHeaders: Record<string, string>,
  cookies: Record<string, string>,
): string {
  // Mudra token (Zeemart-specific)
  if ("mudra" in authHeaders) return "mudra token";

  // Bearer token
  for (const value of Object.values(authHeaders)) {
    if (value.toLowerCase().startsWith("bearer ")) return "Bearer Token";
  }

  // API key in headers
  if (Object.keys(authHeaders).length > 0) {
    return `API Key (${Object.keys(authHeaders)[0]})`;
  }

  // Cookie-based auth
  const authCookieNames = ["session", "sessionid", "token", "authtoken", "jwt", "auth"];
  for (const name of authCookieNames) {
    if (Object.keys(cookies).some((c) => c.toLowerCase() === name.toLowerCase())) {
      return `Cookie-based (${name})`;
    }
  }

  // Custom auth from any remaining headers/cookies
  const allNames = [...Object.keys(authHeaders), ...Object.keys(cookies)];
  for (const name of allNames) {
    if (name.toLowerCase().includes("auth") || name.toLowerCase().includes("token")) {
      return `Custom (${name})`;
    }
  }

  return "Unknown (may need login)";
}

/**
 * Generate auth.json data from parsed API data.
 */
export function generateAuthInfo(service: string, data: ApiData): AuthInfo {
  const auth: AuthInfo = {
    service,
    baseUrl: data.baseUrl,
    authMethod: data.authMethod,
    timestamp: new Date().toISOString(),
    notes: [],
  };

  // Headers
  if (Object.keys(data.authHeaders).length > 0) {
    auth.headers = { ...data.authHeaders };
    auth.notes.push(`Found ${Object.keys(data.authHeaders).length} auth header(s)`);
  }

  // Mudra token special handling
  if (data.authHeaders.mudra) {
    auth.mudraToken = data.authHeaders.mudra;
    auth.notes.push("mudra token extracted (session token)");
    if (data.authHeaders.mudra.includes("--")) {
      auth.userId = data.authHeaders.mudra.split("--")[0];
    }
  }

  // Outlet IDs
  const outletHeader = data.authInfo.request_header_outletid;
  if (outletHeader) {
    if (!auth.headers) auth.headers = {};
    auth.headers.outletid = outletHeader;
    auth.outletIds = outletHeader.split(",");
    auth.notes.push(`Found ${auth.outletIds.length} outlet ID(s)`);
  }

  // Cookies
  if (Object.keys(data.cookies).length > 0) {
    auth.cookies = { ...data.cookies };
    auth.notes.push(`Found ${Object.keys(data.cookies).length} cookie(s)`);
  }

  // Full auth info (limit to 20 entries)
  if (Object.keys(data.authInfo).length > 0) {
    auth.authInfo = Object.fromEntries(Object.entries(data.authInfo).slice(0, 20));
  }

  return auth;
}
