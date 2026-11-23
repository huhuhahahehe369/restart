-- RE:START M09 Cloud Sync
-- Run once in the Cloudflare D1 Console.
-- Only encrypted application snapshots are stored in this table.

CREATE TABLE IF NOT EXISTS restart_sync (
    sync_id TEXT PRIMARY KEY NOT NULL,
    salt TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'gzip-json-v1',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restart_sync_updated_at
ON restart_sync(updated_at);