/**
 * Profile Capture — Network capture using Playwright with Chrome's real profile.
 *
 * Launches Chrome via Playwright using the user's actual Chrome profile,
 * so all cookies, sessions, extensions, and saved passwords are available.
 * Captures full request + response headers directly from Playwright events
 * — no clawdbot patch needed.
 *
 * Two modes:
 *   1. Launch with profile: opens Chrome with the user's profile dir
 *      (Chrome must be closed first — only one instance per profile)
 *   2. Connect via CDP: attaches to a running Chrome with --remote-debugging-port
 *      (Chrome can stay open, but must be started with the flag)
 */

import type { HarEntry } from "./types.js";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

/** Captured request with full headers. */
interface CapturedEntry {
  method: string;
  url: string;
  headers: Record<string, string>;
  resourceType: string;
  status: number;
  responseHeaders: Record<string, string>;
  timestamp: number;
}

/** Default Chrome profile paths by platform. */
function getDefaultChromeProfilePath(): string {
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") {
    return join(home, "Library", "Application Support", "Google", "Chrome");
  }
  if (plat === "win32") {
    return join(home, "AppData", "Local", "Google", "Chrome", "User Data");
  }
  // Linux
  return join(home, ".config", "google-chrome");
}

/**
 * Capture network traffic by launching Chrome with the user's real profile.
 *
 * Navigates to the given URLs, waits for network activity, and captures
 * all requests + responses with full headers. The user's cookies and
 * logged-in sessions are available — the browser is already authenticated.
 *
 * @param urls - URLs to visit and capture traffic from
 * @param opts.profilePath - Chrome user data dir (auto-detected if not set)
 * @param opts.waitMs - How long to wait on each page for network activity (default: 5000)
 * @param opts.headless - Run headless (default: false — visible so user can interact)
 */
export async function captureFromChromeProfile(
  urls: string[],
  opts: {
    profilePath?: string;
    waitMs?: number;
    headless?: boolean;
  } = {},
): Promise<{
  har: { log: { entries: HarEntry[] } };
  cookies: Record<string, string>;
  requestCount: number;
  entries: CapturedEntry[];
}> {
  const { chromium } = await import("playwright");

  const profilePath = opts.profilePath ?? getDefaultChromeProfilePath();
  const waitMs = opts.waitMs ?? 5000;

  if (!existsSync(profilePath)) {
    throw new Error(`Chrome profile not found: ${profilePath}. Specify profilePath manually.`);
  }

  // Capture buffer
  const captured: CapturedEntry[] = [];
  const pendingRequests = new Map<string, Partial<CapturedEntry>>();

  const context = await chromium.launchPersistentContext(profilePath, {
    channel: "chrome",
    headless: opts.headless ?? false,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // Listen to all pages (including popups)
  function attachListeners(page: any) {
    page.on("request", (req: any) => {
      const entry: Partial<CapturedEntry> = {
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      };
      pendingRequests.set(req.url() + req.method(), entry);
    });

    page.on("response", (resp: any) => {
      const req = resp.request();
      const key = req.url() + req.method();
      const entry = pendingRequests.get(key);
      if (entry) {
        entry.status = resp.status();
        entry.responseHeaders = resp.headers();
        captured.push(entry as CapturedEntry);
        pendingRequests.delete(key);
      }
    });
  }

  // Attach to existing pages
  for (const page of context.pages()) {
    attachListeners(page);
  }

  // Attach to new pages
  context.on("page", (page: any) => attachListeners(page));

  // Navigate to each URL
  for (const url of urls) {
    const page = context.pages()[0] ?? await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      // Some pages never reach networkidle — that's fine, we still capture
      await page.waitForTimeout(waitMs);
    }
    await page.waitForTimeout(waitMs);
  }

  // Extract cookies
  const browserCookies = await context.cookies();
  const cookies: Record<string, string> = {};
  for (const c of browserCookies) {
    cookies[c.name] = c.value;
  }

  await context.close();

  // Convert to HAR format
  const harEntries: HarEntry[] = captured.map((entry) => ({
    request: {
      method: entry.method,
      url: entry.url,
      headers: Object.entries(entry.headers).map(([name, value]) => ({ name, value })),
      cookies: Object.entries(cookies).map(([name, value]) => ({ name, value })),
    },
    response: {
      status: entry.status,
      headers: Object.entries(entry.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
    },
    time: entry.timestamp,
  }));

  return {
    har: { log: { entries: harEntries } },
    cookies,
    requestCount: captured.length,
    entries: captured,
  };
}

/**
 * Capture by connecting to an already-running Chrome via CDP.
 *
 * Chrome must be started with --remote-debugging-port=9222.
 * This mode doesn't require closing Chrome first.
 */
export async function captureFromChromeDebug(
  urls: string[],
  opts: {
    cdpUrl?: string;
    waitMs?: number;
  } = {},
): Promise<{
  har: { log: { entries: HarEntry[] } };
  cookies: Record<string, string>;
  requestCount: number;
  entries: CapturedEntry[];
}> {
  const { chromium } = await import("playwright");

  const cdpUrl = opts.cdpUrl ?? "http://127.0.0.1:9222";
  const waitMs = opts.waitMs ?? 5000;

  const captured: CapturedEntry[] = [];
  const pendingRequests = new Map<string, Partial<CapturedEntry>>();

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No browser context found. Is Chrome running with --remote-debugging-port?");
  }

  function attachListeners(page: any) {
    page.on("request", (req: any) => {
      pendingRequests.set(req.url() + req.method(), {
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      });
    });

    page.on("response", (resp: any) => {
      const req = resp.request();
      const key = req.url() + req.method();
      const entry = pendingRequests.get(key);
      if (entry) {
        entry.status = resp.status();
        entry.responseHeaders = resp.headers();
        captured.push(entry as CapturedEntry);
        pendingRequests.delete(key);
      }
    });
  }

  for (const page of context.pages()) {
    attachListeners(page);
  }
  context.on("page", (page: any) => attachListeners(page));

  for (const url of urls) {
    const page = context.pages()[0] ?? await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      await page.waitForTimeout(waitMs);
    }
    await page.waitForTimeout(waitMs);
  }

  const browserCookies = await context.cookies();
  const cookies: Record<string, string> = {};
  for (const c of browserCookies) {
    cookies[c.name] = c.value;
  }

  // Don't close — user's Chrome stays open
  await browser.close();

  const harEntries: HarEntry[] = captured.map((entry) => ({
    request: {
      method: entry.method,
      url: entry.url,
      headers: Object.entries(entry.headers).map(([name, value]) => ({ name, value })),
      cookies: Object.entries(cookies).map(([name, value]) => ({ name, value })),
    },
    response: {
      status: entry.status,
      headers: Object.entries(entry.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
    },
    time: entry.timestamp,
  }));

  return {
    har: { log: { entries: harEntries } },
    cookies,
    requestCount: captured.length,
    entries: captured,
  };
}
