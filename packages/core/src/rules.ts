import { placeMatches, readLocation, readWorkMode, userRemoteCountries, type WorkMode } from './location.ts'
import { formatMonth, parseGraduation, termFit, type TermFit } from './term.ts'
import { FAMILY_LABELS } from './families.ts'
import type { TitleMatch } from './titles.ts'
import type { Job, Preferences, Reason } from './types.ts'

/**
 * Hard rules. A posting that fails one is ineligible: score 0, with the
 * failing rule's code as the reason. They run in a fixed order and all of
 * them run, so the UI can show every reason a posting was dropped.
 */

export type RuleCode =
  | 'role_not_included'
  | 'level_mismatch'
  | 'excluded_title'
  | 'blocked_company'
  | 'blocked_term'
  | 'location_mismatch'
  | 'remote_outside_region'
  | 'work_mode_mismatch'
  | 'term_after_graduation'

export type LocationFit = 'place' | 'remote_in_region' | 'remote_region_unstated' | 'unknown' | 'unfiltered' | 'mismatch' | 'remote_outside_region'

export type RuleResult = {
  failures: Reason[]
  location: LocationFit
  workMode: WorkMode | null
  term: TermFit
}

function fail(code: RuleCode, text: string): Reason {
  return { kind: 'fail', code, text }
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped !== '' && new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text)
}

function titleRule(title: TitleMatch, job: Job): Reason[] {
  if (title.tier !== 'none') return []
  if (title.dropReason === 'level_mismatch')
    return [
      fail(
        'level_mismatch',
        title.student
          ? `"${job.title}" is a student role and your search is not.`
          : `Your search is for student roles; "${job.title}" is not one.`,
      ),
    ]
  if (title.dropReason === 'excluded_title') return [fail('excluded_title', `"${job.title}" matches a title you excluded.`)]
  const family = title.jobFamily ? ` (${FAMILY_LABELS[title.jobFamily]})` : ''
  return [fail('role_not_included', `"${job.title}"${family} is not one of the roles you search for.`)]
}

export function locationRule(job: Job, prefs: Preferences): { fit: LocationFit; failure: Reason | null } {
  const places = prefs.locations ?? []
  const regions = prefs.remoteRegions ?? []
  if (!places.length && !regions.length) return { fit: 'unfiltered', failure: null }
  if (!job.location?.trim() && job.workplaceType !== 'remote') return { fit: 'unknown', failure: null }

  const location = readLocation(job.location)
  if (places.some((place) => placeMatches(place, location))) return { fit: 'place', failure: null }

  const remote = job.workplaceType === 'remote' || location.remote
  if (remote) {
    const user = userRemoteCountries(regions, places)
    if (user.anywhere || location.anywhere) return { fit: 'remote_in_region', failure: null }
    if (!location.countries.size) return { fit: 'remote_region_unstated', failure: null }
    if (!user.countries.size || [...location.countries].some((c) => user.countries.has(c)))
      return { fit: 'remote_in_region', failure: null }
    return {
      fit: 'remote_outside_region',
      failure: fail('remote_outside_region', `Remote, but only from ${job.location}; you can work remotely from ${regions.join(', ') || places.join(', ')}.`),
    }
  }
  return { fit: 'mismatch', failure: fail('location_mismatch', `${job.location} is not one of your places (${places.join(', ') || 'none set'}).`) }
}

export function checkRules(job: Job, prefs: Preferences, title: TitleMatch): RuleResult {
  const failures: Reason[] = [...titleRule(title, job)]

  const company = job.company.trim().toLowerCase()
  if ((prefs.blockedCompanies ?? []).some((blocked) => blocked.trim().toLowerCase() === company))
    failures.push(fail('blocked_company', `You blocked ${job.company}.`))

  const blockedTerm = (prefs.blockedTerms ?? []).find((term) => containsWord(job.title, term))
  if (blockedTerm) failures.push(fail('blocked_term', `The title contains "${blockedTerm}", which you blocked.`))

  const location = locationRule(job, prefs)
  if (location.failure) failures.push(location.failure)

  const workMode = readWorkMode(job)
  const modes = prefs.workModes ?? []
  if (workMode && modes.length && !modes.includes(workMode))
    failures.push(fail('work_mode_mismatch', `This job is ${workMode}; you want ${modes.join(' or ')}.`))

  const graduation = parseGraduation(prefs.graduation)
  const term = title.student ? termFit(`${job.title}\n${job.description ?? ''}`, graduation) : ({ kind: 'no_term' } as const)
  if (term.kind === 'after_graduation')
    failures.push(
      fail(
        'term_after_graduation',
        `The term (${term.term.text.trim()}) ends ${formatMonth(term.term.end)}, after your graduation in ${formatMonth(graduation!)}.`,
      ),
    )

  return { failures, location: location.fit, workMode, term }
}
