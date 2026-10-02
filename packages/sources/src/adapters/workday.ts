import type { WorkMode } from '@jobfinder/core'
import { htmlToText, isRecord, str } from '../html.ts'
import { SourceError } from '../http.ts'
import type { Adapter, Board, SourcedJob } from '../types.ts'

/**
 * Workday career sites: the public JSON the site's own search page calls.
 * No sign-in, no cookies.
 *
 *   POST https://{host}/wday/cxs/{tenant}/{site}/jobs   {searchText, limit, offset, appliedFacets}
 *   GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
 *
 * Large employers list thousands of postings, so the board is searched term
 * by term with the saved search's titles; the cursor is `term:offset:total`.
 * The list has titles and places but no descriptions, so selected postings
 * are read in detail. `host` is the career site's host (`<tenant>.wd<N>.myworkdayjobs.com`).
 */

type Raw = Record<string, unknown>
const PAGE = 20

function site(board: Board): { host: string; site: string; tenant: string } {
  const host = board.host?.toLowerCase() ?? ''
  if (!/^[a-z0-9-]+(\.wd\d+)?\.myworkdayjobs\.com$/.test(host))
    throw new SourceError('source_error', 'A Workday board needs host: <tenant>.wd<N>.myworkdayjobs.com.')
  if (!board.site || !/^[A-Za-z0-9_-]{1,100}$/.test(board.site))
    throw new SourceError('source_error', 'A Workday board needs site: the career site name in its URL.')
  return { host, site: board.site, tenant: board.token }
}

function remoteType(value: unknown): WorkMode | null {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('remote')) return 'remote'
  if (text.includes('hybrid') || text.includes('flexible')) return 'hybrid'
  if (text.includes('on-site') || text.includes('onsite') || text.includes('on site')) return 'onsite'
  return null
}

/** The requisition id: the bullet field that ends the external path, else the path's tail. */
function sourceIdOf(raw: Raw, path: string): string {
  const bullets = Array.isArray(raw.bulletFields) ? raw.bulletFields.map((b) => String(b)) : []
  const fromBullet = bullets.find((bullet) => path.endsWith(`_${bullet}`) || path.includes(`_${bullet}-`))
  return fromBullet ?? path.slice(path.lastIndexOf('/') + 1)
}

export const workday: Adapter<Raw> = {
  source: 'workday',
  listHasDescriptions: false,
  allowedHosts: (board) => [site(board).host],

  async discoverPage({ board, cursor, searchTerms }, http) {
    const { host, site: name, tenant } = site(board)
    const terms = searchTerms.length ? [...searchTerms] : ['']
    const [termIndex = 0, offset = 0, knownTotal = -1] = (cursor ?? '0:0:-1').split(':').map(Number)
    const body = await http.json<{ total?: unknown; jobPostings?: unknown }>({
      url: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(name)}/jobs`,
      method: 'POST',
      json: { appliedFacets: {}, limit: PAGE, offset, searchText: terms[termIndex] },
    })
    const jobs = Array.isArray(body.jobPostings) ? body.jobPostings.filter(isRecord) : []
    // Workday states the total on a term's first page; later pages may say 0.
    const total = offset === 0 ? Number(body.total ?? 0) : knownTotal
    const nextOffset = offset + jobs.length
    const more = jobs.length === PAGE && (total <= 0 || nextOffset < total)
    const nextCursor = more
      ? `${termIndex}:${nextOffset}:${total}`
      : termIndex + 1 < terms.length
        ? `${termIndex + 1}:0:-1`
        : null
    return { items: jobs, nextCursor }
  },

  normalize(raw, board): SourcedJob | null {
    const { host, site: name } = site(board)
    const title = str(raw.title)
    const path = typeof raw.externalPath === 'string' ? raw.externalPath : ''
    if (!title || !path.startsWith('/job/')) return null
    return {
      sourceId: sourceIdOf(raw, path),
      tenant: board.token,
      source: 'workday',
      company: board.company,
      title,
      location: str(raw.locationsText),
      workplaceType: remoteType(raw.remoteType),
      description: null,
      url: `https://${host}/${name}${path}`,
      postedAt: null,
    }
  },

  async hydrate(job, board, http) {
    const { host, site: name, tenant } = site(board)
    const path = new URL(job.url).pathname.slice(name.length + 1)
    const response = await http.request({
      url: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(name)}${path}`,
    })
    if (response.status === 404 || response.status === 410) return null
    if (response.status < 200 || response.status >= 300)
      throw new SourceError('source_error', `Workday detail answered ${response.status}.`)
    const info = (JSON.parse(response.text) as { jobPostingInfo?: Raw }).jobPostingInfo
    if (!isRecord(info)) return job
    return {
      ...job,
      title: str(info.title) ?? job.title,
      location: str(info.location) ?? job.location,
      workplaceType: remoteType(info.remoteType) ?? job.workplaceType,
      description: htmlToText(typeof info.jobDescription === 'string' ? info.jobDescription : null),
      employmentType: str(info.timeType),
      postedAt: str(info.startDate) ? new Date(`${info.startDate}T00:00:00Z`).toISOString() : null,
    }
  },
}
