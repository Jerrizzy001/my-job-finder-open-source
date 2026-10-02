/**
 * What the popup, the background worker and the page script agree on.
 * The extension talks to one place only: your jobfinder on 127.0.0.1.
 */

export type Settings = { port: number; token: string }

export type FormQuestion = { label: string; required: boolean; type: string; options?: string[] }

export type AnsweredQuestion = {
  label: string
  required: boolean
  status: 'answered' | 'needs_user'
  answer: string | null
  source: 'profile' | 'vault' | null
}

export type AnswerPackage = {
  jobId: number
  company: string
  title: string
  resume: { fileName: string; download: string }
  coverLetter: { fileName: string; download: string; text: string }
  verified: boolean
  notes: string[]
  questions: AnsweredQuestion[]
}

export type FileData = { fileName: string; base64: string; type: string }

export type Message =
  | { kind: 'package'; pageUrl: string; questions: FormQuestion[] }
  | { kind: 'file'; download: string; fileName: string }
  | { kind: 'submitted'; jobId: number }
  | { kind: 'ping' }

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

/** The ATS an application page belongs to, for the popup's message. */
export function atsOf(
  url: string,
): 'ashby' | 'greenhouse' | 'lever' | 'workday' | 'dayforce' | 'icims' | 'smartrecruiters' | 'workable' | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  if (host === 'jobs.ashbyhq.com') return 'ashby'
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse'
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return 'lever'
  if (host.endsWith('.myworkdayjobs.com')) return 'workday'
  if (host === 'jobs.dayforcehcm.com') return 'dayforce'
  if (host.endsWith('.icims.com')) return 'icims'
  if (host.endsWith('smartrecruiters.com')) return 'smartrecruiters'
  if (host === 'apply.workable.com') return 'workable'
  return null
}

/** An Ashby application page: jobs.ashbyhq.com/<org>/<uuid>/application */
export function isAshbyApplication(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'jobs.ashbyhq.com' && /^\/[^/]+\/[0-9a-f-]{36}\/application\/?$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

export const HOSTED_URL = 'https://myjobfinder.live'
