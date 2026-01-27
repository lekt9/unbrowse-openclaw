/**
 * Unbrowse Skill Index Server
 *
 * Cloud marketplace for API skills discovered by unbrowse agents.
 * Skills are published for free, downloaded via x402 USDC payments on Base.
 * Creators earn per download — wallet address embedded in each skill.
 *
 * Routes:
 *   GET  /skills/search           — Free full-text search
 *   GET  /skills/:id/summary      — Free skill summary with endpoints
 *   GET  /skills/:id/download     — x402 paywalled full skill package
 *   POST /skills/publish          — Publish a skill (free)
 *   GET  /health                  — Health check
 */

import { initDb } from "./db.js";
import { searchSkills } from "./routes/search.js";
import { getSkillSummary } from "./routes/summary.js";
import { downloadSkill } from "./routes/download.js";
import { publishSkill } from "./routes/publish.js";

const PORT = parseInt(process.env.PORT ?? "4402");
const OPERATOR_WALLET = process.env.OPERATOR_WALLET ?? "";
const DOWNLOAD_PRICE_USD = parseFloat(process.env.DOWNLOAD_PRICE ?? "0.01");

// Initialize database
initDb();
console.log(`[unbrowse-index] Database initialized`);

// ── x402 setup ──────────────────────────────────────────────────────────────

let paymentMiddleware: ((req: Request) => Promise<Response | null>) | null = null;

async function setupX402() {
  if (!OPERATOR_WALLET) {
    console.log("[unbrowse-index] No OPERATOR_WALLET set — downloads are free (dev mode)");
    return;
  }

  try {
    const { createPaymentMiddleware } = await import("x402/server");
    const facilitatorUrl = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
    const network = process.env.NETWORK ?? "base-sepolia";

    paymentMiddleware = createPaymentMiddleware({
      payTo: OPERATOR_WALLET as `0x${string}`,
      network,
      facilitatorUrl,
      priceUsd: DOWNLOAD_PRICE_USD,
    });

    console.log(`[unbrowse-index] x402 enabled — $${DOWNLOAD_PRICE_USD} USDC per download → ${OPERATOR_WALLET}`);
  } catch (err) {
    console.warn(`[unbrowse-index] x402 setup failed (downloads will be free): ${err}`);
  }
}

await setupX402();

// ── Router ──────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Payment-Signature",
      "Access-Control-Expose-Headers": "Payment-Required, Payment-Response",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response: Response;

      // Health check
      if (path === "/health" && method === "GET") {
        response = Response.json({ ok: true, service: "unbrowse-skill-index" });
      }
      // Search
      else if (path === "/skills/search" && method === "GET") {
        response = searchSkills(req);
      }
      // Summary (free)
      else if (path.match(/^\/skills\/([^/]+)\/summary$/) && method === "GET") {
        const id = path.match(/^\/skills\/([^/]+)\/summary$/)![1];
        response = getSkillSummary(id);
      }
      // Download (x402 paywalled)
      else if (path.match(/^\/skills\/([^/]+)\/download$/) && method === "GET") {
        // Apply x402 payment gate
        if (paymentMiddleware) {
          const paymentResult = await paymentMiddleware(req);
          if (paymentResult) {
            // Payment required or failed — return the 402 response
            return addCors(paymentResult, corsHeaders);
          }
          // Payment verified — proceed with download
        }

        const id = path.match(/^\/skills\/([^/]+)\/download$/)![1];
        response = downloadSkill(id);
      }
      // Publish
      else if (path === "/skills/publish" && method === "POST") {
        response = await publishSkill(req);
      }
      // 404
      else {
        response = Response.json({ error: "Not found" }, { status: 404 });
      }

      return addCors(response, corsHeaders);
    } catch (err) {
      console.error(`[unbrowse-index] Error: ${err}`);
      return addCors(
        Response.json({ error: "Internal server error" }, { status: 500 }),
        corsHeaders,
      );
    }
  },
});

function addCors(resp: Response, headers: Record<string, string>): Response {
  const newHeaders = new Headers(resp.headers);
  for (const [k, v] of Object.entries(headers)) {
    newHeaders.set(k, v);
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: newHeaders,
  });
}

console.log(`[unbrowse-index] Listening on http://localhost:${server.port}`);
