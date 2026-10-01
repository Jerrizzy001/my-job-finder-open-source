import { classifyFamily, familyReach, isTechFamily, looksRelated, type RoleFamily } from './families.ts'
import { studentLevel } from './student.ts'
import { normalizeTitle, titleTokens, workTokens } from './text.ts'

/**
 * Title tiers, best first.
 *
 * - `exact`: the same words as a saved title, at the same level
 *   ("Software Developer, Work Term" for a saved "Software developer co-op").
 * - `close`: every word of a saved title is in the job title
 *   ("Senior Software Engineer, Payments" for "Software Engineer").
 * - `family`: the same kind of work, or a neighbouring kind
 *   ("Applied AI Program Design & Delivery Intern" for "AI engineer intern").
 * - `related`: a technical-sounding title in no family ("Technology Analyst
 *   Intern"). Kept until the description is read, which decides it.
 * - `none`: dropped.
 */
export type TitleTier = 'exact' | 'close' | 'family' | 'related' | 'none'

export const TIER_RANK: Record<TitleTier, number> = { exact: 4, close: 3, family: 2, related: 1, none: 0 }

export type TitleSearch = {
  roleTitles: readonly string[]
  excludedTitles?: readonly string[]
}

export type TitleMatch = {
  tier: TitleTier
  /** The saved title that gave the best tier. */
  savedTitle: string | null
  jobFamily: RoleFamily | null
  savedFamily: RoleFamily | null
  /** For `family`: the same family or a neighbour. */
  reach: 'same' | 'neighbour' | null
  student: boolean
  /** Why it is `none`, when it is. */
  dropReason: 'level_mismatch' | 'excluded_title' | 'no_title_match' | null
}

type ReadTitle = {
  student: boolean
  tokens: string[]
  work: string[]
  family: RoleFamily | null
  normalized: string
}

function readTitle(title: string): ReadTitle {
  const level = studentLevel(title)
  const normalized = normalizeTitle(level.rest)
  const tokens = titleTokens(normalized)
  return { student: level.student, tokens, work: workTokens(tokens), family: classifyFamily(normalized), normalized }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left)
  const b = new Set(right)
  return a.size > 0 && a.size === b.size && [...a].every((token) => b.has(token))
}

function containsAll(haystack: readonly string[], needles: readonly string[]): boolean {
  const set = new Set(haystack)
  return needles.length > 0 && needles.every((token) => set.has(token))
}

/** Families agree when either is unknown, or the saved one reaches the job's. */
function familiesAgree(saved: RoleFamily | null, job: RoleFamily | null): boolean {
  return saved === null || job === null || familyReach(saved, job) !== null
}

function tierAgainst(job: ReadTitle, saved: ReadTitle): Omit<TitleMatch, 'savedTitle' | 'dropReason'> {
  const base = { jobFamily: job.family, savedFamily: saved.family, student: job.student, reach: null }
  if (sameSet(job.tokens, saved.tokens)) return { ...base, tier: 'exact' }
  if (containsAll(job.tokens, saved.work) && familiesAgree(saved.family, job.family)) return { ...base, tier: 'close' }
  if (saved.family && job.family) {
    const reach = familyReach(saved.family, job.family)
    if (reach) return { ...base, tier: 'family', reach }
  }
  if (isTechFamily(saved.family) && looksRelated(job.normalized, job.family)) return { ...base, tier: 'related' }
  return { ...base, tier: 'none' }
}

/** The best tier a job title reaches against a saved search. */
export function matchTitle(jobTitle: string, search: TitleSearch): TitleMatch {
  const job = readTitle(jobTitle)
  let best: TitleMatch = {
    tier: 'none',
    savedTitle: null,
    jobFamily: job.family,
    savedFamily: null,
    reach: null,
    student: job.student,
    dropReason: 'no_title_match',
  }
  let levelMismatch = false

  for (const savedTitle of search.roleTitles) {
    const saved = readTitle(savedTitle)
    if (saved.student !== job.student) {
      levelMismatch = true
      continue
    }
    const match = tierAgainst(job, saved)
    const better =
      TIER_RANK[match.tier] > TIER_RANK[best.tier] ||
      (match.tier === 'family' && best.tier === 'family' && match.reach === 'same' && best.reach !== 'same')
    if (better) best = { ...match, savedTitle, dropReason: null }
  }

  if (best.tier === 'none' && levelMismatch) best = { ...best, dropReason: 'level_mismatch' }

  if (best.tier !== 'none') {
    // An excluded title is read with its seniority words: excluding "Senior
    // Software Engineer" must not drop "Software Engineer".
    for (const excluded of search.excludedTitles ?? [])
      if (containsAll(job.tokens, readTitle(excluded).tokens))
        return { ...best, tier: 'none', dropReason: 'excluded_title' }
  }
  return best
}

/** Whether a title is the same or nearly the same as any of `titles` (any level). */
export function resemblesAny(jobTitle: string, titles: readonly string[]): boolean {
  const job = readTitle(jobTitle)
  return titles.some((title) => {
    const tier = tierAgainst(job, readTitle(title)).tier
    return tier === 'exact' || tier === 'close'
  })
}

/** The families a search reaches, for reading descriptions. */
export function searchedFamilies(roleTitles: readonly string[]): Set<RoleFamily> {
  const families = new Set<RoleFamily>()
  for (const title of roleTitles) {
    const family = readTitle(title).family
    if (!family) continue
    families.add(family)
  }
  return families
}
