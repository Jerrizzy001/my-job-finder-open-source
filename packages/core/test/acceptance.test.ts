/**
 * The acceptance table: real-world title shapes against four saved searches,
 * read the way a board list reads them (title only, no description).
 *
 * Columns: the tier expected for each search.
 *   STU  = ["AI engineer intern", "Software developer intern"]  (a student search)
 *   SWE  = ["Software Engineer"]
 *   DATA = ["Data Analyst"]
 *   PM   = ["Product Manager"]
 *
 * `-` is `none`. Changing a row is a policy change: bump MATCHING_POLICY_VERSION.
 */
import { describe, expect, it } from 'vitest'
import { matchTitle, type TitleTier } from '../src/index.ts'

const SEARCHES = {
  STU: ['AI engineer intern', 'Software developer intern'],
  SWE: ['Software Engineer'],
  DATA: ['Data Analyst'],
  PM: ['Product Manager'],
} as const

type Cell = TitleTier | '-'
type Row = readonly [title: string, stu: Cell, swe: Cell, data: Cell, pm: Cell]

// prettier-ignore
const TABLE: readonly Row[] = [
  // Student markers, every form, all one level
  ['Software Developer Co-op',                      'exact',   '-',       '-',       '-'],
  ['Software Developer (Co-op)',                    'exact',   '-',       '-',       '-'],
  ['Software Developer Coop',                       'exact',   '-',       '-',       '-'],
  ['Software Developer Internship',                 'exact',   '-',       '-',       '-'],
  ['Software Developer, Student',                   'exact',   '-',       '-',       '-'],
  ['Software Developer Summer Student',             'exact',   '-',       '-',       '-'],
  ['Software Developer, Work Term',                 'exact',   '-',       '-',       '-'],
  ['Software Developer (PEY)',                      'exact',   '-',       '-',       '-'],
  ['Software Developer Placement',                  'exact',   '-',       '-',       '-'],
  ['Co-operative Education - Software Developer',   'exact',   '-',       '-',       '-'],
  ['Student Software Developer',                    'exact',   '-',       '-',       '-'],
  ['Software Engineering Intern, Summer 2027',      'exact',   '-',       '-',       '-'],
  ['Software Engineer Intern - Backend',            'close',   '-',       '-',       '-'],
  ['SWE Intern',                                    'exact',   '-',       '-',       '-'],
  // AI and machine learning, by family
  ['Student AI Engineer',                           'exact',   '-',       '-',       '-'],
  ['AI Engineer Co-op',                             'exact',   '-',       '-',       '-'],
  ['Machine Learning Co-op',                        'family',  '-',       '-',       '-'],
  ['Prompt Engineer Intern',                        'family',  '-',       '-',       '-'],
  ['Generative AI Developer, Co-op',                'close',   '-',       '-',       '-'],
  ['LLM Engineer Intern',                           'family',  '-',       '-',       '-'],
  ['Applied AI Program Design & Delivery Intern',   'family',  '-',       '-',       '-'],
  ['Conversational AI Developer Intern',            'close',   '-',       '-',       '-'],
  ['AI Solutions Engineer Intern',                  'close',   '-',       '-',       '-'],
  ['NLP Engineer Intern',                           'family',  '-',       '-',       '-'],
  ['MLOps Intern',                                  'family',  '-',       '-',       '-'],
  ['A.I. Engineering Intern',                       'exact',   '-',       '-',       '-'],
  // Other technical families reached from software
  ['Frontend Developer Intern',                     'family',  '-',       '-',       '-'],
  ['iOS Developer Co-op',                           'family',  '-',       '-',       '-'],
  ['Data Engineer Intern',                          'family',  '-',       '-',       '-'],
  ['DevOps Intern',                                 'family',  '-',       '-',       '-'],
  ['QA Automation Co-op',                           'family',  '-',       '-',       '-'],
  ['Embedded Firmware Intern',                      'family',  '-',       '-',       '-'],
  ['Security Engineer Intern',                      'family',  '-',       '-',       '-'],
  // Related: kept until the description is read
  ['Technology Analyst Intern',                     'related', '-',       '-',       '-'],
  ['Digital Systems Co-op',                         'related', '-',       '-',       '-'],
  ['IT Analyst Intern',                             'related', '-',       '-',       '-'],
  // Non-technical AI, jobs about students, other work: never
  ['AI Sales Intern',                               '-',       '-',       '-',       '-'],
  ['AI Recruiter Intern',                           '-',       '-',       '-',       '-'],
  ['AI Ethics Policy Analyst Intern',               '-',       '-',       '-',       '-'],
  ['Student Success Manager',                       '-',       '-',       '-',       '-'],
  ['Student Services Coordinator',                  '-',       '-',       '-',       '-'],
  ['Placement Specialist',                          '-',       '-',       '-',       '-'],
  ['Co-op Coordinator',                             '-',       '-',       '-',       '-'],
  ['Marketing Intern',                              '-',       '-',       '-',       '-'],
  ['IT Support Co-op',                              '-',       '-',       '-',       '-'],
  ['Financial Analyst Intern',                      '-',       '-',       '-',       '-'],
  ['Technical Support Engineer Intern',             '-',       '-',       '-',       '-'],
  ['Business Development Intern',                   '-',       '-',       '-',       '-'],
  ['UX Design Intern',                              '-',       '-',       '-',       '-'],
  // Not student-level: never for the student search
  ['Software Developer',                            '-',       'exact',   '-',       '-'],
  ['AI Engineer',                                   '-',       'family',  '-',       '-'],
  ['Applied AI Program Design & Delivery',          '-',       'family',  '-',       '-'],
  ['Senior Software Engineer',                      '-',       'close',   '-',       '-'],
  ['Software Engineer II, Payments',                '-',       'close',   '-',       '-'],
  ['Staff Backend Engineer',                        '-',       'family',  '-',       '-'],
  ['Full-Stack Developer',                          '-',       'family',  '-',       '-'],
  ['Site Reliability Engineer',                     '-',       'family',  '-',       '-'],
  ['Software Sales Engineer',                       '-',       '-',       '-',       '-'],
  ['Mechanical Engineer',                           '-',       '-',       '-',       '-'],
  ['Data Analyst',                                  '-',       'family',  'exact',   '-'],
  ['Senior Data Analyst, Marketing',                '-',       'family',  'close',   '-'],
  ['Business Intelligence Developer',               '-',       'family',  'family',  '-'],
  ['Data Scientist',                                '-',       'family',  'family',  '-'],
  ['Machine Learning Engineer',                     '-',       'family',  '-',       '-'],
  ['Frontend Engineer',                             '-',       'family',   '-',       '-'],
  ['Financial Analyst',                             '-',       '-',       '-',       '-'],
  ['Product Manager',                               '-',       '-',       '-',       'exact'],
  ['Senior Product Manager, Payments',              '-',       '-',       '-',       'close'],
  ['Product Owner',                                 '-',       '-',       '-',       'family'],
  ['Program Manager',                               '-',       '-',       '-',       'family'],
  ['Product Designer',                              '-',       '-',       '-',       '-'],
  ['Product Marketing Manager',                     '-',       '-',       '-',       '-'],
]

const COLUMNS = ['STU', 'SWE', 'DATA', 'PM'] as const

describe('acceptance table', () => {
  it('has about sixty titles', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60)
  })

  for (const [title, ...cells] of TABLE) {
    COLUMNS.forEach((column, index) => {
      const expected = cells[index] === '-' ? 'none' : cells[index]
      it(`${column} · ${title} → ${expected}`, () => {
        expect(matchTitle(title, { roleTitles: SEARCHES[column] }).tier).toBe(expected)
      })
    })
  }
})

describe('exclusions', () => {
  it('drops a matching title that is also excluded', () => {
    const match = matchTitle('Senior Software Engineer', {
      roleTitles: ['Software Engineer'],
      excludedTitles: ['Senior Software Engineer'],
    })
    expect(match).toMatchObject({ tier: 'none', dropReason: 'excluded_title' })
  })

  it('keeps the plain title', () => {
    const match = matchTitle('Software Engineer', {
      roleTitles: ['Software Engineer'],
      excludedTitles: ['Senior Software Engineer'],
    })
    expect(match.tier).toBe('exact')
  })
})

describe('levels', () => {
  it('says why a non-student title fails a student search', () => {
    expect(matchTitle('Software Developer', { roleTitles: SEARCHES.STU }).dropReason).toBe('level_mismatch')
  })

  it('reads each saved title at its own level in a mixed search', () => {
    const mixed = { roleTitles: ['Software Engineer', 'Data Analyst Intern'] }
    expect(matchTitle('Software Engineer', mixed).tier).toBe('exact')
    expect(matchTitle('Data Analyst Co-op', mixed).tier).toBe('exact')
    expect(matchTitle('Data Analyst', mixed).tier).not.toBe('exact')
  })
})
