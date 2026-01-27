/**
 * Stealth Browser — Cloud browser sessions via Browser Use API.
 *
 * Creates remote browser sessions with anti-detection, proxy support,
 * and full CDP access. Bypasses restrictions that block local browsers.
 *
 * Browser Use API:
 *   POST   /browsers          — create session ($0.06/hr)
 *   GET    /browsers           — list sessions
 *   GET    /browsers/{id}     — get session
 *   PATCH  /browsers/{id}     — stop session
 *
 * Each session returns:
 *   - cdpUrl:  Chrome DevTools Protocol URL for Playwright/Puppeteer
 *   - liveUrl: Real-time viewing URL (shareable)
 */

import type { CdpNetworkEntry, HarEntry } from "./types.js";

const BROWSER_USE_API = "https://api.browser-use.com/api/v1";

/** Browser Use session data. */
export interface StealthSession {
  id: string;
  status: "active" | "stopped";
  cdpUrl: string;
  liveUrl: string;
  timeoutAt?: string;
}

/** Options for creating a stealth browser session. */
export interface StealthSessionOptions {
  /** Session timeout in minutes (default: 15, max: 240 for paid). */
  timeout?: number;
  /** Profile ID to inherit login state. */
  profileId?: string;
  /** Proxy country code (e.g., "US", "GB", "SG"). */
  proxyCountryCode?: string;
}

/**
 * Create a stealth cloud browser session via Browser Use API.
 */
export async function createStealthSession(
  apiKey: string,
  opts: StealthSessionOptions = {},
): Promise<StealthSession> {
  const body: Record<string, unknown> = {
    timeout: opts.timeout ?? 15,
  };
  if (opts.profileId) body.profileId = opts.profileId;
  if (opts.proxyCountryCode) body.proxyCountryCode = opts.proxyCountryCode;

  const resp = await fetch(`${BROWSER_USE_API}/browsers`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Browser Use API failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as StealthSession;
  return data;
}

/**
 * Stop a stealth browser session.
 */
export async function stopStealthSession(
  apiKey: string,
  sessionId: string,
): Promise<void> {
  const resp = await fetch(`${BROWSER_USE_API}/browsers/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "stop" }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Failed to stop session (${resp.status}): ${text}`);
  }
}

/**
 * Get session status.
 */
export async function getStealthSession(
  apiKey: string,
  sessionId: string,
): Promise<StealthSession> {
  const resp = await fetch(`${BROWSER_USE_API}/browsers/${sessionId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Failed to get session (${resp.status})`);
  }

  return resp.json() as Promise<StealthSession>;
}

/**
 * List all browser sessions.
 */
export async function listStealthSessions(
  apiKey: string,
  filterBy?: "active" | "stopped",
): Promise<StealthSession[]> {
  const url = new URL(`${BROWSER_USE_API}/browsers`);
  if (filterBy) url.searchParams.set("filterBy", filterBy);

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Failed to list sessions (${resp.status})`);
  }

  return resp.json() as Promise<StealthSession[]>;
}

/**
 * Capture network traffic from a remote stealth browser via CDP.
 *
 * Connects to the remote browser's CDP URL and uses the Network domain
 * to capture all requests made during the session.
 *
 * This is the remote equivalent of cdp-capture.ts's local capture.
 * Since we can't access 127.0.0.1 on the remote box, we use CDP
 * Network.getResponseBody and collect events.
 *
 * NOTE: This requires a CDP library (Playwright) to connect. The tool
 * that calls this should handle the Playwright connection lifecycle.
 */
export async function captureFromStealth(cdpUrl: string): Promise<{
  entries: CdpNetworkEntry[];
  har: { log: { entries: HarEntry[] } };
}> {
  // Use CDP protocol directly via WebSocket to capture network data.
  // This is a lightweight approach that doesn't require Playwright installed
  // in the extension — we use the raw CDP WebSocket protocol.
  const ws = new WebSocket(cdpUrl);

  return new Promise((resolve, reject) => {
    const entries: CdpNetworkEntry[] = [];
    const pendingRequests = new Map<string, Partial<CdpNetworkEntry>>();
    let msgId = 1;

    const timeout = setTimeout(() => {
      ws.close();
      finalize();
    }, 15_000);

    ws.onopen = () => {
      // Enable Network domain to capture traffic
      ws.send(JSON.stringify({ id: msgId++, method: "Network.enable" }));
      // Get already-captured entries from current page
      ws.send(JSON.stringify({ id: msgId++, method: "Network.getCookies" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));

        // Network.requestWillBeSent — new request
        if (msg.method === "Network.requestWillBeSent") {
          const req = msg.params?.request;
          const requestId = msg.params?.requestId;
          if (req && requestId) {
            pendingRequests.set(requestId, {
              requestId,
              url: req.url,
              method: req.method,
              headers: req.headers ?? {},
              postData: req.postData,
              timestamp: msg.params.timestamp,
            });
          }
        }

        // Network.responseReceived — response arrived
        if (msg.method === "Network.responseReceived") {
          const requestId = msg.params?.requestId;
          const response = msg.params?.response;
          const pending = pendingRequests.get(requestId);
          if (pending && response) {
            pending.responseStatus = response.status;
            pending.responseHeaders = response.headers;
            pending.resourceType = msg.params.type;
            entries.push(pending as CdpNetworkEntry);
            pendingRequests.delete(requestId);
          }
        }
      } catch {
        // Ignore parse errors on CDP messages
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error(`CDP WebSocket error: ${err}`));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      finalize();
    };

    function finalize() {
      // Add any pending requests that didn't get a response
      for (const pending of pendingRequests.values()) {
        entries.push(pending as CdpNetworkEntry);
      }

      const harEntries: HarEntry[] = entries.map((e) => ({
        request: {
          method: e.method,
          url: e.url,
          headers: Object.entries(e.headers ?? {}).map(([name, value]) => ({ name, value })),
          cookies: [],
        },
        response: {
          status: e.responseStatus ?? 0,
          headers: Object.entries(e.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
        },
        time: e.timestamp,
      }));

      resolve({
        entries,
        har: { log: { entries: harEntries } },
      });
    }
  });
}
