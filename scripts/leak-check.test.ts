import { describe, expect, it } from 'vitest'
import { scan } from './leak-check.ts'

describe('leak check', () => {
  it('allows the public hosted address', () => {
    expect(scan('README.md', 'Try https://myjobfinder.live for the full experience.')).toEqual([])
  })

  it('does not flag words that merely contain sk_', () => {
    expect(scan('a.ts', "'risk_compliance', task_queue")).toEqual([])
  })

  it.each([
    'api.myjobfinder.internal',
    'acme.wd3.myworkdayjobs.com',
    'whsec_abc',
    'sk_live_abcdefghijk',
    'AIzaSyA1234567890abcdefghijk',
    'account 0123456789abcdef0123456789abcdef',
    'someone@gmail.com',
  ])('flags %s', (line) => {
    expect(scan('a.ts', line)).toHaveLength(1)
  })
})
