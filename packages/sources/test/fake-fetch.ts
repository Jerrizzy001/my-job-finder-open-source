import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Clock } from '../src/index.ts'

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
}

export type Route = { status?: number; body?: string; headers?: Record<string, string> }
export type Routes = Record<string, Route | ((init: RequestInit) => Route)>

/**
 * A fetch that answers from a URL → response table and records every call.
 * Unknown robots.txt answers 404 (no rules); any other unknown URL is a test bug.
 */
export function fakeFetch(routes: Routes) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const route = routes[url]
    if (!route) {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
      throw new Error(`fakeFetch: no route for ${url}`)
    }
    const answer = typeof route === 'function' ? route(init) : route
    return new Response(answer.body ?? '', { status: answer.status ?? 200, headers: answer.headers })
  }) as typeof fetch
  return { fetch: impl, calls }
}

/** A clock that never really sleeps, and records the waits it was asked for. */
export function fakeClock(start = Date.parse('2026-10-01T12:00:00Z')): Clock & { sleeps: number[] } {
  let now = start
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
    },
  }
}
