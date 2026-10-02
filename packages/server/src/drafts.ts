import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { costUsd, renderPdf, tailorDrafts, type Drafts, type Llm } from '@jobfinder/tailor'
import { LOCAL_USER, type Db } from './db.ts'
import type { JobRow } from './match.ts'
import { listJobs } from './queries.ts'
import { masterResumePath, readMasterResume, readProfile, type Workspace } from './workspace.ts'

/**
 * Writing drafts to `drafts/<company>-<title>/`:
 *
 *   resume.md, resume.pdf, cover-letter.md, cover-letter.pdf, manifest.json
 *
 * The manifest is what `prepare` and the extension read: which files, which
 * job, whether the drafts were verified, and what the model (if any) did.
 */

export const DEFAULT_DRAFT_LIMIT = 10

export function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'job'
  )
}

export type Manifest = {
  jobId: number
  company: string
  title: string
  url: string
  createdAt: string
  llmUsed: boolean
  model: string | null
  verified: boolean
  problems: string[]
  notes: string[]
  files: { resumeMd: string; resumePdf: string; coverLetterMd: string; coverLetterPdf: string }
}

function draftDir(ws: Workspace, job: JobRow): string {
  const base = join(ws.draftsDir, `${slug(job.company)}-${slug(job.title)}`)
  const manifestPath = join(base, 'manifest.json')
  if (!existsSync(manifestPath)) return base
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  return manifest.jobId === job.id ? base : `${base}-${job.id}`
}

function logUsage(db: Db, drafts: Drafts, now: Date) {
  const insert = db.prepare(
    'INSERT INTO llm_log (at, purpose, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const usage of drafts.usage)
    insert.run(
      now.toISOString(),
      'tailor',
      drafts.model ?? 'unknown',
      usage.promptTokens,
      usage.completionTokens,
      costUsd(usage),
    )
}

export type TailorResult = { manifest: Manifest; dir: string }

export async function tailorJob(
  db: Db,
  ws: Workspace,
  jobId: number,
  llm: Llm | null,
  now = new Date(),
): Promise<TailorResult> {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
  if (!job) throw new Error(`No job #${jobId}.`)
  const profile = readProfile(ws)
  if (!profile) throw new Error('profile.json is missing. Run "jobfinder init" and fill it in.')
  const masterResume = readMasterResume(ws, profile)
  if (!masterResume) throw new Error(`Master resume not found at ${masterResumePath(ws, profile)}.`)
  const reasons = listJobs(db, { stage: 'all', jobId })[0]?.reasons.map((reason) => reason.text) ?? []

  const drafts = await tailorDrafts(
    {
      profile,
      masterResume,
      job: { title: job.title, company: job.company, description: job.description, aiInput: job.ai_input === 1 },
      reasons,
      today: now,
    },
    llm,
  )
  logUsage(db, drafts, now)

  const dir = draftDir(ws, job)
  mkdirSync(dir, { recursive: true })
  const files = {
    resumeMd: join(dir, 'resume.md'),
    resumePdf: join(dir, 'resume.pdf'),
    coverLetterMd: join(dir, 'cover-letter.md'),
    coverLetterPdf: join(dir, 'cover-letter.pdf'),
  }
  writeFileSync(files.resumeMd, drafts.resume)
  writeFileSync(files.coverLetterMd, drafts.coverLetter)
  writeFileSync(files.resumePdf, renderPdf(drafts.resume, { title: `${profile.name} — Resume`, author: profile.name }))
  writeFileSync(
    files.coverLetterPdf,
    renderPdf(drafts.coverLetter, { title: `${profile.name} — Cover letter, ${job.company}`, author: profile.name }),
  )
  const manifest: Manifest = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    createdAt: now.toISOString(),
    llmUsed: drafts.llmUsed,
    model: drafts.model,
    verified: drafts.verified,
    problems: drafts.problems,
    notes: drafts.notes,
    files: Object.fromEntries(
      Object.entries(files).map(([key, path]) => [key, relative(dir, path)]),
    ) as Manifest['files'],
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  db.prepare(
    `INSERT INTO drafts (user_id, job_id, dir, llm_used, verified, problems_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET dir = excluded.dir, llm_used = excluded.llm_used, verified = excluded.verified,
       problems_json = excluded.problems_json, created_at = excluded.created_at`,
  ).run(
    LOCAL_USER,
    job.id,
    dir,
    drafts.llmUsed ? 1 : 0,
    drafts.verified ? 1 : 0,
    JSON.stringify(drafts.problems),
    now.toISOString(),
  )
  return { manifest, dir }
}

/** Draft the best eligible matches that have no draft yet, up to `limit`. */
export async function tailorBest(
  db: Db,
  ws: Workspace,
  options: { limit?: number; llm: Llm | null; log?: (line: string) => void },
): Promise<TailorResult[]> {
  const jobs = listJobs(db, { stage: 'for_you' }).slice(0, options.limit ?? DEFAULT_DRAFT_LIMIT)
  const results: TailorResult[] = []
  for (const job of jobs) {
    const result = await tailorJob(db, ws, job.id, options.llm)
    results.push(result)
    const warning = result.manifest.verified ? '' : '  (NOT verified: read it before using)'
    options.log?.(
      `${String(job.score).padStart(3)}  ${job.title} — ${job.company}  →  ${relative(ws.root, result.dir)}${warning}`,
    )
  }
  return results
}

export function llmUsageTotals(db: Db): {
  calls: number
  promptTokens: number
  completionTokens: number
  costUsd: number | null
} {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS c, SUM(cost_usd) AS cost FROM llm_log',
    )
    .get() as { calls: number; p: number; c: number; cost: number | null }
  return { calls: row.calls, promptTokens: row.p, completionTokens: row.c, costUsd: row.cost }
}
