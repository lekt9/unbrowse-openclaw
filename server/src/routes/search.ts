/**
 * GET /skills/search — Free full-text search over the skill index.
 */

import { getDb } from "../db.js";
import type { SkillSummary } from "../types.js";

export function searchSkills(req: Request): Response {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const tags = url.searchParams.get("tags") ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const db = getDb();

  let skills: SkillSummary[];
  let total: number;

  // Only show approved skills in search results (unless ?include_unreviewed=true for admin)
  const includeUnreviewed = url.searchParams.get("include_unreviewed") === "true";
  const reviewFilter = includeUnreviewed
    ? "AND (s.review_status = 'approved' OR s.review_status IS NULL OR s.review_status = 'pending')"
    : "AND (s.review_status = 'approved' OR s.review_status IS NULL)";
  // Note: IS NULL handles legacy rows that predate the review system

  if (query) {
    // Full-text search via FTS5
    const ftsQuery = query.split(/\s+/).map((w) => `"${w}"`).join(" OR ");
    const rows = db.query(`
      SELECT s.id, s.service, s.slug, s.base_url, s.auth_method_type,
             s.endpoint_count, s.download_count, s.tags_json,
             s.creator_wallet, s.creator_alias, s.updated_at,
             s.review_status, s.review_score
      FROM skills s
      JOIN skills_fts fts ON s.rowid = fts.rowid
      WHERE skills_fts MATCH ? ${reviewFilter}
      ORDER BY s.download_count DESC
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset) as any[];

    const countRow = db.query(`
      SELECT COUNT(*) as cnt
      FROM skills s
      JOIN skills_fts fts ON s.rowid = fts.rowid
      WHERE skills_fts MATCH ? ${reviewFilter}
    `).get(ftsQuery) as any;

    total = countRow?.cnt ?? 0;
    skills = rows.map(mapRow);
  } else if (tags) {
    // Tag-based filter
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase());
    const rows = db.query(`
      SELECT s.id, s.service, s.slug, s.base_url, s.auth_method_type,
             s.endpoint_count, s.download_count, s.tags_json,
             s.creator_wallet, s.creator_alias, s.updated_at,
             s.review_status, s.review_score
      FROM skills s
      WHERE (${tagList.map(() => "s.tags_json LIKE ?").join(" OR ")}) ${reviewFilter}
      ORDER BY s.download_count DESC
      LIMIT ? OFFSET ?
    `).all(...tagList.map((t) => `%"${t}"%`), limit, offset) as any[];

    total = rows.length;
    skills = rows.map(mapRow);
  } else {
    // Browse all — most popular first
    const rows = db.query(`
      SELECT s.id, s.service, s.slug, s.base_url, s.auth_method_type,
             s.endpoint_count, s.download_count, s.tags_json,
             s.creator_wallet, s.creator_alias, s.updated_at,
             s.review_status, s.review_score
      FROM skills s
      WHERE 1=1 ${reviewFilter}
      ORDER BY s.download_count DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];

    const countRow = db.query(`SELECT COUNT(*) as cnt FROM skills s WHERE 1=1 ${reviewFilter}`).get() as any;
    total = countRow?.cnt ?? 0;
    skills = rows.map(mapRow);
  }

  return Response.json({ skills, total });
}

function mapRow(row: any): SkillSummary & { reviewStatus?: string; reviewScore?: number | null } {
  return {
    id: row.id,
    service: row.service,
    slug: row.slug,
    baseUrl: row.base_url,
    authMethodType: row.auth_method_type,
    endpointCount: row.endpoint_count,
    downloadCount: row.download_count,
    tags: JSON.parse(row.tags_json ?? "[]"),
    creatorWallet: row.creator_wallet,
    creatorAlias: row.creator_alias ?? undefined,
    updatedAt: row.updated_at,
    reviewStatus: row.review_status ?? "approved",
    reviewScore: row.review_score ?? null,
  };
}
