/**
 * Stealth Browser — Cloud browser sessions via Browser Use SDK.
 *
 * Creates remote browser sessions with anti-detection, proxy support,
 * and full CDP access. Bypasses restrictions that block local browsers.
 *
 * Uses the official browser-use-sdk (BrowserUseClient) for all API calls.
 *
 * Each session returns:
 *   - cdpUrl:  Chrome DevTools Protocol URL for Playwright/Puppeteer
 *   - liveUrl: Real-time viewing URL (shareable)
 */

import { BrowserUseClient } from "browser-use-sdk";
import type { CdpNetworkEntry, HarEntry } from "./types.js";

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
  /** Session timeout in minutes (default: 15, max: 240). */
  timeout?: number;
  /** Profile ID to inherit login state. */
  profileId?: string;
  /** Proxy country code (e.g., "US", "GB", "SG"). */
  proxyCountryCode?: string;
}

/**
 * Create a stealth cloud browser session via Browser Use SDK.
 */
export async function createStealthSession(
  apiKey: string,
  opts: StealthSessionOptions = {},
): Promise<StealthSession> {
  const client = new BrowserUseClient({ apiKey });

  const session = await client.browsers.createBrowserSession({
    timeout: opts.timeout ?? 15,
    profileId: opts.profileId ?? undefined,
    proxyCountryCode: (opts.proxyCountryCode as any) ?? undefined,
  });

  return {
    id: session.id,
    status: session.status as "active" | "stopped",
    cdpUrl: session.cdpUrl ?? "",
    liveUrl: session.liveUrl ?? "",
    timeoutAt: session.timeoutAt,
  };
}

/**
 * Stop a stealth browser session.
 */
export async function stopStealthSession(
  apiKey: string,
  sessionId: string,
): Promise<void> {
  const client = new BrowserUseClient({ apiKey });

  await client.browsers.updateBrowserSession({
    session_id: sessionId,
    action: "stop",
  });
}

/**
 * Get session status.
 */
export async function getStealthSession(
  apiKey: string,
  sessionId: string,
): Promise<StealthSession> {
  const client = new BrowserUseClient({ apiKey });

  const session = await client.browsers.getBrowserSession({
    session_id: sessionId,
  });

  return {
    id: session.id,
    status: session.status as "active" | "stopped",
    cdpUrl: session.cdpUrl ?? "",
    liveUrl: session.liveUrl ?? "",
    timeoutAt: session.timeoutAt,
  };
}

/**
 * List all browser sessions.
 */
export async function listStealthSessions(
  apiKey: string,
  filterBy?: "active" | "stopped",
): Promise<StealthSession[]> {
  const client = new BrowserUseClient({ apiKey });

  const response = await client.browsers.listBrowserSessions({
    filterBy: filterBy as any,
  });

  return response.items.map((s) => ({
    id: s.id,
    status: s.status as "active" | "stopped",
    cdpUrl: s.cdpUrl ?? "",
    liveUrl: s.liveUrl ?? "",
    timeoutAt: s.timeoutAt,
  }));
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
      for (const pending of Array.from(pendingRequests.values())) {
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
