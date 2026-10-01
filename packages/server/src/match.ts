import { createHash } from 'node:crypto'
import {
  applyFitProposal,
  evaluateJob,
  MATCHING_POLICY_VERSION,
  noopFitScorer,
  type FitScorer,
  type Job,
  type Preferences,
  type Reason,
  type WorkMode,
} from '@jobfinder/core'
import { LOCAL_USER, transaction, type Db } from './db.ts'

/**
 * Matching: score every open posting against the saved search.
 *
 * A match records the policy version and the preferences revision it was
 * scored under. Editing preferences bumps the revision; changing rules bumps
 * the policy version. Either makes a match stale, and a stale match is
 * re-scored before anything shows it.
 */

export type JobRow = {
  id: number
  title: string
  company: string
  location: string | null
  workplace_type: string | null
  description: string | null
  url: string
  source: string
  employment_type: string | null
  posted_at: string | null
  ai_input: number
  first_seen_at: string
  updated_at: string
  closed_at: string | null
}

export function jobFromRow(row: JobRow): Job {
  return {
    title: row.title,
    company: row.company,
    location: row.location,
    workplaceType: (row.workplace_type as WorkMode | null) ?? null,
    description: row.description,
    url: row.url,
    source: row.source,
    employmentType: row.employment_type,
    postedAt: row.posted_at,
  }
}

function hashPreferences(prefs: Preferences): string {
  return createHash('sha256').update(JSON.stringify(prefs)).digest('hex')
}

/** Record the current preferences; bump the scoring revision when they changed. */
export function syncPreferences(db: Db, prefs: Preferences, now = new Date()): number {
  const hash = hashPreferences(prefs)
  const row = db.prepare('SELECT hash, scoring_revision FROM preferences WHERE user_id = ?').get(LOCAL_USER) as
    | { hash: string; scoring_revision: number }
    | undefined
  if (row?.hash === hash) return row.scoring_revision
  const revision = (row?.scoring_revision ?? 0) + 1
  db.prepare(
    `INSERT INTO preferences (user_id, json, hash, scoring_revision, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, hash = excluded.hash, scoring_revision = excluded.scoring_revision, updated_at = excluded.updated_at`,
  ).run(LOCAL_USER, JSON.stringify(prefs), hash, revision, now.toISOString())
  return revision
}

export function currentRevision(db: Db): number {
  const row = db.prepare('SELECT scoring_revision FROM preferences WHERE user_id = ?').get(LOCAL_USER) as
    | { scoring_revision: number }
    | undefined
  return row?.scoring_revision ?? 0
}

export type MatchSummary = {
  scored: number
  skipped: number
  eligible: number
  pending: number
  ineligible: number
  revision: number
}

export type MatchOptions = {
  profileSkills?: readonly string[]
  fitScorer?: FitScorer
  now?: Date
  /** Re-score everything, even current matches. */
  force?: boolean
}

export async function matchJobs(db: Db, prefs: Preferences, options: MatchOptions = {}): Promise<MatchSummary> {
  const now = options.now ?? new Date()
  const revision = syncPreferences(db, prefs, now)
  const fitScorer = options.fitScorer ?? noopFitScorer
  const rows = db
    .prepare(
      `
      SELECT j.*, m.policy_version, m.scoring_revision, m.scored_at
      FROM jobs j LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = ?
      WHERE j.closed_at IS NULL`,
    )
    .all(LOCAL_USER) as (JobRow & {
    policy_version: string | null
    scoring_revision: number | null
    scored_at: string | null
  })[]

  const summary: MatchSummary = { scored: 0, skipped: 0, eligible: 0, pending: 0, ineligible: 0, revision }
  const results: { jobId: number; status: string; score: number; tier: string; reasons: Reason[] }[] = []

  for (const row of rows) {
    const current =
      !options.force &&
      row.policy_version === MATCHING_POLICY_VERSION &&
      row.scoring_revision === revision &&
      row.scored_at !== null &&
      row.scored_at >= row.updated_at
    if (current) {
      summary.skipped++
      continue
    }
    const job = jobFromRow(row)
    let evaluation = evaluateJob(job, prefs, { profileSkills: options.profileSkills ?? [] })
    if (evaluation.status === 'eligible' && row.ai_input) {
      const proposal = await fitScorer.scoreJobFit(job, { skills: options.profileSkills ?? [] })
      evaluation = applyFitProposal(evaluation, proposal)
    }
    results.push({
      jobId: row.id,
      status: evaluation.status,
      score: evaluation.score,
      tier: evaluation.title.tier,
      reasons: evaluation.reasons,
    })
    summary.scored++
    summary[evaluation.status]++
  }

  const upsert = db.prepare(`
    INSERT INTO matches (user_id, job_id, status, score, tier, reasons_json, policy_version, scoring_revision, scored_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, job_id) DO UPDATE SET
      status = excluded.status, score = excluded.score, tier = excluded.tier, reasons_json = excluded.reasons_json,
      policy_version = excluded.policy_version, scoring_revision = excluded.scoring_revision, scored_at = excluded.scored_at`)
  transaction(db, () => {
    for (const result of results)
      upsert.run(
        LOCAL_USER,
        result.jobId,
        result.status,
        result.score,
        result.tier,
        JSON.stringify(result.reasons),
        MATCHING_POLICY_VERSION,
        revision,
        now.toISOString(),
      )
  })
  return summary
}
