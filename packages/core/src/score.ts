import { FAMILY_LABELS } from './families.ts'
import { termsIn, techTermsFor } from './evidence.ts'
import { formatMonth } from './term.ts'
import { resemblesAny, searchedFamilies, type TitleMatch } from './titles.ts'
import type { RuleResult } from './rules.ts'
import type { Job, Preferences, Reason } from './types.ts'

/**
 * Scoring, 0–100, with reasons.
 *
 * Four parts add up to 100: title (40), location (20), level (10) and
 * description evidence (30). Then ceilings and penalties apply, each with its
 * own reason, so a score can always be explained line by line.
 */

export const POINTS = {
  title: { exact: 40, close: 34, familySame: 28, familyNeighbour: 22, related: 18 },
  location: { place: 20, remote_in_region: 20, unfiltered: 15, remote_region_unstated: 12, unknown: 8 },
  level: { termFits: 10, noTerm: 7, notStudent: 10 },
  evidence: { hasDescription: 6, perTerm: 3, maxTerms: 8 },
  ceiling: { noDescription: 70, related: 75 },
  penalty: { rejectedTitle: 15 },
} as const

export type Scored = { score: number; ceiling: number; reasons: Reason[] }

function titlePoints(title: TitleMatch): Reason {
  const saved = title.savedTitle ? `"${title.savedTitle}"` : 'your search'
  switch (title.tier) {
    case 'exact':
      return {
        kind: 'plus',
        code: 'title_exact',
        text: `Title is the same role as ${saved}.`,
        points: POINTS.title.exact,
      }
    case 'close':
      return {
        kind: 'plus',
        code: 'title_close',
        text: `Title contains every word of ${saved}.`,
        points: POINTS.title.close,
      }
    case 'family': {
      const label = title.jobFamily ? FAMILY_LABELS[title.jobFamily] : 'the same kind of work'
      return title.reach === 'same'
        ? {
            kind: 'plus',
            code: 'title_family',
            text: `Same kind of work as ${saved}: ${label}.`,
            points: POINTS.title.familySame,
          }
        : {
            kind: 'plus',
            code: 'title_neighbour',
            text: `Close kind of work to ${saved}: ${label}.`,
            points: POINTS.title.familyNeighbour,
          }
    }
    case 'related':
      return {
        kind: 'plus',
        code: 'title_related',
        text: 'Related title; its description reads as the work you search for.',
        points: POINTS.title.related,
      }
    default:
      return { kind: 'fail', code: 'title_none', text: 'Title does not match your search.', points: 0 }
  }
}

function locationPoints(fit: RuleResult['location'], job: Job): Reason | null {
  switch (fit) {
    case 'place':
      return {
        kind: 'plus',
        code: 'location_place',
        text: `In one of your places: ${job.location}.`,
        points: POINTS.location.place,
      }
    case 'remote_in_region':
      return {
        kind: 'plus',
        code: 'location_remote',
        text: job.location
          ? `Remote, open to where you can work: ${job.location}.`
          : 'Remote, open to where you can work.',
        points: POINTS.location.remote_in_region,
      }
    case 'remote_region_unstated':
      return {
        kind: 'minus',
        code: 'location_remote_unstated',
        text: 'Remote, but the posting does not say from where.',
        points: POINTS.location.remote_region_unstated,
      }
    case 'unknown':
      return {
        kind: 'minus',
        code: 'location_unknown',
        text: 'The posting does not state a location.',
        points: POINTS.location.unknown,
      }
    case 'unfiltered':
      return {
        kind: 'info',
        code: 'location_unfiltered',
        text: 'You have not set places, so location is not checked.',
        points: POINTS.location.unfiltered,
      }
    default:
      return null
  }
}

function levelPoints(title: TitleMatch, rules: RuleResult): Reason {
  if (!title.student)
    return { kind: 'plus', code: 'level_match', text: 'Level matches your search.', points: POINTS.level.notStudent }
  if (rules.term.kind === 'fits')
    return {
      kind: 'plus',
      code: 'term_fits',
      text: `Student role; the term (${rules.term.term.text.trim()}) ends ${formatMonth(rules.term.term.end)}, before you graduate.`,
      points: POINTS.level.termFits,
    }
  return {
    kind: 'plus',
    code: 'level_student',
    text: 'Student role, as you search for. No term dates found to check.',
    points: POINTS.level.noTerm,
  }
}

function evidencePoints(job: Job, prefs: Preferences, profileSkills: readonly string[]): Reason {
  if (!job.description?.trim())
    return { kind: 'info', code: 'no_description', text: 'No description read yet.', points: 0 }
  const terms = new Set([
    ...termsIn(job.description, techTermsFor(searchedFamilies(prefs.roleTitles))),
    ...termsIn(job.description, profileSkills),
  ])
  const counted = [...terms].slice(0, POINTS.evidence.maxTerms)
  const points = POINTS.evidence.hasDescription + counted.length * POINTS.evidence.perTerm
  const text = counted.length
    ? `Description mentions ${counted.join(', ')}.`
    : 'Description read; it mentions none of your skills or the searched work.'
  return { kind: counted.length ? 'plus' : 'minus', code: 'description_evidence', text, points }
}

export function scoreJob(input: {
  job: Job
  prefs: Preferences
  title: TitleMatch
  rules: RuleResult
  profileSkills?: readonly string[]
}): Scored {
  const { job, prefs, title, rules } = input
  if (rules.failures.length) return { score: 0, ceiling: 0, reasons: rules.failures }

  const parts = [
    titlePoints(title),
    locationPoints(rules.location, job),
    levelPoints(title, rules),
    evidencePoints(job, prefs, input.profileSkills ?? []),
  ].filter((reason): reason is Reason => reason !== null)
  let score = parts.reduce((sum, reason) => sum + (reason.points ?? 0), 0)
  const reasons = [...parts]

  let ceiling = 100
  if (!job.description?.trim()) ceiling = Math.min(ceiling, POINTS.ceiling.noDescription)
  if (title.tier === 'related') ceiling = Math.min(ceiling, POINTS.ceiling.related)
  if (score > ceiling) {
    reasons.push({
      kind: 'info',
      code: 'ceiling',
      text: `Capped at ${ceiling} until there is more evidence.`,
      points: ceiling - score,
    })
    score = ceiling
  }

  if (resemblesAny(job.title, prefs.rejectedTitles ?? [])) {
    reasons.push({
      kind: 'minus',
      code: 'rejected_before',
      text: 'You turned down a similar title before.',
      points: -POINTS.penalty.rejectedTitle,
    })
    score -= POINTS.penalty.rejectedTitle
  }

  return { score: Math.max(0, Math.min(100, score)), ceiling, reasons }
}
