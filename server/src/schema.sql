-- Unbrowse Skill Index — Cloud skill marketplace schema

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  version INTEGER DEFAULT 1,
  base_url TEXT NOT NULL,
  auth_method_type TEXT NOT NULL,
  endpoints_json TEXT NOT NULL,
  skill_md TEXT NOT NULL,
  api_template TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  creator_alias TEXT,
  endpoint_count INTEGER NOT NULL,
  download_count INTEGER DEFAULT 0,
  tags_json TEXT DEFAULT '[]',
  search_text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_service ON skills(service);
CREATE INDEX IF NOT EXISTS idx_skills_creator ON skills(creator_wallet);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  service, base_url, search_text, tags_text,
  content='skills',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts(rowid, service, base_url, search_text, tags_text)
  VALUES (new.rowid, new.service, new.base_url, new.search_text, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, service, base_url, search_text, tags_text)
  VALUES ('delete', old.rowid, old.service, old.base_url, old.search_text, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, service, base_url, search_text, tags_text)
  VALUES ('delete', old.rowid, old.service, old.base_url, old.search_text, old.tags_json);
  INSERT INTO skills_fts(rowid, service, base_url, search_text, tags_text)
  VALUES (new.rowid, new.service, new.base_url, new.search_text, new.tags_json);
END;

-- Track individual downloads for analytics
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  downloaded_at TEXT DEFAULT (datetime('now')),
  payment_tx TEXT,
  amount_usd REAL
);

-- Creator earnings tracking
CREATE TABLE IF NOT EXISTS creator_earnings (
  creator_wallet TEXT PRIMARY KEY,
  total_earned_usd REAL DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  last_payout_at TEXT,
  pending_usd REAL DEFAULT 0
);
