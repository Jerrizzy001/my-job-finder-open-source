import { describe, expect, it } from 'vitest'
import { isStudentSearch, isStudentTitle, normalizeTitle, studentLevel } from '../src/index.ts'
import { forAll, pick } from './property.ts'

const ROLES = ['Software Developer', 'Data Analyst', 'AI Engineer', 'Machine Learning Engineer', 'Frontend Developer', 'QA Analyst', 'Security Engineer', 'Product Manager', 'Business Analyst']

/** Every way a posting writes "for a student", as a function of the role. */
const FORMS: ReadonlyArray<(role: string) => string> = [
  (r) => `${r} Intern`,
  (r) => `${r} Internship`,
  (r) => `${r} Co-op`,
  (r) => `${r} (Co-op)`,
  (r) => `${r} Coop`,
  (r) => `${r} - Co-operative Education`,
  (r) => `${r}, Work Term`,
  (r) => `${r} (PEY)`,
  (r) => `${r} Placement`,
  (r) => `${r} Summer Student`,
  (r) => `${r}, Student`,
  (r) => `Student ${r}`,
  (r) => `${r} Intern, Summer 2027`,
  (r) => `${r} Co-op (4 months)`,
  (r) => `Co-op - ${r}`,
]

const CASES: ReadonlyArray<(text: string) => string> = [(t) => t, (t) => t.toUpperCase(), (t) => t.toLowerCase()]

describe('student markers are one level (property)', () => {
  it('every form of every role reads as student, with the same role left over', () => {
    forAll(
      500,
      (random) => ({ role: pick(random, ROLES), form: Math.floor(random() * FORMS.length), casing: Math.floor(random() * CASES.length) }),
      ({ role, form, casing }) => {
        const title = CASES[casing]!(FORMS[form]!(role))
        const level = studentLevel(title)
        expect(level.student).toBe(true)
        expect(normalizeTitle(level.rest)).toBe(normalizeTitle(role))
      },
    )
  })

  it('a role with no marker is not student-level, and is unchanged', () => {
    forAll(
      200,
      (random) => pick(random, ROLES),
      (role) => {
        expect(studentLevel(role)).toEqual({ student: false, rest: role.toLowerCase() })
      },
    )
  })

  it('removing markers is idempotent', () => {
    forAll(
      300,
      (random) => FORMS[Math.floor(random() * FORMS.length)]!(pick(random, ROLES)),
      (title) => {
        const once = studentLevel(title).rest
        expect(studentLevel(once).rest).toBe(once)
      },
    )
  })
})

describe('jobs about students are not student jobs', () => {
  it.each([
    'Student Success Manager',
    'Student Services Coordinator',
    'Placement Specialist',
    'Manager, Student Placement',
    'International Student Advisor',
    'Internal Audit Manager',
    'International Sales Lead',
    'Student Ambassador Program Lead',
  ])('%s', (title) => {
    expect(isStudentTitle(title)).toBe(false)
  })
})

describe('isStudentSearch', () => {
  it('is true only when every saved title is student-level', () => {
    expect(isStudentSearch(['AI engineer intern', 'Software developer co-op'])).toBe(true)
    expect(isStudentSearch(['AI engineer intern', 'Software developer'])).toBe(false)
    expect(isStudentSearch([])).toBe(false)
  })
})
