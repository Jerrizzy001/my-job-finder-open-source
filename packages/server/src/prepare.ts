import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownToText, type Llm } from '@jobfinder/tailor'
import { answerQuestions, listAnswers, type AnsweredQuestion, type FormQuestion } from './answers.ts'
import { LOCAL_USER, type Db } from './db.ts'
import { tailorJob, type Manifest } from './drafts.ts'
import type { JobRow } from './match.ts'
import { readProfile, type Workspace } from './workspace.ts'

/**
 * The answer package: everything the extension may type into one
 * application, and nothing else. It is built from your profile, your vault
 * and the job's verified drafts. Questions nobody answered are listed as
 * `needs_user`; the extension shows them and fills nothing for them.
 */

export type AnswerPackage = {
  jobId: number
  company: string
  title: string
  jobUrl: string
  profile: {
    name: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    location: string | null
    links: { label: string; url: string }[]
  }
  resume: { fileName: string; path: string; download: string }
  coverLetter: { fileName: string; path: string; download: string; text: string }
  verified: boolean
  notes: string[]
  questions: AnsweredQuestion[]
}

export async function prepareApplication(
  db: Db,
  ws: Workspace,
  jobId: number,
  options: { questions?: readonly FormQuestion[]; llm: Llm | null; now?: Date },
): Promise<AnswerPackage> {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
  if (!job) throw new Error(`No job #${jobId}.`)
  const profile = readProfile(ws)
  if (!profile) throw new Error('profile.json is missing.')

  const draft = db.prepare('SELECT dir FROM drafts WHERE user_id = ? AND job_id = ?').get(LOCAL_USER, jobId) as
    | { dir: string }
    | undefined
  const dir =
    draft && existsSync(join(draft.dir, 'manifest.json'))
      ? draft.dir
      : (await tailorJob(db, ws, jobId, options.llm, options.now)).dir
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
  const [firstName = '', ...rest] = profile.name.trim().split(/\s+/)
  const safeName = profile.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume'

  const pkg: AnswerPackage = {
    jobId,
    company: job.company,
    title: job.title,
    jobUrl: job.url,
    profile: {
      name: profile.name,
      firstName,
      lastName: rest.join(' '),
      email: profile.email,
      phone: profile.phone ?? null,
      location: profile.location ?? null,
      links: profile.links ?? [],
    },
    resume: {
      fileName: `${safeName}-Resume.pdf`,
      path: join(dir, manifest.files.resumePdf),
      download: `/api/ext/files/${jobId}/resume.pdf`,
    },
    coverLetter: {
      fileName: `${safeName}-Cover-Letter.pdf`,
      path: join(dir, manifest.files.coverLetterPdf),
      download: `/api/ext/files/${jobId}/cover-letter.pdf`,
      text: markdownToText(readFileSync(join(dir, manifest.files.coverLetterMd), 'utf8')).replace(/^#\s*/, ''),
    },
    verified: manifest.verified,
    notes: manifest.notes,
    questions: answerQuestions(options.questions ?? [], profile, listAnswers(db)),
  }

  const now = (options.now ?? new Date()).toISOString()
  db.prepare(
    `INSERT INTO applications (user_id, job_id, status, package_json, prepared_at) VALUES (?, ?, 'prepared', ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET package_json = excluded.package_json, prepared_at = excluded.prepared_at
       , status = CASE WHEN applications.status = 'submitted' THEN 'submitted' ELSE 'prepared' END`,
  ).run(LOCAL_USER, jobId, JSON.stringify({ ...pkg, coverLetter: { ...pkg.coverLetter, text: undefined } }), now)
  return pkg
}

/** Record that you submitted. Only you know that you did; the extension asks you. */
export function markSubmitted(db: Db, jobId: number, note: string | null = null, now = new Date()): void {
  db.prepare(
    `INSERT INTO applications (user_id, job_id, status, submitted_at, note) VALUES (?, ?, 'submitted', ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at, note = COALESCE(excluded.note, applications.note)`,
  ).run(LOCAL_USER, jobId, now.toISOString(), note)
}

export function draftFile(db: Db, jobId: number, name: string): { path: string; type: string } | null {
  const files: Record<string, [keyof Manifest['files'], string]> = {
    'resume.pdf': ['resumePdf', 'application/pdf'],
    'cover-letter.pdf': ['coverLetterPdf', 'application/pdf'],
    'resume.md': ['resumeMd', 'text/markdown; charset=utf-8'],
    'cover-letter.md': ['coverLetterMd', 'text/markdown; charset=utf-8'],
  }
  const entry = files[name]
  if (!entry) return null
  const draft = db.prepare('SELECT dir FROM drafts WHERE user_id = ? AND job_id = ?').get(LOCAL_USER, jobId) as
    | { dir: string }
    | undefined
  if (!draft) return null
  const manifestPath = join(draft.dir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  const path = join(draft.dir, manifest.files[entry[0]])
  return existsSync(path) ? { path, type: entry[1] } : null
}
