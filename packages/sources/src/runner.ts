import { BoundedHttp, Politeness, SourceError, type Clock, type Limits } from './http.ts'
import { adapterFor } from './registry.ts'
import type { Board, SourcedJob } from './types.ts'

/**
 * The runner: reads one board inside hard bounds and selects as it goes.
 *
 * List first. Every listed posting is normalised and counted as seen, but
 * only postings `select` keeps are returned. For a source whose list has no
 * descriptions, only the selected postings are read in detail, while the
 * request budget lasts; their real titles are then selected again.
 */

export type RunOutcome =
  | 'complete_full'
  | 'complete_partial'
  | 'rate_limited'
  | 'source_not_found'
  | 'blocked_by_robots'
  | 'source_error'

export type RunResult = {
  board: Board
  outcome: RunOutcome
  message: string | null
  jobs: SourcedJob[]
  /** Every posting id the board listed this run, selected or not (for closing postings that left). */
  seenIds: string[]
  seen: number
  selected: number
  hydrated: number
  gone: number
  requests: number
  bytes: number
  startedAt: string
  finishedAt: string
}

export type RunOptions = {
  /** Keep a posting? Called with the list's title (and description, if any). */
  select?: (job: SourcedJob) => boolean
  searchTerms?: readonly string[]
  limits?: Partial<Limits>
  maxItems?: number
  politeness?: Politeness
  fetch?: typeof fetch
  clock?: Clock
}

const DEFAULT_MAX_ITEMS = 5000
const MAX_PAGES = 200
/** For a list without descriptions, the share of the request budget listing may use; the rest reads details. */
export const LIST_SHARE = 0.5

function outcomeFor(error: unknown): { outcome: RunOutcome; message: string } {
  if (!(error instanceof SourceError))
    return { outcome: 'source_error', message: (error as Error)?.message ?? String(error) }
  switch (error.code) {
    case 'rate_limited':
      return { outcome: 'rate_limited', message: error.message }
    case 'blocked_by_robots':
      return { outcome: 'blocked_by_robots', message: error.message }
    case 'source_not_found':
    case 'gone':
      return { outcome: 'source_not_found', message: error.message }
    case 'budget_exhausted':
      return { outcome: 'complete_partial', message: error.message }
    default:
      return { outcome: 'source_error', message: error.message }
  }
}

export async function runBoard(board: Board, options: RunOptions = {}): Promise<RunResult> {
  const startedAt = new Date((options.clock ?? { now: Date.now }).now()).toISOString()
  const adapter = adapterFor(board.source)
  let hosts: string[]
  try {
    hosts = adapter.allowedHosts(board)
  } catch (error) {
    // A misconfigured board (a bad host or token) fails its run; it never throws past the runner.
    const now = new Date((options.clock ?? { now: Date.now }).now()).toISOString()
    const { message } = outcomeFor(error)
    return {
      board,
      outcome: 'source_error',
      message,
      jobs: [],
      seenIds: [],
      seen: 0,
      selected: 0,
      hydrated: 0,
      gone: 0,
      requests: 0,
      bytes: 0,
      startedAt: now,
      finishedAt: now,
    }
  }
  const http = new BoundedHttp({
    allowedHosts: hosts,
    limits: options.limits,
    politeness: options.politeness,
    fetch: options.fetch,
    clock: options.clock,
  })
  const select = options.select ?? (() => true)
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS

  const kept = new Map<string, SourcedJob>()
  const seenIds = new Set<string>()
  let outcome: RunOutcome = 'complete_full'
  let message: string | null = null

  try {
    let cursor: string | null = null
    const listBudget = adapter.listHasDescriptions
      ? Infinity
      : Math.max(1, Math.floor(http.limits.maxRequests * LIST_SHARE))
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0 && http.requests >= listBudget) {
        outcome = 'complete_partial'
        message = `Listed ${listBudget} pages and kept the rest of the request budget for reading the selected postings.`
        break
      }
      const remainingItems = maxItems - seenIds.size
      if (remainingItems <= 0) {
        outcome = 'complete_partial'
        message = `Stopped at the ${maxItems}-item limit.`
        break
      }
      const result = await adapter.discoverPage(
        { board, cursor, searchTerms: options.searchTerms ?? [], remainingItems },
        http,
      )
      for (const raw of result.items) {
        const job = adapter.normalize(raw, board)
        if (!job || seenIds.has(job.sourceId)) continue
        seenIds.add(job.sourceId)
        if (select(job)) kept.set(job.sourceId, job)
      }
      cursor = result.nextCursor
      if (!cursor) break
    }
  } catch (error) {
    ;({ outcome, message } = outcomeFor(error))
    // A board that failed after some pages still gave us those pages.
    if (seenIds.size > 0 && outcome !== 'rate_limited') outcome = 'complete_partial'
  }

  let hydrated = 0
  let gone = 0
  if (adapter.hydrate && !adapter.listHasDescriptions && outcome !== 'rate_limited') {
    for (const [id, job] of kept) {
      if (job.description) continue
      if (http.remainingRequests <= 0) {
        outcome = 'complete_partial'
        message = 'Request budget ran out before every selected posting was read.'
        break
      }
      try {
        const detailed = await adapter.hydrate(job, board, http)
        if (!detailed) {
          kept.delete(id)
          gone++
          continue
        }
        hydrated++
        if (select(detailed)) kept.set(id, detailed)
        else kept.delete(id)
      } catch (error) {
        const failure = outcomeFor(error)
        if (error instanceof SourceError && error.code === 'gone') {
          kept.delete(id)
          gone++
          continue
        }
        if (
          failure.outcome === 'rate_limited' ||
          failure.outcome === 'complete_partial' ||
          failure.outcome === 'blocked_by_robots'
        ) {
          outcome = failure.outcome === 'rate_limited' ? 'rate_limited' : 'complete_partial'
          message = failure.message
          break
        }
        // One unreadable detail page: keep the posting without a description.
      }
    }
  }

  const aiInput = !hosts.some((host) => http.contentSignals(host)['ai-input'] === 'no')
  const jobs = [...kept.values()].map((job) => (aiInput ? job : { ...job, aiInput: false }))
  return {
    board,
    outcome,
    message,
    jobs,
    seenIds: [...seenIds],
    seen: seenIds.size,
    selected: jobs.length,
    hydrated,
    gone,
    requests: http.requests,
    bytes: http.bytes,
    startedAt,
    finishedAt: new Date((options.clock ?? { now: Date.now }).now()).toISOString(),
  }
}
