import { MATCHING_POLICY_VERSION, type Reason } from '@jobfinder/core'
import { LOCAL_USER, type Db } from './db.ts'
import { currentRevision } from './match.ts'

/**
 * What the CLI and the UI list. Only current matches are listed: a match
 * scored under an older policy or older preferences is stale and waits for
 * `matchJobs` to re-score it, so it is never shown as ready.
 */

export type Stage = 'for_you' | 'drafted' | 'applied' | 'dismissed' | 'pending'

export type ListedJob = {
  id: number
  title: string
  company: string
  location: string | null
  workplaceType: string | null
  url: string
  source: string
  postedAt: string | null
  firstSeenAt: string
  score: number
  tier: string
  status: string
  reasons: Reason[]
  stage: Stage
  draftDir: string | null
  draftVerified: boolean | null
  applicationStatus: string | null
}

type Row = {
  id: number
  title: string
  company: string
  location: string | null
  workplace_type: string | null
  url: string
  source: string
  posted_at: string | null
  first_seen_at: string
  score: number
  tier: string
  status: string
  reasons_json: string
  match_stage: string
  draft_dir: string | null
  draft_verified: number | null
  application_status: string | null
}

function stageOf(row: Row): Stage {
  if (row.application_status === 'submitted') return 'applied'
  if (row.match_stage === 'dismissed') return 'dismissed'
  if (row.status === 'pending') return 'pending'
  if (row.draft_dir) return 'drafted'
  return 'for_you'
}

export function listJobs(db: Db, options: { stage?: Stage | 'all'; limit?: number; jobId?: number } = {}): ListedJob[] {
  const rows = db
    .prepare(
      `
      SELECT j.id, j.title, j.company, j.location, j.workplace_type, j.url, j.source, j.posted_at, j.first_seen_at,
             m.score, m.tier, m.status, m.reasons_json, m.stage AS match_stage,
             d.dir AS draft_dir, d.verified AS draft_verified, a.status AS application_status
      FROM matches m
      JOIN jobs j ON j.id = m.job_id
      LEFT JOIN drafts d ON d.job_id = j.id AND d.user_id = m.user_id
      LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = m.user_id
      WHERE m.user_id = ? AND m.policy_version = ? AND m.scoring_revision = ?
        AND (j.closed_at IS NULL OR a.status = 'submitted')
        AND m.status != 'ineligible'
        AND (? IS NULL OR j.id = ?)
      ORDER BY m.score DESC, j.first_seen_at DESC`,
    )
    .all(
      LOCAL_USER,
      MATCHING_POLICY_VERSION,
      currentRevision(db),
      options.jobId ?? null,
      options.jobId ?? null,
    ) as Row[]

  const stage = options.stage ?? 'for_you'
  return rows
    .map(
      (row): ListedJob => ({
        id: row.id,
        title: row.title,
        company: row.company,
        location: row.location,
        workplaceType: row.workplace_type,
        url: row.url,
        source: row.source,
        postedAt: row.posted_at,
        firstSeenAt: row.first_seen_at,
        score: row.score,
        tier: row.tier,
        status: row.status,
        reasons: JSON.parse(row.reasons_json) as Reason[],
        stage: stageOf(row),
        draftDir: row.draft_dir,
        draftVerified: row.draft_verified === null ? null : row.draft_verified === 1,
        applicationStatus: row.application_status,
      }),
    )
    .filter((job) => stage === 'all' || job.stage === stage)
    .slice(0, options.limit ?? 500)
}

export function setStage(db: Db, jobId: number, stage: 'new' | 'dismissed'): void {
  db.prepare('UPDATE matches SET stage = ? WHERE user_id = ? AND job_id = ?').run(stage, LOCAL_USER, jobId)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function jobsToCsv(jobs: readonly ListedJob[]): string {
  const header = [
    'id',
    'score',
    'tier',
    'stage',
    'company',
    'title',
    'location',
    'work_mode',
    'url',
    'source',
    'first_seen',
    'draft',
    'why',
  ]
  const lines = jobs.map((job) =>
    [
      job.id,
      job.score,
      job.tier,
      job.stage,
      job.company,
      job.title,
      job.location,
      job.workplaceType,
      job.url,
      job.source,
      job.firstSeenAt,
      job.draftDir,
      job.reasons.map((r) => r.text).join(' '),
    ]
      .map(csvCell)
      .join(','),
  )
  return `${[header.join(','), ...lines].join('\n')}\n`
}

export function recentRuns(db: Db, limit = 50) {
  return db
    .prepare(
      `SELECT r.*, b.company, b.source FROM runs r JOIN boards b ON b.id = r.board_id ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit)
}

export function boardStatus(db: Db) {
  return db
    .prepare(
      `SELECT b.id, b.company, b.source, b.token, b.paused_at, b.paused_reason, b.consecutive_failures, b.last_run_at, b.next_run_at,
              (SELECT outcome FROM runs r WHERE r.board_id = b.id ORDER BY r.id DESC LIMIT 1) AS last_outcome,
              (SELECT COUNT(*) FROM job_aliases a JOIN jobs j ON j.id = a.job_id WHERE a.source = b.source AND a.tenant = b.token AND j.closed_at IS NULL) AS open_jobs
              FROM boards b ORDER BY b.company`,
    )
    .all()
}
