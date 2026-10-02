/** The local API, typed for the UI. Everything is same-origin on 127.0.0.1. */

export type ReasonKind = 'plus' | 'minus' | 'info' | 'fail'
export type Reason = { kind: ReasonKind; code: string; text: string; points?: number }
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

export type JobDetail = {
  job: ListedJob & { description: string | null; match: ListedJob | null; employment_type: string | null }
  draft: { resumeHtml: string; coverLetterHtml: string; verified: boolean; llmUsed: boolean; problems: string[] } | null
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite'

export type Preferences = {
  roleTitles: string[]
  excludedTitles: string[]
  locations: string[]
  remoteRegions: string[]
  workModes: WorkMode[]
  graduation: string | null
  blockedCompanies: string[]
  blockedTerms: string[]
  rejectedTitles: string[]
}

export type Experience = {
  employer: string
  title: string
  location?: string
  start: string
  end: string | null
  bullets: string[]
}
export type Education = { school: string; degree: string; field?: string; start?: string; end?: string }
export type Profile = {
  name: string
  email: string
  phone?: string
  location?: string
  headline?: string
  links?: { label: string; url: string }[]
  education: Education[]
  experience: Experience[]
  skills: string[]
  workAuthorization?: string
  masterResume?: string
}

export type VaultAnswer = { key: string; question: string; answer: string }

export type DiscoveryStatus = {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  log: string[]
  error: string | null
  summary: { boards: number; seen: number; selected: number; inserted: number; closed: number } | null
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`)
  return data
}

export const api = {
  health: () => call<{ ok: boolean; llm: string | null }>('/api/health'),
  jobs: (stage: Stage | 'all') => call<{ jobs: ListedJob[] }>(`/api/jobs?stage=${stage}`).then((r) => r.jobs),
  job: (id: number) => call<JobDetail>(`/api/jobs/${id}`),
  dismiss: (id: number) => call(`/api/jobs/${id}/dismiss`, { body: {} }),
  restore: (id: number) => call(`/api/jobs/${id}/restore`, { body: {} }),
  tailor: (id: number) => call<{ verified: boolean; notes: string[] }>(`/api/jobs/${id}/tailor`, { body: {} }),
  applied: (id: number) => call(`/api/jobs/${id}/applied`, { body: { note: 'Marked in the local UI' } }),
  discover: (all: boolean) => call('/api/discover/run', { body: { all } }),
  discoverStatus: () => call<DiscoveryStatus>('/api/discover/status'),
  preferences: () => call<Preferences>('/api/preferences'),
  savePreferences: (prefs: Preferences) =>
    call<{ preferences: Preferences; rescored: number }>('/api/preferences', { body: prefs }),
  profile: () =>
    call<{ profile: Profile | null; masterResumePath: string; masterResumeFound: boolean }>('/api/profile'),
  saveProfile: (profile: Profile) => call<{ profile: Profile }>('/api/profile', { body: profile }),
  answers: () => call<{ answers: VaultAnswer[] }>('/api/answers').then((r) => r.answers),
  saveAnswers: (answers: VaultAnswer[]) =>
    call<{ answers: VaultAnswer[] }>('/api/answers', { body: { answers } }).then((r) => r.answers),
}
