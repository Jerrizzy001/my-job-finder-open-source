import { describe, expect, it } from 'vitest'
import { formatMonth, parseGraduation, parseTerms, termFit } from '../src/index.ts'

const m = (year: number, month: number) => year * 12 + month - 1

describe('parseTerms', () => {
  it.each([
    ['May–Dec 2027', m(2027, 5), m(2027, 12)],
    ['May 2027 - December 2027', m(2027, 5), m(2027, 12)],
    ['September 2026 to April 2027', m(2026, 9), m(2027, 4)],
    ['Sept - Apr 2027', m(2026, 9), m(2027, 4)],
    ['Jan-Apr 2027', m(2027, 1), m(2027, 4)],
    ['Summer 2027', m(2027, 5), m(2027, 8)],
    ['Fall 2026', m(2026, 9), m(2026, 12)],
    ['Winter term 2027', m(2027, 1), m(2027, 4)],
    ['an 8-month co-op starting May 2027', m(2027, 5), m(2027, 12)],
    ['a 4 month term beginning in January 2027', m(2027, 1), m(2027, 4)],
  ])('%s', (text, start, end) => {
    expect(parseTerms(text)[0]).toMatchObject({ start, end })
  })

  it('finds nothing in text without a term', () => {
    expect(parseTerms('You may join a great team in 2027.')).toEqual([])
  })
})

describe('termFit', () => {
  const graduation = parseGraduation('2027-04')

  it('fits a term that ends by graduation', () => {
    expect(termFit('Winter 2027 co-op', graduation).kind).toBe('fits')
  })

  it('rejects a term that ends after graduation', () => {
    expect(termFit('May–Dec 2027', graduation).kind).toBe('after_graduation')
  })

  it('fits when one of several offered terms fits', () => {
    expect(termFit('Winter 2027 or Summer 2027', graduation).kind).toBe('fits')
  })

  it('says no_term without a graduation date', () => {
    expect(termFit('May–Dec 2027', null).kind).toBe('no_term')
  })
})

describe('parseGraduation', () => {
  it('reads YYYY-MM and refuses anything else', () => {
    expect(parseGraduation('2027-04')).toBe(m(2027, 4))
    expect(parseGraduation('April 2027')).toBeNull()
    expect(parseGraduation('2027-13')).toBeNull()
    expect(formatMonth(m(2027, 4))).toBe('Apr 2027')
  })
})
