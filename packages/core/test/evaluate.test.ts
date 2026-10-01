import { describe, expect, it } from 'vitest'
import { applyFitProposal, evaluateJob, POINTS } from '../src/index.ts'
import { BUSINESS_DESCRIPTION, job, SOFTWARE_DESCRIPTION, studentPrefs } from './fixtures.ts'

describe('related titles get a second look', () => {
  it('waits for the description', () => {
    const evaluation = evaluateJob(job({ title: 'Technology Analyst Intern' }), studentPrefs)
    expect(evaluation.status).toBe('pending')
    expect(evaluation.reasons[0]!.code).toBe('needs_description')
  })

  it('is kept when the description is the searched work', () => {
    const evaluation = evaluateJob(
      job({ title: 'Technology Analyst Intern', description: SOFTWARE_DESCRIPTION }),
      studentPrefs,
    )
    expect(evaluation.status).toBe('eligible')
    expect(evaluation.title.tier).toBe('related')
    expect(evaluation.score).toBeLessThanOrEqual(POINTS.ceiling.related)
  })

  it('is dropped when the description is other work', () => {
    const evaluation = evaluateJob(
      job({ title: 'Technology Analyst Intern', description: BUSINESS_DESCRIPTION }),
      studentPrefs,
    )
    expect(evaluation.status).toBe('ineligible')
    expect(evaluation.reasons.map((r) => r.code)).toEqual(['related_not_confirmed'])
  })

  it('an unknown title is dropped even when its description mentions computer science', () => {
    const evaluation = evaluateJob(job({ title: 'Finance Intern', description: BUSINESS_DESCRIPTION }), studentPrefs)
    expect(evaluation.status).toBe('ineligible')
  })
})

describe('scoring', () => {
  it('adds up title, location, level and evidence, with a reason for each', () => {
    const evaluation = evaluateJob(job({ description: SOFTWARE_DESCRIPTION }), studentPrefs)
    const codes = evaluation.reasons.map((r) => r.code)
    expect(codes).toEqual(['title_exact', 'location_place', 'term_fits', 'description_evidence'])
    const sum = evaluation.reasons.reduce((total, r) => total + (r.points ?? 0), 0)
    expect(evaluation.score).toBe(sum)
    expect(evaluation.score).toBeGreaterThanOrEqual(85)
  })

  it('caps a posting with no description', () => {
    const evaluation = evaluateJob(job(), studentPrefs)
    expect(evaluation.score).toBeLessThanOrEqual(POINTS.ceiling.noDescription)
  })

  it('ranks exact above family above related', () => {
    const exact = evaluateJob(job({ description: SOFTWARE_DESCRIPTION }), studentPrefs).score
    const family = evaluateJob(job({ title: 'DevOps Intern', description: SOFTWARE_DESCRIPTION }), studentPrefs).score
    const related = evaluateJob(
      job({ title: 'Technology Analyst Intern', description: SOFTWARE_DESCRIPTION }),
      studentPrefs,
    ).score
    expect(exact).toBeGreaterThan(family)
    expect(family).toBeGreaterThan(related)
  })

  it('counts profile skills found in the description', () => {
    const without = evaluateJob(job({ description: 'We use Elixir and Phoenix.' }), studentPrefs).score
    const withSkills = evaluateJob(job({ description: 'We use Elixir and Phoenix.' }), studentPrefs, {
      profileSkills: ['Elixir', 'Phoenix'],
    }).score
    expect(withSkills).toBe(without + 2 * POINTS.evidence.perTerm)
  })

  it('lowers titles you turned down before', () => {
    const base = evaluateJob(job({ description: SOFTWARE_DESCRIPTION }), studentPrefs)
    const rejected = evaluateJob(job({ description: SOFTWARE_DESCRIPTION }), {
      ...studentPrefs,
      rejectedTitles: ['Software Developer Co-op'],
    })
    expect(rejected.score).toBe(base.score - POINTS.penalty.rejectedTitle)
    expect(rejected.reasons.at(-1)!.code).toBe('rejected_before')
  })

  it('scores an ineligible posting 0 and keeps its reasons', () => {
    const evaluation = evaluateJob(job({ title: 'Marketing Intern' }), studentPrefs)
    expect(evaluation).toMatchObject({ status: 'ineligible', score: 0 })
  })
})

describe('model assist', () => {
  it('cannot raise a score above the rules ceiling', () => {
    const evaluation = evaluateJob(job(), studentPrefs)
    const assisted = applyFitProposal(evaluation, { score: 99, reasons: ['Strong fit'] })
    expect(assisted.score).toBe(POINTS.ceiling.noDescription)
    expect(assisted.reasons.map((r) => r.code)).toContain('model')
  })

  it('cannot make an ineligible posting eligible', () => {
    const evaluation = evaluateJob(job({ title: 'Marketing Intern' }), studentPrefs)
    expect(applyFitProposal(evaluation, { score: 95, reasons: [] })).toEqual(evaluation)
  })

  it('may lower a score', () => {
    const evaluation = evaluateJob(job({ description: SOFTWARE_DESCRIPTION }), studentPrefs)
    expect(applyFitProposal(evaluation, { score: 40, reasons: [] }).score).toBe(40)
  })
})
