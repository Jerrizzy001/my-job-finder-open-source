import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '@jobfinder/tailor'
import { LOCAL_USER, type Db } from './db.ts'
import type { Workspace } from './workspace.ts'

/**
 * The answer vault: your own answers to the questions application forms ask
 * ("Will you require sponsorship?"). The extension never makes one up: a
 * question with no answer here or in your profile comes back `needs_user`.
 */

export type VaultAnswer = { key: string; question: string; answer: string }

export function listAnswers(db: Db): VaultAnswer[] {
  return db
    .prepare('SELECT question_key AS key, question, answer FROM answers WHERE user_id = ? ORDER BY question')
    .all(LOCAL_USER) as VaultAnswer[]
}

export function keyFor(question: string): string {
  return (
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'question'
  )
}

export function saveAnswers(db: Db, answers: readonly VaultAnswer[], now = new Date()): VaultAnswer[] {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM answers WHERE user_id = ?').run(LOCAL_USER)
    const insert = db.prepare(
      'INSERT INTO answers (user_id, question_key, question, answer, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET question = excluded.question, answer = excluded.answer',
    )
    for (const entry of answers) {
      if (typeof entry.question !== 'string' || typeof entry.answer !== 'string' || !entry.question.trim()) continue
      insert.run(
        LOCAL_USER,
        entry.key?.trim() || keyFor(entry.question),
        entry.question.trim(),
        entry.answer,
        now.toISOString(),
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listAnswers(db)
}

/** On first use, load `answers.json` from the workspace into the vault. */
export function seedAnswers(db: Db, ws: Workspace): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM answers WHERE user_id = ?').get(LOCAL_USER) as { n: number }
  const path = join(ws.root, 'answers.json')
  if (count.n > 0 || !existsSync(path)) return
  const entries = JSON.parse(readFileSync(path, 'utf8')) as VaultAnswer[]
  if (Array.isArray(entries)) saveAnswers(db, entries)
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'you',
  'your',
  'are',
  'do',
  'is',
  'of',
  'to',
  'in',
  'for',
  'this',
  'will',
  'or',
  'and',
  'what',
  'please',
  'how',
  'did',
  'we',
])

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP.has(word)),
  )
}

/** How alike two questions are: shared content words over the smaller set. */
export function questionSimilarity(a: string, b: string): number {
  const left = contentWords(a)
  const right = contentWords(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / Math.min(left.size, right.size)
}

export type FormQuestion = { label: string; required?: boolean; type?: string; options?: string[] }

export type AnsweredQuestion = {
  label: string
  required: boolean
  status: 'answered' | 'needs_user'
  answer: string | null
  source: 'profile' | 'vault' | null
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

function link(profile: Profile, pattern: RegExp): string | null {
  return profile.links?.find((entry) => pattern.test(entry.label) || pattern.test(entry.url))?.url ?? null
}

/** Profile fields a form may ask for, by the words its label uses. */
function profileAnswer(label: string, profile: Profile): string | null {
  const text = label.toLowerCase()
  const name = splitName(profile.name)
  if (/\bfirst name\b|\bgiven name\b/.test(text)) return name.first || null
  if (/\blast name\b|\bsurname\b|\bfamily name\b/.test(text)) return name.last || null
  if (/^\s*(full |legal )?name\s*\*?$/.test(text)) return profile.name
  if (/\be-?mail\b/.test(text)) return profile.email
  if (/\bphone\b|\bmobile\b/.test(text)) return profile.phone ?? null
  if (/\blinkedin\b/.test(text)) return link(profile, /linkedin/i)
  if (/\bgithub\b/.test(text)) return link(profile, /github/i)
  if (/\b(website|portfolio|personal site)\b/.test(text)) return link(profile, /website|portfolio|site/i)
  if (/\b(current )?location\b|\bcity\b|\bwhere are you (based|located)\b/.test(text)) return profile.location ?? null
  return null
}

export const SIMILARITY_THRESHOLD = 0.75

/**
 * Answer each form question from the profile, then the vault. A vault answer
 * is used only when its question is clearly the same one; otherwise the
 * question is `needs_user`. For a choice question, the answer must be one of
 * the options.
 */
export function answerQuestions(
  questions: readonly FormQuestion[],
  profile: Profile | null,
  vault: readonly VaultAnswer[],
): AnsweredQuestion[] {
  return questions.map((question) => {
    const required = question.required === true
    const fromProfile = profile ? profileAnswer(question.label, profile) : null
    if (fromProfile)
      return { label: question.label, required, status: 'answered', answer: fromProfile, source: 'profile' }
    let best: { entry: VaultAnswer; score: number } | null = null
    for (const entry of vault) {
      const score = questionSimilarity(question.label, entry.question)
      if (!best || score > best.score) best = { entry, score }
    }
    let answer = best && best.score >= SIMILARITY_THRESHOLD ? best.entry.answer : null
    if (answer && question.options?.length) {
      const option = question.options.find((choice) => choice.trim().toLowerCase() === answer!.trim().toLowerCase())
      answer = option ?? null
    }
    return answer
      ? { label: question.label, required, status: 'answered', answer, source: 'vault' }
      : { label: question.label, required, status: 'needs_user', answer: null, source: null }
  })
}
