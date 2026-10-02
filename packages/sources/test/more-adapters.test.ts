import { describe, expect, it } from 'vitest'
import { findJobPostings, readLdPosting, runBoard, type Board } from '../src/index.ts'
import { jobLinks } from '../src/adapters/jsonld.ts'
import { readSitemap, slugToTitle } from '../src/adapters/icims.ts'
import { fakeClock, fakeFetch, fixture, type Routes } from './fake-fetch.ts'

async function run(
  board: Board,
  routes: Routes,
  options: { searchTerms?: string[]; select?: (title: string) => boolean } = {},
) {
  const fake = fakeFetch(routes)
  const select = options.select
  const result = await runBoard(board, {
    fetch: fake.fetch,
    clock: fakeClock(),
    searchTerms: options.searchTerms,
    select: select ? (job) => select(job.title) : undefined,
  })
  return { result, calls: fake.calls }
}

describe('workable', () => {
  it('reads the widget list with descriptions and remote flags', async () => {
    const { result } = await run(
      { company: 'Acme', source: 'workable', token: 'acme' },
      {
        'https://apply.workable.com/api/v1/widget/accounts/acme?details=true': { body: fixture('workable-list.json') },
      },
    )
    expect(result.outcome).toBe('complete_full')
    expect(result.seen).toBe(3)
    const job = result.jobs[0]!
    expect(job.url).toMatch(/^https:\/\/apply\.workable\.com\/j\//)
    expect(job.description).toContain('TypeScript')
    expect(job.workplaceType).toBe('remote')
  })
})

describe('smartrecruiters (list-first)', () => {
  const board: Board = { company: 'Acme Corp', source: 'smartrecruiters', token: 'AcmeCorp' }
  const routes: Routes = {
    'https://api.smartrecruiters.com/robots.txt': { body: 'User-agent: *\nAllow: /' },
    'https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings?limit=100&offset=0': {
      body: fixture('smartrecruiters-list.json'),
    },
    'https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings/744000001234567': {
      body: fixture('smartrecruiters-detail.json'),
    },
  }

  it('reads details only for selected postings', async () => {
    const { result, calls } = await run(board, routes, { select: (title) => /engineer/i.test(title) })
    expect(result).toMatchObject({ seen: 2, selected: 1, hydrated: 1 })
    expect(calls.some((call) => call.url.endsWith('744000001234568'))).toBe(false)
    expect(result.jobs[0]!.description).toContain('Python and SQL')
    expect(result.jobs[0]!.url).toContain('jobs.smartrecruiters.com')
  })

  it('is refused by the real robots.txt, which allows only LinkedInBot', async () => {
    const { result } = await run(board, {
      ...routes,
      'https://api.smartrecruiters.com/robots.txt': {
        body: 'User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /',
      },
    })
    expect(result.outcome).toBe('blocked_by_robots')
  })
})

describe('icims (sitemap, then JSON-LD per selected page)', () => {
  const board: Board = { company: 'Acme', source: 'icims', token: 'careers-acme' }
  const sitemap = fixture('icims-sitemap.xml')
  const firstJob = /<loc>(https:\/\/careers-acme\.icims\.com\/jobs\/\d+\/[^<]+\/job)<\/loc>/.exec(sitemap)![1]!

  it('reads slugs as titles and skips non-postings and login paths', () => {
    const { postings } = readSitemap(sitemap, 'careers-acme.icims.com')
    expect(postings.length).toBe(4)
    expect(postings.every((posting) => !/login|intro/.test(posting.url))).toBe(true)
    expect(slugToTitle('senior-data-engineer%2c-dx')).toBe('Senior Data Engineer, Dx')
  })

  it('hydrates selected postings from their JSON-LD and drops gone ones', async () => {
    const postings = readSitemap(sitemap, 'careers-acme.icims.com').postings
    const routes: Routes = {
      'https://careers-acme.icims.com/sitemap.xml': { body: sitemap },
      [`${firstJob}?in_iframe=1`]: { body: fixture('icims-job.html') },
    }
    const second = postings[1]!.url
    routes[`${second}?in_iframe=1`] = { status: 410 }
    const titles = [postings[0]!.slugTitle, postings[1]!.slugTitle].map((title) => title.toLowerCase())
    const { result } = await run(board, routes, { select: (title) => titles.includes(title.toLowerCase()) })
    expect(result.gone).toBe(1)
    expect(result.jobs).toHaveLength(1)
    const job = result.jobs[0]!
    expect(job.description).toContain('TypeScript')
    expect(job.location).toContain('Salt Lake City')
    expect(job.workplaceType).toBe('remote')
  })
})

describe('workday (term search, then detail)', () => {
  const board: Board = {
    company: 'Acme',
    source: 'workday',
    token: 'acme',
    host: 'acme.myworkdayjobs.com',
    site: 'External',
  }
  const list = JSON.parse(fixture('workday-list.json')) as { jobPostings: { externalPath: string }[] }

  it('searches each term, dedupes across terms, and reads selected details', async () => {
    const posts: unknown[] = []
    const routes: Routes = {
      'https://acme.myworkdayjobs.com/wday/cxs/acme/External/jobs': (init) => {
        posts.push(JSON.parse(String(init.body)))
        return { body: fixture('workday-list.json') }
      },
      [`https://acme.myworkdayjobs.com/wday/cxs/acme/External${list.jobPostings[2]!.externalPath}`]: {
        body: fixture('workday-detail.json'),
      },
    }
    const { result } = await run(board, routes, {
      searchTerms: ['software engineer', 'software developer'],
      select: (title) => /OpenShell/.test(title),
    })
    expect(posts).toEqual([
      { appliedFacets: {}, limit: 20, offset: 0, searchText: 'software engineer' },
      { appliedFacets: {}, limit: 20, offset: 0, searchText: 'software developer' },
    ])
    expect(result.seen).toBe(3)
    expect(result.hydrated).toBe(1)
    const job = result.jobs[0]!
    expect(job.sourceId).toMatch(/^JR\d+$/)
    expect(job.url).toBe(`https://acme.myworkdayjobs.com/External${list.jobPostings[2]!.externalPath}`)
    expect(job.description).toContain('Python services')
    expect(job.employmentType).toBe('Full time')
  })

  it('refuses a host that is not a Workday career site', async () => {
    const { result } = await run({ ...board, host: 'evil.example' }, {})
    expect(result.outcome).toBe('source_error')
  })
})

describe('dayforce (public CSRF token, then search)', () => {
  it('fetches the token once, sends it with its cookie, and reads postings', async () => {
    let searchInit: RequestInit | null = null
    const { result, calls } = await run(
      { company: 'Acme', source: 'dayforce', token: 'acme' },
      {
        'https://jobs.dayforcehcm.com/api/auth/csrf': {
          body: JSON.stringify({ csrfToken: 'abcdefghijklmnopqrstuvwxyz012345' }),
          headers: { 'set-cookie': '__Host-next-auth.csrf-token=abc%7Cdef; Path=/; HttpOnly; Secure; SameSite=Lax' },
        },
        'https://jobs.dayforcehcm.com/api/geo/acme/jobposting/search': (init) => {
          searchInit = init
          return { body: fixture('dayforce-search.json') }
        },
      },
    )
    expect(result.outcome).toBe('complete_full')
    expect(calls.filter((call) => call.url.endsWith('/api/auth/csrf'))).toHaveLength(1)
    const headers = searchInit!.headers as Record<string, string>
    expect(headers['x-csrf-token']).toBe('abcdefghijklmnopqrstuvwxyz012345')
    expect(headers.cookie).toBe('__Host-next-auth.csrf-token=abc%7Cdef')
    expect(headers['user-agent']).toMatch(/^jobfinder-oss/)
    expect(result.jobs[0]!.url).toMatch(/^https:\/\/jobs\.dayforcehcm\.com\/en-US\/acme\/CANDIDATEPORTAL\/jobs\/\d+$/)
    expect(result.jobs[0]!.location).toContain('Toronto, ON, CA')
  })
})

describe('json-ld careers pages', () => {
  const board: Board = { company: 'Acme', source: 'jsonld', token: 'acme', url: 'https://acme.example/careers' }

  it('finds same-host job links, then reads JobPosting from the selected page', async () => {
    const { result } = await run(
      board,
      {
        'https://acme.example/careers': { body: fixture('careers-page.html') },
        'https://acme.example/careers/software-engineer-backend': { body: fixture('careers-job.html') },
      },
      { select: (title) => /engineer/i.test(title) },
    )
    expect(result).toMatchObject({ seen: 2, selected: 1, hydrated: 1 })
    const job = result.jobs[0]!
    expect(job.description).toBe('Build Python and Go services on AWS.')
    expect(job.location).toBe('Remote (Canada)')
    expect(job.workplaceType).toBe('remote')
  })

  it('reads JobPosting inside @graph', () => {
    const [node] = findJobPostings(fixture('careers-job.html'))
    expect(readLdPosting(node!)).toMatchObject({
      title: 'Software Engineer, Backend',
      identifier: 'ACME-42',
      employmentType: 'FULL_TIME',
    })
  })

  it('ignores links to other hosts', () => {
    const links = jobLinks(fixture('careers-page.html'), new URL(board.url!), /\/careers\/./)
    expect(links.map((link) => link.title)).toEqual(['Software Engineer, Backend', 'Marketing Manager'])
  })
})
