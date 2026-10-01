import { describe, expect, it } from 'vitest'
import type { Preferences } from '@jobfinder/core'
import { discover, listJobs, matchJobs, openDb, PAUSE_AFTER_FAILURES, syncBoards } from '../src/index.ts'

const prefs: Preferences = { roleTitles: ['Software Engineer'], locations: ['Toronto'], remoteRegions: ['Canada'] }
const LIST = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true'

function greenhouse(jobs: { id: number; title: string; location?: string }[]) {
  return JSON.stringify({
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      location: { name: job.location ?? 'Toronto, ON' },
      absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${job.id}`,
      content: '&lt;p&gt;Write TypeScript and Python services.&lt;/p&gt;',
    })),
  })
}

function fetchFrom(bodies: Record<string, () => { status?: number; body?: string }>) {
  return (async (input: string | URL) => {
    const url = String(input)
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
    const route = bodies[url]
    if (!route) throw new Error(`no route ${url}`)
    const { status = 200, body = '' } = route()
    return new Response(body, { status })
  }) as typeof fetch
}

const clock = { now: () => Date.now(), sleep: async () => {} }

function setup() {
  const db = openDb(':memory:')
  syncBoards(db, [{ company: 'Acme', source: 'greenhouse', token: 'acme' }])
  return db
}

describe('discover', () => {
  it('stores only title-selected postings and lists matches with reasons', async () => {
    const db = setup()
    const fetch = fetchFrom({
      [LIST]: () => ({
        body: greenhouse([
          { id: 1, title: 'Software Engineer' },
          { id: 2, title: 'Account Executive' },
        ]),
      }),
    })
    const summary = await discover(db, prefs, { fetch, clock })
    expect(summary).toMatchObject({ boards: 1, seen: 2, selected: 1, inserted: 1 })
    await matchJobs(db, prefs)
    const jobs = listJobs(db)
    expect(jobs.map((job) => job.title)).toEqual(['Software Engineer'])
    expect(jobs[0]!.reasons[0]!.code).toBe('title_exact')
  })

  it('does not run a board again before its cadence, unless --all', async () => {
    const db = setup()
    let calls = 0
    const fetch = fetchFrom({ [LIST]: () => (calls++, { body: greenhouse([]) }) })
    await discover(db, prefs, { fetch, clock })
    await discover(db, prefs, { fetch, clock })
    expect(calls).toBe(1)
    await discover(db, prefs, { fetch, clock, all: true })
    expect(calls).toBe(2)
  })

  it('closes postings a complete read no longer lists, and keeps them on a failed read', async () => {
    const db = setup()
    let body = greenhouse([
      { id: 1, title: 'Software Engineer' },
      { id: 3, title: 'Senior Software Engineer' },
    ])
    let status = 200
    const fetch = fetchFrom({ [LIST]: () => ({ status, body }) })
    await discover(db, prefs, { fetch, clock, all: true })
    status = 500
    await discover(db, prefs, { fetch, clock, all: true })
    await matchJobs(db, prefs)
    expect(listJobs(db)).toHaveLength(2)
    status = 200
    body = greenhouse([{ id: 1, title: 'Software Engineer' }])
    const summary = await discover(db, prefs, { fetch, clock, all: true })
    expect(summary.closed).toBe(1)
    await matchJobs(db, prefs)
    expect(listJobs(db).map((job) => job.title)).toEqual(['Software Engineer'])
  })

  it('pauses a board after repeated failures', async () => {
    const db = setup()
    const fetch = fetchFrom({ [LIST]: () => ({ status: 404 }) })
    for (let i = 0; i < PAUSE_AFTER_FAILURES; i++) await discover(db, prefs, { fetch, clock, all: true })
    const board = db.prepare('SELECT paused_at, paused_reason FROM boards').get() as {
      paused_at: string | null
      paused_reason: string
    }
    expect(board.paused_at).not.toBeNull()
    expect(board.paused_reason).toMatch(/source_not_found/)
    expect((await discover(db, prefs, { fetch, clock, all: true })).boards).toBe(0)
  })
})

describe('re-scoring', () => {
  it('a preference change makes every match stale until it is re-scored', async () => {
    const db = setup()
    const fetch = fetchFrom({
      [LIST]: () => ({ body: greenhouse([{ id: 1, title: 'Software Engineer', location: 'Vancouver, BC' }]) }),
    })
    await discover(db, { ...prefs, locations: ['Vancouver'] }, { fetch, clock })
    await matchJobs(db, { ...prefs, locations: ['Vancouver'] })
    expect(listJobs(db)).toHaveLength(1)

    // Preferences changed, nothing re-scored yet: the old match is not shown as ready.
    const { syncPreferences } = await import('../src/index.ts')
    syncPreferences(db, prefs)
    expect(listJobs(db)).toHaveLength(0)

    const summary = await matchJobs(db, prefs)
    expect(summary.scored).toBe(1)
    expect(listJobs(db)).toHaveLength(0)
    expect((await matchJobs(db, prefs)).skipped).toBe(1)
  })
})
