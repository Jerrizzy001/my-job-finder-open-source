import { str } from '../html.ts'
import { expectOk, SourceError, type BoundedHttp } from '../http.ts'
import { findJobPostings, readLdPosting } from '../jsonld.ts'
import type { Adapter, Board, SourcedJob } from '../types.ts'

/**
 * iCIMS career portals, `https://<tenant>.icims.com`.
 *
 * There is no public JSON. What every portal serves, and robots.txt allows,
 * is `/sitemap.xml` (one `<url>` per open posting) and each posting's page,
 * whose `?in_iframe=1` view carries a JSON-LD JobPosting. So the board is
 * read list first: the sitemap names postings only by URL slug, the slug read
 * as words is the title used to select, and only selected postings' pages
 * are read. A 410 (or 404) on a page means the posting is gone.
 *
 * Login, candidate and referral paths are never requested: robots.txt
 * disallows them and the runner enforces it, and this adapter skips them too.
 */

export type IcimsRaw = { id: string; url: string; slugTitle: string; lastmod: string | null }

const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/
const SKIP = /login|candidate|referral|reminder|connect/i
const MAX_CHILD_SITEMAPS = 20

function host(board: Board): string {
  if (!TENANT.test(board.token))
    throw new SourceError('source_error', `"${board.token}" is not an iCIMS portal label (e.g. careers-acme).`)
  return `${board.token}.icims.com`
}

/** "senior-data-engineer%2c-dx" as "Senior Data Engineer, Dx". */
export function slugToTitle(slug: string): string {
  let text: string
  try {
    text = decodeURIComponent(slug)
  } catch {
    text = slug
  }
  return text
    .replace(/[-_]+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
}

/** A sitemap's postings, or a sitemap index's children on the same host. */
export function readSitemap(xml: string, portal: string): { postings: IcimsRaw[]; children: string[] } {
  const children: string[] = []
  if (/<sitemapindex[\s>]/i.test(xml)) {
    for (const match of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) {
      try {
        const url = new URL(match[1]!)
        if (url.hostname === portal && url.pathname.endsWith('.xml')) children.push(url.pathname + url.search)
      } catch {
        // not a URL
      }
    }
    return { postings: [], children: children.slice(0, MAX_CHILD_SITEMAPS) }
  }
  const postings: IcimsRaw[] = []
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(match[1]!)?.[1]
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(match[1]!)?.[1] ?? null
    if (!loc) continue
    let url: URL
    try {
      url = new URL(loc.replace(/&amp;/g, '&'))
    } catch {
      continue
    }
    const job = /^\/jobs\/(\d{1,12})\/([^/]+)\/job\/?$/.exec(url.pathname)
    if (url.hostname !== portal || !job || SKIP.test(url.pathname)) continue
    postings.push({ id: job[1]!, url: url.toString(), slugTitle: slugToTitle(job[2]!), lastmod })
  }
  return { postings, children: [] }
}

async function readPage(http: BoundedHttp, job: SourcedJob): Promise<string | null> {
  const url = new URL(job.url)
  url.searchParams.set('in_iframe', '1')
  const response = await http.request({ url: url.toString(), headers: { accept: 'text/html' } })
  if (response.status === 404 || response.status === 410) return null
  expectOk(response)
  return response.text
}

export const icims: Adapter<IcimsRaw> = {
  source: 'icims',
  listHasDescriptions: false,
  allowedHosts: (board) => [host(board)],

  async discoverPage({ board, cursor }, http) {
    const portal = host(board)
    const pending = cursor ? cursor.split(' ') : ['/sitemap.xml']
    const [path, ...rest] = pending
    const response = await http.request({
      url: `https://${portal}${path}`,
      headers: { accept: 'application/xml, text/xml' },
    })
    expectOk(response)
    const { postings, children } = readSitemap(response.text, portal)
    const next = [...rest, ...children]
    return { items: postings, nextCursor: next.length ? next.join(' ') : null }
  },

  normalize(raw, board): SourcedJob {
    return {
      sourceId: raw.id,
      tenant: board.token,
      source: 'icims',
      company: board.company,
      title: raw.slugTitle,
      location: null,
      workplaceType: null,
      description: null,
      url: raw.url,
      postedAt: raw.lastmod,
    }
  },

  async hydrate(job, _board, http) {
    const html = await readPage(http, job)
    if (html === null) return null
    const node = findJobPostings(html)[0]
    const posting = node ? readLdPosting(node) : null
    if (!posting) return job
    return {
      ...job,
      title: posting.title,
      location: posting.location,
      workplaceType: posting.workplaceType,
      description: posting.description,
      employmentType: posting.employmentType === 'OTHER' ? null : posting.employmentType,
      postedAt: posting.postedAt ?? job.postedAt ?? null,
      company: str(job.company) ?? posting.company ?? job.company,
    }
  },
}
