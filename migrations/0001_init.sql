-- Kaam Kotha Jobs: employer job posts (D1). Apply with:
--   npx wrangler d1 execute kaam-kotha-jobs --remote --file migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS posts (
 id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT, approved_at TEXT, expires_at TEXT,
 title TEXT NOT NULL, industry TEXT NOT NULL, employer TEXT NOT NULL, country TEXT NOT NULL, town TEXT NOT NULL, postcode TEXT,
 pay_amount REAL NOT NULL, pay_period TEXT NOT NULL, hourly_equiv REAL NOT NULL, hours_per_week REAL NOT NULL, contract_type TEXT NOT NULL,
 student_friendly INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL, apply_method TEXT NOT NULL, apply_value TEXT NOT NULL,
 contact_email TEXT NOT NULL, ip_hash TEXT, user_agent TEXT, moderation_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, expires_at);
CREATE TABLE IF NOT EXISTS submit_log (ip_hash TEXT NOT NULL, created_at TEXT NOT NULL, outcome TEXT);
CREATE INDEX IF NOT EXISTS idx_submit_ip ON submit_log(ip_hash, created_at);
