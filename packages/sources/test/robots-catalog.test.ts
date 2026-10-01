import { describe, expect, it } from 'vitest'
import { formatCatalog, parseCatalog, parseRobots } from '../src/index.ts'

describe('robots.txt', () => {
  it('uses our group over *', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: jobfinder-oss\nAllow: /jobs\nDisallow: /',
      'jobfinder-oss',
    )
    expect(robots.isAllowed('/jobs/1')).toBe(true)
    expect(robots.isAllowed('/admin')).toBe(false)
  })

  it('longest rule wins, Allow wins ties, wildcards and $ work', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /jobs/*login\nDisallow: /*.pdf$\nAllow: /jobs\nDisallow: /jobs',
      'x',
    )
    expect(robots.isAllowed('/jobs/12')).toBe(true)
    expect(robots.isAllowed('/jobs/12/login')).toBe(false)
    expect(robots.isAllowed('/files/a.pdf')).toBe(false)
    expect(robots.isAllowed('/files/a.pdf?x=1')).toBe(true)
  })

  it('an empty Disallow allows everything', () => {
    expect(parseRobots('User-agent: *\nDisallow:', 'x').isAllowed('/anything')).toBe(true)
  })

  it('reads the SmartRecruiters API rules: only LinkedInBot may read', () => {
    const robots = parseRobots(
      'User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /',
      'jobfinder-oss',
    )
    expect(robots.isAllowed('/v1/companies/acme/postings')).toBe(false)
  })
})

describe('catalog.yaml', () => {
  const text = `# Example catalog
boards:
  - company: Example Co   # a comment
    source: greenhouse
    token: example
  - company: "Quoted: Name"
    source: workday
    token: acme
    host: acme.myworkdayjobs.com
    site: External
    cadenceHours: 12
`
  it('parses boards', () => {
    expect(parseCatalog(text)).toEqual([
      { company: 'Example Co', source: 'greenhouse', token: 'example' },
      {
        company: 'Quoted: Name',
        source: 'workday',
        token: 'acme',
        host: 'acme.myworkdayjobs.com',
        site: 'External',
        cadenceHours: 12,
      },
    ])
  })

  it('round-trips through formatCatalog', () => {
    const boards = parseCatalog(text)
    expect(parseCatalog(formatCatalog(boards, 'header'))).toEqual(boards)
  })

  it('rejects unknown sources and unsupported YAML with a line number', () => {
    expect(() => parseCatalog('boards:\n  - company: A\n    source: monster\n    token: a')).toThrow(/unknown source/)
    expect(() => parseCatalog('boards:\n  - company: [A]\n')).toThrow(/line 2/)
  })
})
