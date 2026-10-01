import type { Evaluation } from './evaluate.ts'
import type { Job, Reason } from './types.ts'

/**
 * Optional model assist. Off by default; no key is needed to run.
 *
 * A model can read a description better than a word list, so when one is
 * configured it may propose a score and reasons. The deterministic rules keep
 * the last word: an ineligible job stays ineligible, and the model's score is
 * held under the rules' ceiling (no description, related title).
 */

export type FitProposal = { score: number; reasons: string[] }

export type FitProfile = { skills: readonly string[]; summary?: string }

export interface FitScorer {
  scoreJobFit(job: Job, profile: FitProfile): Promise<FitProposal | null>
}

/** The default: proposes nothing. */
export const noopFitScorer: FitScorer = {
  async scoreJobFit() {
    return null
  },
}

export function applyFitProposal(evaluation: Evaluation, proposal: FitProposal | null): Evaluation {
  if (!proposal || evaluation.status !== 'eligible' || !Number.isFinite(proposal.score)) return evaluation
  const proposed = Math.max(0, Math.min(100, Math.round(proposal.score)))
  const score = Math.min(proposed, evaluation.ceiling)
  const reasons: Reason[] = [
    ...evaluation.reasons,
    ...proposal.reasons.slice(0, 5).map((text): Reason => ({ kind: 'info', code: 'model', text: `Model: ${text}` })),
    {
      kind: 'info',
      code: 'model_score',
      text:
        proposed > score
          ? `Model proposed ${proposed}; held at the rules' ceiling of ${score}.`
          : `Model score ${score} (rules gave ${evaluation.score}).`,
    },
  ]
  return { ...evaluation, score, reasons }
}
