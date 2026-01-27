/**
 * GET /skills/:id/download — x402 paywalled skill package download.
 *
 * This route is protected by x402 middleware in the main server.
 * When payment is verified, returns the full skill package.
 */

import { getDb } from "../db.js";
import type { SkillPackage } from "../types.js";

export function downloadSkill(id: string): Response {
  const db = getDb();

  const row = db.query(`
    SELECT id, service, base_url, auth_method_type,
           endpoints_json, skill_md, api_template, creator_wallet
    FROM skills WHERE id = ?
  `).get(id) as any;

  if (!row) {
    return Response.json({ error: "Skill not found" }, { status: 404 });
  }

  // Increment download count
  db.run(`UPDATE skills SET download_count = download_count + 1 WHERE id = ?`, [id]);

  // Track download
  db.run(
    `INSERT INTO downloads (skill_id, amount_usd) VALUES (?, ?)`,
    [id, 0.01],
  );

  // Update creator earnings
  db.run(`
    INSERT INTO creator_earnings (creator_wallet, total_earned_usd, total_downloads, pending_usd)
    VALUES (?, 0.01, 1, 0.01)
    ON CONFLICT(creator_wallet) DO UPDATE SET
      total_earned_usd = total_earned_usd + 0.01,
      total_downloads = total_downloads + 1,
      pending_usd = pending_usd + 0.01
  `, [row.creator_wallet]);

  const pkg: SkillPackage = {
    id: row.id,
    service: row.service,
    baseUrl: row.base_url,
    authMethodType: row.auth_method_type,
    endpoints: JSON.parse(row.endpoints_json ?? "[]"),
    skillMd: row.skill_md,
    apiTemplate: row.api_template,
  };

  return Response.json(pkg);
}
