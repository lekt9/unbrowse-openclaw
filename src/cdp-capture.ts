/**
 * CDP Capture — Live network capture via clawdbot's browser control API.
 *
 * Uses the Playwright-backed browser control HTTP API to fetch captured
 * network requests, response bodies, and cookies from a running browser
 * session. No Chrome extension required — works with the managed `clawd` profile.
 *
 * Browser control API (default port 18791):
 *   GET  /requests         — all captured network requests
 *   POST /response/body    — get response body for a specific request
 *   GET  /cookies          — all cookies from the browser
 *   POST /cookies/set      — set a cookie
 *   POST /cookies/clear    — clear cookies
 */

import type { HarEntry, CdpNetworkEntry } from "./types.js";

/** Default browser control port (matches clawdbot browser tool). */
const DEFAULT_PORT = 18791;

/**
 * Fetch all captured network requests from the browser control API.
 */
export async function fetchCapturedRequests(port = DEFAULT_PORT): Promise<CdpNetworkEntry[]> {
  const resp = await fetch(`http://127.0.0.1:${port}/requests`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(`Browser control API /requests failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<CdpNetworkEntry[]>;
}

/**
 * Fetch response body for a specific request ID.
 */
export async function fetchResponseBody(requestId: string, port = DEFAULT_PORT): Promise<string | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/response/body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { body?: string };
    return data.body ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch all cookies from the browser session.
 */
export async function fetchBrowserCookies(port = DEFAULT_PORT): Promise<Record<string, string>> {
  const resp = await fetch(`http://127.0.0.1:${port}/cookies`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(`Browser control API /cookies failed: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json() as { name: string; value: string }[];
  const cookies: Record<string, string> = {};
  for (const c of data) {
    cookies[c.name] = c.value;
  }
  return cookies;
}

/**
 * Convert CDP network entries to HAR format for pipeline reuse.
 *
 * This lets us feed live browser captures through the same HAR parser
 * that handles uploaded HAR files.
 */
export function cdpToHar(entries: CdpNetworkEntry[]): { log: { entries: HarEntry[] } } {
  const harEntries: HarEntry[] = entries.map((entry) => ({
    request: {
      method: entry.method,
      url: entry.url,
      headers: Object.entries(entry.headers ?? {}).map(([name, value]) => ({ name, value })),
      cookies: [], // Cookies fetched separately
    },
    response: {
      status: entry.responseStatus ?? 0,
      headers: Object.entries(entry.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
    },
    time: entry.timestamp,
  }));

  return {
    log: {
      entries: harEntries,
    },
  };
}

/**
 * Capture network traffic + cookies from a running browser session
 * and convert to HAR format ready for the parser pipeline.
 *
 * Call this after the browser has been opened and pages visited.
 */
export async function captureFromBrowser(port = DEFAULT_PORT): Promise<{
  har: { log: { entries: HarEntry[] } };
  cookies: Record<string, string>;
  requestCount: number;
}> {
  const [entries, cookies] = await Promise.all([
    fetchCapturedRequests(port),
    fetchBrowserCookies(port),
  ]);

  const har = cdpToHar(entries);

  // Inject cookies into HAR entries so the parser can pick them up
  const cookieArray = Object.entries(cookies).map(([name, value]) => ({ name, value }));
  for (const entry of har.log.entries) {
    entry.request.cookies = cookieArray;
  }

  return {
    har,
    cookies,
    requestCount: entries.length,
  };
}
