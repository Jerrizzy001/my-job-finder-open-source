import type { Llm, Usage } from './llm.ts'
import { markdownToText } from './markdown.ts'
import { pageCount } from './pdf.ts'
import type { Profile } from './profile.ts'
import { describeProblems, verifyDraft } from './verify.ts'

/**
 * Drafting a resume and cover letter for one job.
 *
 * With a model: the model selects, reorders and rephrases your master resume
 * for the job, and writes a cover letter. Both are verified (see
 * `verify.ts`); a draft that adds anything new is retried once with the
 * problems listed, then replaced by the no-model package.
 *
 * Without a model (or after a failed verification): your master resume with
 * its skills line reordered for the job, and a templated cover letter that
 * quotes your own most relevant bullets. Nothing is rephrased.
 */

export type TailorJob = {
  title: string
  company: string
  description: string | null
  /** False when the job's host asked not to send its content to models. */
  aiInput?: boolean
}

export type TailorInput = {
  profile: Profile
  masterResume: string
  job: TailorJob
  /** "Why this job" lines from the matcher. */
  reasons?: readonly string[]
  today?: Date
}

export type Drafts = {
  resume: string
  coverLetter: string
  llmUsed: boolean
  model: string | null
  verified: boolean
  problems: string[]
  notes: string[]
  usage: Usage[]
}

export const MAX_COVER_WORDS = 400

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [])
}

/** The master resume with its Skills line ordered by what the job mentions. Nothing else changes. */
export function reorderSkills(masterResume: string, description: string | null): string {
  if (!description) return masterResume
  const lines = masterResume.split('\n')
  const heading = lines.findIndex((line) => /^#{1,3}\s+(technical\s+)?skills\b/i.test(line))
  if (heading < 0) return masterResume
  const target = lines.findIndex((line, index) => index > heading && line.trim() && !line.startsWith('#'))
  if (target < 0 || !lines[target]!.includes(',')) return masterResume
  const text = description.toLowerCase()
  const skills = lines[target]!.split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
  const mentioned = (skill: string) => text.includes(skill.toLowerCase())
  const ordered = [...skills.filter(mentioned), ...skills.filter((skill) => !mentioned(skill))]
  lines[target] = ordered.join(', ')
  return lines.join('\n')
}

type Point = { text: string; role: string; overlap: number }

/** Your bullets that share the most with the job description. */
export function matchingPoints(profile: Profile, masterResume: string, description: string | null, limit = 3): Point[] {
  const jobWords = words(description ?? '')
  const skills = profile.skills.map((skill) => skill.toLowerCase())
  const points: Point[] = []
  for (const job of profile.experience)
    for (const bullet of job.bullets) points.push({ text: bullet, role: `${job.title} at ${job.employer}`, overlap: 0 })
  if (!points.length)
    for (const line of masterResume.split('\n')) {
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
      if (bullet) points.push({ text: bullet[1]!.trim(), role: '', overlap: 0 })
    }
  for (const point of points) {
    const bulletWords = words(point.text)
    let overlap = 0
    for (const word of bulletWords) if (jobWords.has(word)) overlap += skills.includes(word) ? 3 : 1
    point.overlap = overlap
  }
  return points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => b.point.overlap - a.point.overlap || a.index - b.index)
    .slice(0, limit)
    .map(({ point }) => point)
}

/** "Software engineer who likes X" as "I am a software engineer who likes X." */
function introduce(headline: string): string {
  const text = headline.trim().replace(/\.$/, '')
  const lowered = /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text
  return `I am ${/^[aeiou]/i.test(lowered) ? 'an' : 'a'} ${lowered}.`
}

export function templatedCoverLetter(input: TailorInput): string {
  const { profile, job } = input
  const today = formatDate(input.today ?? new Date())
  const contact = [profile.email, profile.phone, profile.location].filter(Boolean).join(' · ')
  const points = matchingPoints(profile, input.masterResume, job.description)
  const lines = [
    `# ${profile.name}`,
    contact,
    '',
    today,
    '',
    `Dear ${job.company} hiring team,`,
    '',
    `I am applying for the ${job.title} role at ${job.company}.${profile.headline ? ` ${introduce(profile.headline)}` : ''}`,
    '',
    points.length > 1
      ? 'A few things from my experience that fit what you describe:'
      : 'One thing from my experience that fits what you describe:',
    '',
    ...points.map((point) => `- ${point.text.replace(/\.$/, '')}${point.role ? ` (${point.role})` : ''}.`),
    '',
    'I would welcome the chance to talk about the role. Thank you for your time.',
    '',
    'Sincerely,',
    '',
    profile.name,
    '',
  ]
  return lines.join('\n')
}

const SYSTEM = `You tailor a candidate's resume and cover letter for one job.
Hard rules — breaking any of them makes the draft unusable:
1. Never invent anything. No employer, title, degree, school, skill, tool, project, metric, number or date that is not in the MASTER RESUME or PROFILE. The job description is context only: never claim its requirements unless the master resume shows them.
2. You may only select, reorder, shorten and rephrase the candidate's own content.
3. Keep every date exactly as written in the master resume (same format).
4. Resume: Markdown with "# Name", "## Section" headings and "- " bullets.
5. Cover letter: Markdown, at most 300 words, fits on one page; it names the company and the role, and cites 2–3 specific points from the master resume that match the job.
Answer with JSON only: {"resume_markdown": "...", "cover_letter_markdown": "..."}`

function userPrompt(input: TailorInput, problems: readonly string[]): string {
  const { job } = input
  const description =
    job.aiInput === false
      ? '(withheld: the job host asked not to send its content to AI models)'
      : (job.description ?? '(none)')
  return [
    `JOB: ${job.title} at ${job.company}`,
    `WHY IT MATCHED:\n${(input.reasons ?? []).map((reason) => `- ${reason}`).join('\n') || '(none)'}`,
    `JOB DESCRIPTION:\n${description.slice(0, 12_000)}`,
    `PROFILE (JSON):\n${JSON.stringify(input.profile)}`,
    `MASTER RESUME:\n${input.masterResume}`,
    `TODAY: ${formatDate(input.today ?? new Date())}`,
    problems.length
      ? `YOUR LAST DRAFT WAS REJECTED. Remove these, which are not in the sources:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function sourcesOf(input: TailorInput): string[] {
  return [input.masterResume, JSON.stringify(input.profile), input.job.company, input.job.title]
}

/** Problems with a draft pair: invented facts, and cover-letter rules. */
export function checkDrafts(input: TailorInput, resume: string, coverLetter: string): string[] {
  const allowed = [formatDate(input.today ?? new Date())]
  const sources = sourcesOf(input)
  const problems = [
    ...describeProblems(verifyDraft({ draft: resume, sources, allowed })).map((p) => `Resume: ${p}`),
    ...describeProblems(verifyDraft({ draft: coverLetter, sources, allowed })).map((p) => `Cover letter: ${p}`),
  ]
  const coverText = markdownToText(coverLetter).toLowerCase()
  if (!coverText.includes(input.job.company.toLowerCase())) problems.push('Cover letter: does not name the company')
  if (!coverText.includes(input.job.title.toLowerCase())) problems.push('Cover letter: does not name the role')
  const wordCount = coverText.split(/\s+/).filter(Boolean).length
  if (wordCount > MAX_COVER_WORDS) problems.push(`Cover letter: ${wordCount} words, over ${MAX_COVER_WORDS}`)
  if (pageCount(coverLetter) > 1) problems.push('Cover letter: longer than one page')
  return problems
}

function parseModelJson(text: string): { resume: string; coverLetter: string } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as {
      resume_markdown?: unknown
      cover_letter_markdown?: unknown
    }
    if (typeof value.resume_markdown !== 'string' || typeof value.cover_letter_markdown !== 'string') return null
    return { resume: value.resume_markdown.trim() + '\n', coverLetter: value.cover_letter_markdown.trim() + '\n' }
  } catch {
    return null
  }
}

export function untailoredDrafts(input: TailorInput, notes: string[] = []): Drafts {
  const resume = reorderSkills(input.masterResume, input.job.description)
  const coverLetter = templatedCoverLetter(input)
  const problems = checkDrafts(input, resume, coverLetter)
  return {
    resume,
    coverLetter,
    llmUsed: false,
    model: null,
    verified: problems.length === 0,
    problems,
    notes: [
      ...notes,
      'No model was used: this is your master resume (skills reordered for the job) and a templated cover letter.',
    ],
    usage: [],
  }
}

export async function tailorDrafts(input: TailorInput, llm: Llm | null): Promise<Drafts> {
  if (!llm) return untailoredDrafts(input, ['No model is configured (set JOBFINDER_LLM_BASE_URL; see docs/FAQ.md).'])
  const usage: Usage[] = []
  let problems: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    let completion
    try {
      completion = await llm.complete({ system: SYSTEM, user: userPrompt(input, problems), json: true })
    } catch (error) {
      return untailoredDrafts(input, [`The model call failed (${(error as Error).message}).`])
    }
    usage.push(completion.usage)
    const drafts = parseModelJson(completion.text)
    if (!drafts) {
      problems = ['The answer was not the JSON object asked for.']
      continue
    }
    problems = checkDrafts(input, drafts.resume, drafts.coverLetter)
    if (!problems.length)
      return {
        ...drafts,
        llmUsed: true,
        model: completion.model,
        verified: true,
        problems: [],
        notes: [`Tailored by ${completion.model}; verified against your resume and profile.`],
        usage,
      }
  }
  const fallback = untailoredDrafts(input, [
    `The model's drafts added things that are not in your resume, so they were discarded: ${problems.slice(0, 5).join('; ')}`,
  ])
  return { ...fallback, model: llm.model, usage }
}
