/**
 * Title text, read the same way everywhere.
 *
 * Every rule in this package reads a title through `normalizeTitle`, so
 * "Front-End Dev (Co-op)", "frontend developer co-op" and "FRONTEND DEV, COOP"
 * all reach the rules as the same words.
 */

/** Joined and abbreviated forms, rewritten to one spelling. Order matters. */
const REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\ba\.i\.?(?![a-z0-9])/g, 'ai'],
  [/&/g, ' and '],
  [/[^a-z0-9+#]+/g, ' '],
  [/\bfront ?end\b/g, 'frontend'],
  [/\bback ?end\b/g, 'backend'],
  [/\bfull ?stack\b/g, 'fullstack'],
  [/\bdev ?ops\b/g, 'devops'],
  [/\bml ?ops\b/g, 'mlops'],
  [/\bgen ai\b/g, 'genai'],
  [/\bco ?op\b/g, 'coop'],
  [/\bco operative education\b/g, 'coop'],
  [/\bsite reliability engineer\w*\b/g, 'sre'],
  [/\bartificial intelligence\b/g, 'ai'],
  [/\bmachine learning\b/g, 'ml'],
  [/\bquality assurance\b/g, 'qa'],
  [/\bsoftware development engineer\b/g, 'software engineer'],
  [/\bswe\b|\bsde\b/g, 'software engineer'],
]

/** Lower case, accents off, punctuation as spaces, joined forms joined. */
export function normalizeTitle(title: string): string {
  let text = title.slice(0, 300).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement)
  return text.replace(/\s+/g, ' ').trim()
}

/** Words that mean the same thing in a job title. */
const SYNONYMS: Readonly<Record<string, string>> = {
  dev: 'developer',
  developers: 'developer',
  engineer: 'developer',
  engineers: 'developer',
  engineering: 'developer',
  development: 'developer',
  programmer: 'developer',
  sr: 'senior',
  jr: 'junior',
  internship: 'intern',
  interns: 'intern',
  internships: 'intern',
  analysts: 'analyst',
  scientists: 'scientist',
  science: 'scientist',
  apps: 'app',
  application: 'app',
  applications: 'app',
}

/** Seniority words: they say how senior, not what the work is. */
export const SENIORITY_WORDS: ReadonlySet<string> = new Set([
  'senior',
  'junior',
  'staff',
  'principal',
  'lead',
  'associate',
  'entry',
  'level',
  'mid',
  'i',
  'ii',
  'iii',
  'iv',
  '1',
  '2',
  '3',
])

/** Filler words that carry no meaning in a title comparison. */
const FILLER: ReadonlySet<string> = new Set(['and', 'of', 'the', 'a', 'an', 'for', 'in', 'to', 'with', 'at'])

/** A normalised title as canonical words: synonyms folded, filler dropped. */
export function titleTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((word) => word && !FILLER.has(word))
    .map((word) => SYNONYMS[word] ?? word)
}

/** The tokens that name the work: seniority words removed. */
export function workTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !SENIORITY_WORDS.has(token))
}
