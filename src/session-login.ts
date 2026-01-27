/**
 * Session Login — Credential-based browser session for Docker/cloud environments.
 *
 * When there's no Chrome profile available (Docker, CI, cloud), users can provide
 * credentials and the system will log in via a stealth browser, capturing the
 * resulting cookies/headers for future API calls.
 *
 * Two browser backends:
 *   1. BrowserBase (stealth cloud) — anti-detection, proxy, no local Chrome needed
 *   2. Local Playwright — fallback, launches bundled Chromium with stealth flags
 */

import type { HarEntry } from "./types.js";

export interface LoginCredentials {
  /** Form field selectors → values to fill. e.g. { "#email": "me@x.com", "#password": "..." } */
  formFields?: Record<string, string>;
  /** Selector for the submit button (default: auto-detect form submit) */
  submitSelector?: string;
  /** Headers to inject on every request (e.g. API key auth) */
  headers?: Record<string, string>;
  /** Pre-set cookies to inject before navigation */
  cookies?: Array<{ name: string; value: string; domain: string }>;
}

export interface LoginResult {
  /** Captured cookies after login (name → value) */
  cookies: Record<string, string>;
  /** Auth headers seen in requests after login */
  authHeaders: Record<string, string>;
  /** Base URL derived from the login URL */
  baseUrl: string;
  /** Number of network requests captured */
  requestCount: number;
  /** HAR log for skill generation */
  har: { log: { entries: HarEntry[] } };
}

interface CapturedEntry {
  method: string;
  url: string;
  headers: Record<string, string>;
  resourceType: string;
  status: number;
  responseHeaders: Record<string, string>;
  timestamp: number;
}

const AUTH_HEADER_NAMES = new Set([
  "authorization", "x-api-key", "api-key", "apikey",
  "x-auth-token", "access-token", "x-access-token",
  "token", "x-token", "x-csrf-token", "x-xsrf-token",
]);

/**
 * Log in via a stealth cloud browser (BrowserBase) or local Playwright.
 *
 * Flow:
 *   1. Launch browser (stealth cloud if API key provided, otherwise local)
 *   2. Inject any pre-set cookies/headers
 *   3. Navigate to login URL
 *   4. Fill form credentials and submit
 *   5. Wait for post-login navigation
 *   6. Visit additional URLs to capture API traffic
 *   7. Extract cookies + auth headers from the authenticated session
 */
export async function loginAndCapture(
  loginUrl: string,
  credentials: LoginCredentials,
  opts: {
    /** BrowserBase API key — if set, uses stealth cloud browser */
    browserUseApiKey?: string;
    /** Additional URLs to visit after login to capture API traffic */
    captureUrls?: string[];
    /** Wait time per page in ms (default: 5000) */
    waitMs?: number;
    /** Proxy country for BrowserBase */
    proxyCountry?: string;
  } = {},
): Promise<LoginResult> {
  const { chromium } = await import("playwright");
  const waitMs = opts.waitMs ?? 5000;
  const captured: CapturedEntry[] = [];
  const pendingRequests = new Map<string, Partial<CapturedEntry>>();

  // Decide browser backend
  let browser: any;
  let context: any;
  let usingStealth = false;

  if (opts.browserUseApiKey) {
    // Use BrowserBase stealth cloud browser
    const { createStealthSession } = await import("./stealth-browser.js");
    const session = await createStealthSession(opts.browserUseApiKey, {
      timeout: 15,
      proxyCountryCode: opts.proxyCountry,
    });

    browser = await chromium.connectOverCDP(session.cdpUrl);
    context = browser.contexts()[0];
    if (!context) {
      context = await browser.newContext();
    }
    usingStealth = true;
  } else {
    // Local Playwright with stealth flags
    context = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    }).then(async (b) => {
      browser = b;
      return b.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
    });
  }

  // Attach network capture listeners
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

  const page = context.pages()[0] ?? await context.newPage();
  attachListeners(page);

  // Inject pre-set cookies before navigating
  if (credentials.cookies && credentials.cookies.length > 0) {
    await context.addCookies(credentials.cookies);
  }

  // Inject custom headers on all requests
  if (credentials.headers && Object.keys(credentials.headers).length > 0) {
    await context.setExtraHTTPHeaders(credentials.headers);
  }

  // Navigate to login page
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    await page.waitForTimeout(waitMs);
  }

  // Fill form credentials
  if (credentials.formFields && Object.keys(credentials.formFields).length > 0) {
    for (const [selector, value] of Object.entries(credentials.formFields)) {
      try {
        await page.waitForSelector(selector, { timeout: 10_000 });
        await page.fill(selector, value);
        // Small delay between fields to look more human
        await page.waitForTimeout(200 + Math.random() * 300);
      } catch {
        // Try clicking + typing if fill doesn't work (some custom inputs)
        try {
          await page.click(selector);
          await page.keyboard.type(value, { delay: 50 + Math.random() * 50 });
        } catch {
          // Skip this field if we can't find it
        }
      }
    }

    // Submit the form
    if (credentials.submitSelector) {
      try {
        await page.click(credentials.submitSelector);
      } catch {
        // Try pressing Enter as fallback
        await page.keyboard.press("Enter");
      }
    } else {
      // Auto-detect: try common submit buttons, then Enter
      const submitted = await page.evaluate(() => {
        const btn =
          document.querySelector('button[type="submit"]') ??
          document.querySelector('input[type="submit"]') ??
          document.querySelector('button:not([type])');
        if (btn instanceof HTMLElement) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!submitted) {
        await page.keyboard.press("Enter");
      }
    }

    // Wait for post-login navigation
    try {
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 });
    } catch {
      await page.waitForTimeout(waitMs);
    }
  }

  // Visit additional URLs to capture API traffic in the authenticated session
  const captureUrls = opts.captureUrls ?? [];
  for (const url of captureUrls) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      await page.waitForTimeout(waitMs);
    }
    await page.waitForTimeout(waitMs);
  }

  // Extract cookies from the authenticated session
  const browserCookies = await context.cookies();
  const cookies: Record<string, string> = {};
  for (const c of browserCookies) {
    cookies[c.name] = c.value;
  }

  // Extract auth headers seen in captured requests
  const authHeaders: Record<string, string> = {};
  for (const entry of captured) {
    for (const [name, value] of Object.entries(entry.headers)) {
      if (AUTH_HEADER_NAMES.has(name.toLowerCase())) {
        authHeaders[name.toLowerCase()] = value;
      }
    }
  }

  // Derive base URL from the login URL
  const parsedUrl = new URL(loginUrl);
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

  // Clean up
  if (usingStealth) {
    await browser?.close().catch(() => {});
  } else {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

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
    cookies,
    authHeaders,
    baseUrl,
    requestCount: captured.length,
    har: { log: { entries: harEntries } },
  };
}
