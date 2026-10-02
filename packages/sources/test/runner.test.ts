import { describe, expect, it } from 'vitest'
import { Politeness, runBoard, USER_AGENT } from '../src/index.ts'
import { fakeClock, fakeFetch, fixture } from './fake-fetch.ts'

const board = { company: 'Discord', source: 'greenhouse' as const, token: 'discord' }
const LIST = 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true'
const ROBOTS = 'https://boards-api.greenhouse.io/robots.txt'

describe('runner bounds', () => {
  it('sends an honest User-Agent and no browser disguise', async () => {
    const { fetch, calls } = fakeFetch({ [LIST]: { body: fixture('greenhouse-list.json') } })
    await runBoard(board, { fetch, clock: fakeClock() })
    const headers = calls.at(-1)!.init.headers as Record<string, string>
    expect(headers['user-agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toMatch(/^jobfinder-oss\/[\d.]+ \(\+https:\/\//)
  })

  it('selects by title and counts the rest as seen', async () => {
    const { fetch } = fakeFetch({ [LIST]: { body: fixture('greenhouse-list.json') } })
    const result = await runBoard(board, { fetch, clock: fakeClock(), select: (job) => /scientist/i.test(job.title) })
    expect(result.seen).toBe(4)
    expect(result.selected).toBe(1)
  })

  it('honours robots.txt', async () => {
    const { fetch, calls } = fakeFetch({ [ROBOTS]: { body: 'User-agent: *\nDisallow: /v1/' }, [LIST]: { body: '{}' } })
    const result = await runBoard(board, { fetch, clock: fakeClock() })
    expect(result.outcome).toBe('blocked_by_robots')
    expect(calls.map((call) => call.url)).toEqual([ROBOTS])
  })

  it('treats an unreachable robots.txt as disallow-all', async () => {
    const { fetch } = fakeFetch({ [ROBOTS]: { status: 500 }, [LIST]: { body: '{}' } })
    expect((await runBoard(board, { fetch, clock: fakeClock() })).outcome).toBe('blocked_by_robots')
  })

  it('backs off on 429 and does not retry', async () => {
    const politeness = new Politeness()
    const { fetch, calls } = fakeFetch({ [LIST]: { status: 429, headers: { 'retry-after': '120' } } })
    const clock = fakeClock()
    const first = await runBoard(board, { fetch, clock, politeness })
    expect(first.outcome).toBe('rate_limited')
    const listCalls = () => calls.filter((call) => call.url === LIST).length
    expect(listCalls()).toBe(1)
    const second = await runBoard(board, { fetch, clock, politeness })
    expect(second.outcome).toBe('rate_limited')
    expect(listCalls()).toBe(1)
  })

  it('maps 404 to source_not_found', async () => {
    const { fetch } = fakeFetch({ [LIST]: { status: 404 } })
    expect((await runBoard(board, { fetch, clock: fakeClock() })).outcome).toBe('source_not_found')
  })

  it('waits at least a second between requests to one host', async () => {
    const page = (skip: number, n: number) =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          id: `p${skip + i}`,
          text: 'Role',
          hostedUrl: 'https://jobs.lever.co/a/x',
          categories: {},
        })),
      )
    const { fetch } = fakeFetch({
      'https://api.lever.co/v0/postings/a?mode=json&skip=0&limit=100': { body: page(0, 100) },
      'https://api.lever.co/v0/postings/a?mode=json&skip=100&limit=100': { body: page(100, 1) },
    })
    const clock = fakeClock()
    await runBoard({ company: 'A', source: 'lever', token: 'a' }, { fetch, clock })
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(2)
    expect(clock.sleeps.every((ms) => ms >= 1000 || ms === 0)).toBe(true)
  })

  it('stops at the request budget with a partial outcome', async () => {
    const page = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}-${Math.random()}`,
        text: 'Role',
        hostedUrl: 'https://jobs.lever.co/a/x',
        categories: {},
      })),
    )
    const routes: Record<string, { body: string }> = {}
    for (let skip = 0; skip <= 1000; skip += 100)
      routes[`https://api.lever.co/v0/postings/a?mode=json&skip=${skip}&limit=100`] = { body: page }
    const { fetch } = fakeFetch(routes)
    const result = await runBoard(
      { company: 'A', source: 'lever', token: 'a' },
      { fetch, clock: fakeClock(), limits: { maxRequests: 3 } },
    )
    expect(result.outcome).toBe('complete_partial')
    expect(result.requests).toBe(3)
  })

  it('refuses a redirect to a host the board does not allow', async () => {
    const { fetch } = fakeFetch({ [LIST]: { status: 302, headers: { location: 'https://elsewhere.example/jobs' } } })
    const result = await runBoard(board, { fetch, clock: fakeClock() })
    expect(result.outcome).toBe('source_error')
    expect(result.message).toMatch(/not an allowed host/)
  })

  it('refuses a response over the byte limit', async () => {
    const { fetch } = fakeFetch({ [LIST]: { body: 'x'.repeat(2000) } })
    const result = await runBoard(board, { fetch, clock: fakeClock(), limits: { maxBytesPerResponse: 1000 } })
    expect(result.outcome).toBe('source_error')
  })

  it('marks jobs from a host that says ai-input=no', async () => {
    const { fetch } = fakeFetch({
      [ROBOTS]: { body: 'User-agent: *\nContent-Signal: search=yes, ai-input=no\nDisallow:' },
      [LIST]: { body: fixture('greenhouse-list.json') },
    })
    const result = await runBoard(board, { fetch, clock: fakeClock() })
    expect(result.jobs.every((job) => job.aiInput === false)).toBe(true)
  })
})

describe('list-first budget', () => {
  it('keeps half the request budget for detail reads', async () => {
    const page = (n: number) =>
      JSON.stringify({
        totalFound: 1000,
        content: Array.from({ length: 100 }, (_, i) => ({ id: `${n}-${i}`, name: 'Software Engineer' })),
      })
    const routes: Record<string, { body: string }> = {
      'https://api.smartrecruiters.com/robots.txt': { body: 'User-agent: *\nAllow: /' },
    }
    for (let n = 0; n < 10; n++)
      routes[`https://api.smartrecruiters.com/v1/companies/a/postings?limit=100&offset=${n * 100}`] = { body: page(n) }
    const { fetch } = fakeFetch(
      new Proxy(routes, {
        get: (target, key: string) =>
          target[key] ??
          (key.includes('/postings/')
            ? {
                body: JSON.stringify({
                  id: key.split('/').at(-1),
                  name: 'Software Engineer',
                  jobAd: { sections: { jobDescription: { text: 'x' } } },
                }),
              }
            : undefined),
      }),
    )
    const result = await runBoard(
      { company: 'A', source: 'smartrecruiters', token: 'a' },
      { fetch, clock: fakeClock(), limits: { maxRequests: 10 } },
    )
    expect(result.outcome).toBe('complete_partial')
    expect(result.seen).toBe(500)
    expect(result.hydrated).toBe(5)
  })
})
