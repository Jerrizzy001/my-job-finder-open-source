import { describe, expect, it } from 'vitest'
import { runBoard, type Board } from '../src/index.ts'
import { fakeClock, fakeFetch, fixture } from './fake-fetch.ts'

async function run(board: Board, routes: Parameters<typeof fakeFetch>[0]) {
  const { fetch } = fakeFetch(routes)
  return runBoard(board, { fetch, clock: fakeClock() })
}

describe('greenhouse', () => {
  it('reads a board with descriptions', async () => {
    const result = await run(
      { company: 'Discord', source: 'greenhouse', token: 'discord' },
      {
        'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true': {
          body: fixture('greenhouse-list.json'),
        },
      },
    )
    expect(result.outcome).toBe('complete_full')
    expect(result.seen).toBe(4)
    const job = result.jobs[0]!
    expect(job).toMatchObject({
      source: 'greenhouse',
      tenant: 'discord',
      company: 'Discord',
      title: 'Commercial Policy Lead',
    })
    expect(job.url).toMatch(/^https:\/\//)
    expect(job.description).toContain('- Build features in TypeScript and React.')
    expect(job.description).not.toContain('<')
  })
})

describe('lever', () => {
  it('reads postings, joins lists into the description and reads the work mode', async () => {
    const result = await run(
      { company: 'Palantir', source: 'lever', token: 'palantir' },
      {
        'https://api.lever.co/v0/postings/palantir?mode=json&skip=0&limit=100': { body: fixture('lever-list.json') },
      },
    )
    expect(result.outcome).toBe('complete_full')
    const job = result.jobs[0]!
    expect(job.title).toBe('Administrative Business Partner')
    expect(job.description).toContain('What you will do\n- Ship code with your team.')
    expect(job.location).toBeTruthy()
    expect(['remote', 'hybrid', 'onsite', null]).toContain(job.workplaceType)
  })

  it('pages with skip until a short page', async () => {
    const full = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`,
        text: `Role ${i}`,
        hostedUrl: `https://jobs.lever.co/acme/p${i}`,
        categories: {},
      })),
    )
    const result = await run(
      { company: 'Acme', source: 'lever', token: 'acme' },
      {
        'https://api.lever.co/v0/postings/acme?mode=json&skip=0&limit=100': { body: full },
        'https://api.lever.co/v0/postings/acme?mode=json&skip=100&limit=100': {
          body: JSON.stringify([
            { id: 'last', text: 'Last', hostedUrl: 'https://jobs.lever.co/acme/last', categories: {} },
          ]),
        },
      },
    )
    expect(result.seen).toBe(101)
    expect(result.requests).toBe(2)
  })
})

describe('ashby', () => {
  it('reads listed postings and skips unlisted ones', async () => {
    const result = await run(
      { company: 'Notion', source: 'ashby', token: 'notion' },
      {
        'https://api.ashbyhq.com/posting-api/job-board/notion': { body: fixture('ashby-list.json') },
      },
    )
    expect(result.seen).toBe(4)
    expect(result.jobs.map((job) => job.title)).not.toContain('Unlisted Example Role')
    expect(result.jobs[0]!.url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\//)
    expect(result.jobs[0]!.description).toContain('TypeScript')
  })
})
