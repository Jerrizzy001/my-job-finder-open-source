import type { Job } from '@jobfinder/core'
import type { BoundedHttp } from './http.ts'

export type SourceKey =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'icims'
  | 'workday'
  | 'dayforce'
  | 'jsonld'

/**
 * One employer board, as `catalog.yaml` lists it.
 *
 * `token` is the board's id on its ATS: the Greenhouse board token, the Lever
 * or Ashby org slug, the SmartRecruiters company id, the Workable account,
 * the iCIMS portal host, the Dayforce namespace. Workday also needs `host`
 * and `site`; the JSON-LD adapter needs `url` (a careers page listing links).
 */
export type Board = {
  company: string
  source: SourceKey
  token: string
  host?: string
  site?: string
  url?: string
  /** Hours between reads. Default 6. */
  cadenceHours?: number
}

/** A posting with its identity on the source. */
export type SourcedJob = Job & {
  /** The posting's id on its source; with source + tenant it is unique. */
  sourceId: string
  /** The board token the posting came from. */
  tenant: string
  /** False when the host's robots.txt says `Content-Signal: ai-input=no`. */
  aiInput?: boolean
}

export type DiscoverInput = {
  board: Board
  cursor: string | null
  /** What the saved search asks for, for boards that can search (Workday). */
  searchTerms: readonly string[]
  /** How many more items the run may take. */
  remainingItems: number
}

export type DiscoverPage<Raw> = { items: Raw[]; nextCursor: string | null }

/**
 * One ATS. Adapters only parse and build requests; the runner owns the
 * budget, the delay, robots.txt and which hosts may be called.
 */
export interface Adapter<Raw = unknown> {
  readonly source: SourceKey
  /** Whether the list read carries descriptions. If not, selected postings are hydrated. */
  readonly listHasDescriptions: boolean
  /** The hosts this board may call. Anything else is refused. */
  allowedHosts(board: Board): string[]
  discoverPage(input: DiscoverInput, http: BoundedHttp): Promise<DiscoverPage<Raw>>
  /** A raw item as a posting, or null when it is not a usable posting. */
  normalize(raw: Raw, board: Board): SourcedJob | null
  /** Read one selected posting's detail. Returns null when it is gone. */
  hydrate?(job: SourcedJob, board: Board, http: BoundedHttp): Promise<SourcedJob | null>
}
