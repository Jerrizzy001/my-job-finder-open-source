import { decideRelated } from './evidence.ts'
import { MATCHING_POLICY_VERSION } from './policy.ts'
import { checkRules } from './rules.ts'
import { scoreJob } from './score.ts'
import { matchTitle, searchedFamilies, type TitleMatch } from './titles.ts'
import type { Job, Preferences, Reason } from './types.ts'

/**
 * The whole matching idea in one function:
 *
 *   title tier → (related? read the description) → hard rules → score + reasons
 */

export type Evaluation = {
  /** `pending` means the title is `related` and the description is not read yet. */
  status: 'eligible' | 'ineligible' | 'pending'
  score: number
  ceiling: number
  title: TitleMatch
  reasons: Reason[]
  policyVersion: string
}

export type EvaluateOptions = {
  profileSkills?: readonly string[]
}

/** Title only: what a board list can be selected by, before any detail read. */
export function selectByTitle(title: string, prefs: Preferences): TitleMatch {
  return matchTitle(title, { roleTitles: prefs.roleTitles, excludedTitles: prefs.excludedTitles ?? [] })
}

export function evaluateJob(job: Job, prefs: Preferences, options: EvaluateOptions = {}): Evaluation {
  let title = selectByTitle(job.title, prefs)
  const extra: Reason[] = []

  if (title.tier === 'related') {
    if (!job.description?.trim())
      return {
        status: 'pending',
        score: 0,
        ceiling: 0,
        title,
        reasons: [{ kind: 'info', code: 'needs_description', text: 'Related title: kept until its description is read.' }],
        policyVersion: MATCHING_POLICY_VERSION,
      }
    const verdict = decideRelated(job.description, searchedFamilies(prefs.roleTitles))
    if (!verdict.keep) {
      title = { ...title, tier: 'none', dropReason: 'no_title_match' }
      extra.push({
        kind: 'fail',
        code: 'related_not_confirmed',
        text: `Related title, but the description reads as other work (${verdict.techTerms.length} technical vs ${verdict.businessTerms.length} business terms).`,
      })
    }
  }

  const rules = checkRules(job, prefs, title)
  if (extra.length) rules.failures.splice(0, rules.failures.length, ...extra, ...rules.failures.filter((r) => r.code !== 'role_not_included'))
  const scored = scoreJob({ job, prefs, title, rules, profileSkills: options.profileSkills ?? [] })
  return {
    status: rules.failures.length ? 'ineligible' : 'eligible',
    score: scored.score,
    ceiling: scored.ceiling,
    title,
    reasons: scored.reasons,
    policyVersion: MATCHING_POLICY_VERSION,
  }
}
