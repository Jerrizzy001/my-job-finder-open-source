import { normalizeTitle, selectByTitle, studentLevel, type Preferences } from '@jobfinder/core'
import {
  Politeness,
  runBoard,
  type Board,
  type CatalogEntry,
  type RunOptions,
  type RunResult,
  type SourcedJob,
} from '@jobfinder/sources'
import { transaction, type Db } from './db.ts'

/**
 * Discovery: read the boards that are due, keep the postings the saved
 * search selects by title, and keep a ledger of every run.
 */

/** Failures in a row (not counting rate limits) after which a board is paused. */
export const PAUSE_AFTER_FAILURES = 3

type BoardRow = {
  id: number
  source: string
  token: string
  company: string
  host: string | null
  site: string | null
  url: string | null
  cadence_hours: number
  consecutive_failures: number
  paused_at: string | null
  next_run_at: string | null
}

export function boardFromRow(row: BoardRow): Board {
  const board: Board = {
    company: row.company,
    source: row.source as Board['source'],
    token: row.token,
    cadenceHours: row.cadence_hours,
  }
  if (row.host) board.host = row.host
  if (row.site) board.site = row.site
  if (row.url) board.url = row.url
  return board
}

/** Make the boards table match the catalog. Boards dropped from the catalog are paused, not deleted. */
export function syncBoards(db: Db, catalog: readonly CatalogEntry[], now = new Date()): void {
  transaction(db, () => {
    const upsert = db.prepare(`
      INSERT INTO boards (source, token, company, host, site, url, cadence_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, token) DO UPDATE SET
        company = excluded.company, host = excluded.host, site = excluded.site, url = excluded.url,
        cadence_hours = excluded.cadence_hours,
        paused_at = CASE WHEN boards.paused_reason = 'removed_from_catalog' THEN NULL ELSE boards.paused_at END,
        paused_reason = CASE WHEN boards.paused_reason = 'removed_from_catalog' THEN NULL ELSE boards.paused_reason END`)
    const keys = new Set<string>()
    for (const entry of catalog) {
      keys.add(`${entry.source}\u0000${entry.token}`)
      upsert.run(
        entry.source,
        entry.token,
        entry.company,
        entry.host ?? null,
        entry.site ?? null,
        entry.url ?? null,
        Number(entry.cadenceHours ?? 6),
      )
    }
    const pause = db.prepare(
      "UPDATE boards SET paused_at = ?, paused_reason = 'removed_from_catalog' WHERE id = ? AND paused_at IS NULL",
    )
    for (const row of db.prepare('SELECT id, source, token FROM boards').all() as {
      id: number
      source: string
      token: string
    }[])
      if (!keys.has(`${row.source}\u0000${row.token}`)) pause.run(now.toISOString(), row.id)
  })
}

export function dueBoards(db: Db, now = new Date(), all = false): BoardRow[] {
  const rows = db.prepare('SELECT * FROM boards WHERE paused_at IS NULL ORDER BY id').all() as BoardRow[]
  return all ? rows : rows.filter((row) => !row.next_run_at || row.next_run_at <= now.toISOString())
}

/** Search terms for boards that search (Workday): the work words of each saved title. */
export function searchTermsFor(prefs: Preferences): string[] {
  const terms = prefs.roleTitles.map((title) => normalizeTitle(studentLevel(title).rest)).filter(Boolean)
  return [...new Set(terms)].slice(0, 6)
}

/** Insert or update postings, through their (source, tenant, id) alias. */
export function upsertJobs(
  db: Db,
  jobs: readonly SourcedJob[],
  now = new Date(),
): { inserted: number; updated: number } {
  const at = now.toISOString()
  let inserted = 0
  let updated = 0
  const findAlias = db.prepare('SELECT job_id FROM job_aliases WHERE source = ? AND tenant = ? AND source_id = ?')
  const insertJob = db.prepare(`
    INSERT INTO jobs (title, company, location, workplace_type, description, url, source, employment_type, posted_at, ai_input, first_seen_at, last_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertAlias = db.prepare('INSERT INTO job_aliases (source, tenant, source_id, job_id) VALUES (?, ?, ?, ?)')
  const current = db.prepare('SELECT title, location, workplace_type, description, url FROM jobs WHERE id = ?')
  const updateJob = db.prepare(`
    UPDATE jobs SET title = ?, company = ?, location = ?, workplace_type = ?, description = COALESCE(?, description), url = ?,
      employment_type = ?, posted_at = COALESCE(?, posted_at), ai_input = ?, last_seen_at = ?, closed_at = NULL,
      updated_at = CASE WHEN ? THEN ? ELSE updated_at END
    WHERE id = ?`)

  transaction(db, () => {
    for (const job of jobs) {
      const alias = findAlias.get(job.source, job.tenant, job.sourceId) as { job_id: number } | undefined
      const aiInput = job.aiInput === false ? 0 : 1
      if (!alias) {
        const result = insertJob.run(
          job.title,
          job.company,
          job.location,
          job.workplaceType,
          job.description,
          job.url,
          job.source,
          job.employmentType ?? null,
          job.postedAt ?? null,
          aiInput,
          at,
          at,
          at,
        )
        insertAlias.run(job.source, job.tenant, job.sourceId, Number(result.lastInsertRowid))
        inserted++
        continue
      }
      const before = current.get(alias.job_id) as Record<string, string | null>
      const changed =
        before.title !== job.title ||
        before.location !== job.location ||
        before.workplace_type !== job.workplaceType ||
        (job.description !== null && before.description !== job.description) ||
        before.url !== job.url
      updateJob.run(
        job.title,
        job.company,
        job.location,
        job.workplaceType,
        job.description,
        job.url,
        job.employmentType ?? null,
        job.postedAt ?? null,
        aiInput,
        at,
        changed ? 1 : 0,
        at,
        alias.job_id,
      )
      if (changed) updated++
    }
  })
  return { inserted, updated }
}

/**
 * After a complete read, a stored posting the board no longer lists has
 * closed. A partial or failed read closes nothing.
 */
export function closeMissing(db: Db, board: Board, seenIds: readonly string[], now = new Date()): number {
  const seen = new Set(seenIds)
  const rows = db
    .prepare(
      'SELECT a.source_id, a.job_id FROM job_aliases a JOIN jobs j ON j.id = a.job_id WHERE a.source = ? AND a.tenant = ? AND j.closed_at IS NULL',
    )
    .all(board.source, board.token) as { source_id: string; job_id: number }[]
  const close = db.prepare('UPDATE jobs SET closed_at = ? WHERE id = ?')
  let closed = 0
  transaction(db, () => {
    for (const row of rows)
      if (!seen.has(row.source_id)) {
        close.run(now.toISOString(), row.job_id)
        closed++
      }
  })
  return closed
}

/** Record a run and move the board's schedule, pausing it after repeated failures. */
export function recordRun(db: Db, boardId: number, result: RunResult, now = new Date()): void {
  const board = db.prepare('SELECT cadence_hours, consecutive_failures FROM boards WHERE id = ?').get(boardId) as {
    cadence_hours: number
    consecutive_failures: number
  }
  db.prepare(
    `INSERT INTO runs (board_id, started_at, finished_at, outcome, message, seen, selected, hydrated, gone, requests, bytes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    boardId,
    result.startedAt,
    result.finishedAt,
    result.outcome,
    result.message,
    result.seen,
    result.selected,
    result.hydrated,
    result.gone,
    result.requests,
    result.bytes,
  )
  const ok = result.outcome === 'complete_full' || result.outcome === 'complete_partial'
  const failures = ok
    ? 0
    : result.outcome === 'rate_limited'
      ? board.consecutive_failures
      : board.consecutive_failures + 1
  const hours = result.outcome === 'rate_limited' ? Math.max(board.cadence_hours, 1) * 2 : board.cadence_hours
  const next = new Date(now.getTime() + hours * 3600_000).toISOString()
  const pause = failures >= PAUSE_AFTER_FAILURES
  db.prepare(
    'UPDATE boards SET consecutive_failures = ?, last_run_at = ?, next_run_at = ?, paused_at = ?, paused_reason = ? WHERE id = ?',
  ).run(
    failures,
    now.toISOString(),
    next,
    pause ? now.toISOString() : null,
    pause ? `${result.outcome} ${failures} times in a row` : null,
    boardId,
  )
}

export type DiscoverSummary = {
  boards: number
  seen: number
  selected: number
  inserted: number
  updated: number
  closed: number
  outcomes: Record<string, number>
}

export type DiscoverOptions = Pick<RunOptions, 'fetch' | 'clock' | 'limits'> & {
  all?: boolean
  politeness?: Politeness
  now?: () => Date
  log?: (line: string) => void
}

export async function discover(db: Db, prefs: Preferences, options: DiscoverOptions = {}): Promise<DiscoverSummary> {
  const now = options.now ?? (() => new Date())
  const politeness = options.politeness ?? new Politeness()
  const summary: DiscoverSummary = { boards: 0, seen: 0, selected: 0, inserted: 0, updated: 0, closed: 0, outcomes: {} }
  const select = (job: SourcedJob) => selectByTitle(job.title, prefs).tier !== 'none'
  const searchTerms = searchTermsFor(prefs)

  for (const row of dueBoards(db, now(), options.all)) {
    const board = boardFromRow(row)
    const result = await runBoard(board, {
      select,
      searchTerms,
      politeness,
      fetch: options.fetch,
      clock: options.clock,
      limits: options.limits,
    })
    const stored = upsertJobs(db, result.jobs, now())
    const closed = result.outcome === 'complete_full' ? closeMissing(db, board, result.seenIds, now()) : 0
    recordRun(db, row.id, result, now())
    summary.boards++
    summary.seen += result.seen
    summary.selected += result.selected
    summary.inserted += stored.inserted
    summary.updated += stored.updated
    summary.closed += closed
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] ?? 0) + 1
    options.log?.(
      `${board.company.padEnd(22)} ${board.source.padEnd(15)} ${result.outcome.padEnd(17)} seen ${String(result.seen).padStart(4)}  kept ${String(result.selected).padStart(3)}  new ${stored.inserted}${result.message ? `  (${result.message})` : ''}`,
    )
  }
  return summary
}
