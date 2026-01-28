/**
 * POST /skills/publish — Publish a skill to the index.
 *
 * Accepts a skill definition (no credentials) and stores it with the
 * creator's wallet address for x402 profit sharing.
 */

import { createHash } from "node:crypto";
import { getDb } from "../db.js";
import type { PublishBody } from "../types.js";

/** Generate a deterministic skill ID from service + baseUrl. */
function makeSkillId(service: string, baseUrl: string): string {
  return createHash("sha256")
    .update(`${service}:${baseUrl}`)
    .digest("hex")
    .slice(0, 16);
}

/** Generate a URL-safe slug from a service name. */
function makeSlug(service: string): string {
  return service
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Auto-derive tags from service name and endpoint paths. */
function deriveTags(service: string, endpoints: { path: string }[]): string[] {
  const tags = new Set<string>();

  // From service name
  if (service.includes("api")) tags.add("rest");
  if (/finance|stock|trade|bank|pay/i.test(service)) tags.add("finance");
  if (/social|tweet|post|feed/i.test(service)) tags.add("social");
  if (/auth|login|oauth/i.test(service)) tags.add("auth");
  if (/shop|store|product|cart|order/i.test(service)) tags.add("ecommerce");
  if (/ai|ml|model|chat|completion/i.test(service)) tags.add("ai");
  if (/mail|email|smtp/i.test(service)) tags.add("email");
  if (/storage|file|upload|s3|bucket/i.test(service)) tags.add("storage");
  if (/message|chat|notification/i.test(service)) tags.add("messaging");

  // From endpoints
  const allPaths = endpoints.map((e) => e.path).join(" ");
  if (allPaths.includes("/graphql")) tags.add("graphql");
  if (allPaths.includes("/ws") || allPaths.includes("/socket")) tags.add("websocket");
  if (/\/v\d+\//.test(allPaths)) tags.add("versioned");

  // Always add "rest" if endpoints use standard HTTP methods
  if (endpoints.length > 0 && !tags.has("graphql")) tags.add("rest");

  return [...tags];
}

export async function publishSkill(req: Request): Promise<Response> {
  let body: PublishBody;
  try {
    body = await req.json() as PublishBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.service || !body.baseUrl || !body.creatorWallet) {
    return Response.json(
      { error: "Missing required fields: service, baseUrl, creatorWallet" },
      { status: 400 },
    );
  }

  // Validate Solana wallet address (base58, 32-44 chars)
  if (!body.creatorWallet.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
    return Response.json(
      { error: "Invalid Solana wallet address." },
      { status: 400 },
    );
  }

  const db = getDb();
  const id = makeSkillId(body.service, body.baseUrl);
  const slug = makeSlug(body.service);
  const tags = deriveTags(body.service, body.endpoints ?? []);
  const searchText = [
    body.service,
    body.baseUrl,
    body.authMethodType,
    ...(body.endpoints ?? []).map((e) => `${e.method} ${e.path}`),
    ...tags,
  ].join(" ");

  // Check if skill exists
  const existing = db.query("SELECT id, creator_wallet, version FROM skills WHERE id = ?").get(id) as any;

  if (existing) {
    // Update if same creator
    if (existing.creator_wallet.toLowerCase() !== body.creatorWallet.toLowerCase()) {
      return Response.json(
        { error: "This skill was published by a different wallet. Fork not yet supported." },
        { status: 409 },
      );
    }

    const newVersion = (existing.version ?? 1) + 1;
    db.run(`
      UPDATE skills SET
        auth_method_type = ?,
        endpoints_json = ?,
        skill_md = ?,
        api_template = ?,
        endpoint_count = ?,
        tags_json = ?,
        search_text = ?,
        version = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      body.authMethodType,
      JSON.stringify(body.endpoints ?? []),
      body.skillMd ?? "",
      body.apiTemplate ?? "",
      (body.endpoints ?? []).length,
      JSON.stringify(tags),
      searchText,
      newVersion,
      id,
    ]);

    return Response.json({ id, slug, version: newVersion });
  }

  // Insert new skill
  db.run(`
    INSERT INTO skills (id, service, slug, version, base_url, auth_method_type,
                        endpoints_json, skill_md, api_template, creator_wallet,
                        endpoint_count, tags_json, search_text)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, body.service, slug, body.baseUrl, body.authMethodType,
    JSON.stringify(body.endpoints ?? []),
    body.skillMd ?? "",
    body.apiTemplate ?? "",
    body.creatorWallet,
    (body.endpoints ?? []).length,
    JSON.stringify(tags),
    searchText,
  ]);

  return Response.json({ id, slug, version: 1 }, { status: 201 });
}
