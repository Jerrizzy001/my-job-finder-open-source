import { markdownToText } from './markdown.ts'

/**
 * The no-invention check.
 *
 * A draft may only select, reorder and rephrase what you wrote. So every
 * name, number and date in it must already be in your sources: the master
 * resume, the profile, and the job's company and title. The job description
 * is deliberately *not* a source — otherwise a draft could claim the
 * posting's required skills as yours.
 *
 * What counts as a "name":
 * - a capitalised word in the middle of a sentence ("worked at Northwind"),
 * - any word with inner capitals, digits or symbols ("PyTorch", "Node.js", "C++"),
 * - any all-capitals word ("AWS", "PhD").
 * A capitalised word that starts a sentence or a bullet is ordinary English
 * ("Built", "Designed") and is not checked. Dates are compared as months, so
 * "May 2023" in a draft matches "2023-05" in the resume, and nothing else.
 */

export type VerifyInput = {
  draft: string
  sources: readonly string[]
  /** Text the template itself adds (today's date, the greeting). */
  allowed?: readonly string[]
}

export type Problem = { kind: 'name' | 'number' | 'date'; value: string }

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const MONTH_ABBR = MONTHS.map((month) => month.slice(0, 3))

/** Ordinary words that are capitalised mid-sentence for reasons of their own. */
const COMMON = new Set(
  [
    'i',
    "i'm",
    "i've",
    "i'd",
    "i'll",
    'dear',
    'sincerely',
    'regards',
    'thank',
    'thanks',
    'hiring',
    'team',
    'manager',
    'present',
    'current',
    'summary',
    'experience',
    'education',
    'skills',
    'projects',
    'resume',
    'cover',
    'letter',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'ok',
    'us',
    'mr',
    'ms',
    'mx',
    'dr',
    ...MONTHS,
    ...MONTH_ABBR,
    'sept',
  ].map((word) => word.toLowerCase()),
)

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
}

function hasWord(haystack: string, word: string): boolean {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack)
}

/** Every month a text names, as "YYYY-MM". */
export function monthsIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const m of text.matchAll(/\b(20\d\d|19\d\d)-(0[1-9]|1[0-2])\b/g)) found.add(`${m[1]}-${m[2]}`)
  const names = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
  for (const m of text.matchAll(new RegExp(String.raw`\b${names}\s+(\d{4})\b`, 'gi'))) {
    const index = MONTH_ABBR.indexOf(m[1]!.toLowerCase().slice(0, 3))
    found.add(`${m[2]}-${String(index + 1).padStart(2, '0')}`)
  }
  return found
}

/** Candidate names: see the file comment for the three shapes. */
export function namesIn(text: string): string[] {
  const names: string[] = []
  for (const line of text.split('\n')) {
    const body = line.replace(/^\s*(?:#+|[-*•])\s*/, '')
    // Split into sentences so a sentence-initial word is known.
    for (const sentence of body.split(/(?<=[.!?:;])\s+|\s+[·|–—]\s+/)) {
      const words = sentence.match(/[A-Za-z][A-Za-z0-9+#.'’&/-]*[A-Za-z0-9+#]|[A-Za-z]/g) ?? []
      words.forEach((raw, index) => {
        const word = raw.replace(/[.'’]+$/, '')
        const lower = word.toLowerCase()
        if (COMMON.has(lower) || word.length < 2) return
        const special = /[A-Z0-9+#]/.test(word.slice(1)) || /\.[a-z]/.test(word)
        const midSentenceCap = index > 0 && /^[A-Z]/.test(word)
        if (special || midSentenceCap) names.push(word)
      })
    }
  }
  return names
}

/** Numbers that are not part of a date. */
export function numbersIn(text: string): string[] {
  const withoutDates = text.replace(/\b(19|20)\d\d-(0[1-9]|1[0-2])\b/g, ' ')
  return [...withoutDates.matchAll(/(?<![A-Za-z0-9.])\d+(?:[.,]\d+)*(?:%|k|m)?(?![A-Za-z0-9])/gi)].map((m) => m[0])
}

export function verifyDraft(input: VerifyInput): Problem[] {
  const draftText = markdownToText(input.draft)
  const source = normalise([...input.sources, ...(input.allowed ?? [])].join('\n'))
  const sourceMonths = monthsIn([...input.sources, ...(input.allowed ?? [])].join('\n'))
  const sourceNumbers = new Set(numbersIn(source).map((n) => n.replace(/,/g, '')))
  const problems: Problem[] = []
  const seen = new Set<string>()
  const report = (kind: Problem['kind'], value: string) => {
    const key = `${kind}:${value.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push({ kind, value })
  }

  for (const name of namesIn(draftText)) if (!hasWord(source, name)) report('name', name)
  for (const month of monthsIn(draftText)) if (!sourceMonths.has(month)) report('date', month)
  const draftWithoutMonths = draftText.replace(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{4}\b/gi,
    ' ',
  )
  for (const number of numbersIn(draftWithoutMonths)) {
    const bare = number.replace(/,/g, '')
    if (!sourceNumbers.has(bare) && !hasWord(source, number)) report('number', number)
  }
  return problems
}

export function describeProblems(problems: readonly Problem[]): string[] {
  return problems.map(
    (problem) =>
      `${problem.kind === 'name' ? 'Name' : problem.kind === 'date' ? 'Date' : 'Number'} not in your resume or profile: ${problem.value}`,
  )
}
