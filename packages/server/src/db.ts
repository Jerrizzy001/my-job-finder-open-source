import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * The local database: one SQLite file, `.jobfinder/jobfinder.sqlite`.
 *
 * Uses Node's built-in `node:sqlite`, so there is nothing native to compile.
 * Migrations are forward-only: each runs once, in order, and is never edited
 * after it ships. Add a new one at the end.
 *
 * Single-user, but per-user tables keep a `user_id` column ('local') so the
 * shape matches a multi-user deployment.
 */

export const LOCAL_USER = 'local'

const MIGRATIONS: readonly string[] = [
  // 1: the whole first schema
  `
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    workplace_type TEXT,
    description TEXT,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    employment_type TEXT,
    posted_at TEXT,
    ai_input INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE TABLE job_aliases (
    source TEXT NOT NULL,
    tenant TEXT NOT NULL,
    source_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    PRIMARY KEY (source, tenant, source_id)
  );
  CREATE INDEX job_aliases_job ON job_aliases(job_id);
  CREATE TABLE boards (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    token TEXT NOT NULL,
    company TEXT NOT NULL,
    host TEXT,
    site TEXT,
    url TEXT,
    cadence_hours REAL NOT NULL DEFAULT 6,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    paused_at TEXT,
    paused_reason TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    UNIQUE (source, token)
  );
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id),
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    outcome TEXT NOT NULL,
    message TEXT,
    seen INTEGER NOT NULL,
    selected INTEGER NOT NULL,
    hydrated INTEGER NOT NULL,
    gone INTEGER NOT NULL,
    requests INTEGER NOT NULL,
    bytes INTEGER NOT NULL
  );
  CREATE INDEX runs_board ON runs(board_id, started_at);
  CREATE TABLE preferences (
    user_id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    hash TEXT NOT NULL,
    scoring_revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE profile (
    user_id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE matches (
    user_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    status TEXT NOT NULL,
    score INTEGER NOT NULL,
    tier TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    scoring_revision INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT 'new',
    scored_at TEXT NOT NULL,
    PRIMARY KEY (user_id, job_id)
  );
  CREATE INDEX matches_rank ON matches(user_id, status, score DESC);
  CREATE TABLE answers (
    user_id TEXT NOT NULL,
    question_key TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, question_key)
  );
  CREATE TABLE drafts (
    user_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    dir TEXT NOT NULL,
    llm_used INTEGER NOT NULL,
    verified INTEGER NOT NULL,
    problems_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, job_id)
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    status TEXT NOT NULL,
    package_json TEXT,
    prepared_at TEXT,
    submitted_at TEXT,
    note TEXT,
    UNIQUE (user_id, job_id)
  );
  CREATE TABLE llm_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_usd REAL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function migrate(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
    version: number
  }
  let version = row.version
  if (version > MIGRATIONS.length)
    throw new Error(
      `The database is at schema ${version}, newer than this code (${MIGRATIONS.length}). Update the code.`,
    )
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version + 1,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    version++
  }
  return version
}

export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
