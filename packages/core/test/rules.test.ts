import { describe, expect, it } from 'vitest'
import { evaluateJob, type Preferences } from '../src/index.ts'
import { job, studentPrefs } from './fixtures.ts'

function failures(overrides: Parameters<typeof job>[0], prefs: Preferences = studentPrefs): string[] {
  return evaluateJob(job(overrides), prefs).reasons.filter((r) => r.kind === 'fail').map((r) => r.code)
}

describe('hard rules', () => {
  it('passes a good posting', () => {
    expect(failures({})).toEqual([])
  })

  it('role_not_included', () => {
    expect(failures({ title: 'Marketing Intern' })).toEqual(['role_not_included'])
  })

  it('level_mismatch', () => {
    expect(failures({ title: 'Software Developer' })).toEqual(['level_mismatch'])
  })

  it('blocked_company, case-insensitive', () => {
    expect(failures({}, { ...studentPrefs, blockedCompanies: ['example co'] })).toEqual(['blocked_company'])
  })

  it('blocked_term, whole words only', () => {
    const prefs = { ...studentPrefs, blockedTerms: ['clearance'] }
    expect(failures({ title: 'Software Developer Co-op (Clearance required)' }, prefs)).toEqual(['blocked_term'])
    expect(failures({ title: 'Software Developer Co-op' }, { ...studentPrefs, blockedTerms: ['dev'] })).toEqual([])
  })

  describe('location', () => {
    it('matches a city by name or alias', () => {
      expect(failures({ location: 'Greater Toronto Area' })).toEqual([])
    })

    it('location_mismatch for another city', () => {
      expect(failures({ location: 'Vancouver, BC' })).toEqual(['location_mismatch'])
    })

    it('accepts remote restricted to your region', () => {
      expect(failures({ location: 'Remote - Canada' })).toEqual([])
      expect(failures({ location: 'Remote (North America)' })).toEqual([])
    })

    it('remote_outside_region for remote elsewhere', () => {
      expect(failures({ location: 'Remote - US' })).toEqual(['remote_outside_region'])
      expect(failures({ location: 'Remote, San Francisco, CA' })).toEqual(['remote_outside_region'])
    })

    it('derives remote regions from your places when none are set', () => {
      const prefs = { ...studentPrefs, remoteRegions: [], locations: ['Waterloo, ON'] }
      expect(failures({ location: 'Remote - Canada' }, prefs)).toEqual([])
      expect(failures({ location: 'Remote - UK' }, prefs)).toEqual(['remote_outside_region'])
    })

    it('passes a remote posting that states no region, with fewer points', () => {
      const evaluation = evaluateJob(job({ location: 'Remote' }), studentPrefs)
      expect(evaluation.status).toBe('eligible')
      expect(evaluation.reasons.map((r) => r.code)).toContain('location_remote_unstated')
    })

    it('does not filter when you set no places', () => {
      expect(failures({ location: 'Berlin' }, { ...studentPrefs, locations: [], remoteRegions: [] })).toEqual([])
    })
  })

  it('work_mode_mismatch when the posting states another mode', () => {
    const prefs: Preferences = { ...studentPrefs, workModes: ['remote', 'hybrid'] }
    expect(failures({ workplaceType: 'onsite' }, prefs)).toEqual(['work_mode_mismatch'])
    expect(failures({ location: 'Hybrid - Toronto' }, prefs)).toEqual([])
    expect(failures({ workplaceType: null }, prefs)).toEqual([])
  })

  it('term_after_graduation', () => {
    expect(failures({ description: 'This is a May–Dec 2027 co-op term.' })).toEqual(['term_after_graduation'])
    expect(failures({ description: 'This is a Jan–Apr 2027 co-op term.' })).toEqual([])
  })

  it('reports every failing rule, not just the first', () => {
    expect(failures({ title: 'Marketing Intern', location: 'Remote - US', company: 'Example Co' }, { ...studentPrefs, blockedCompanies: ['Example Co'] })).toEqual([
      'role_not_included',
      'blocked_company',
      'remote_outside_region',
    ])
  })
})
