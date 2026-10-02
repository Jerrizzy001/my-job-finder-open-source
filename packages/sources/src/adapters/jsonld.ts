import { decodeEntities, str } from '../html.ts'
import { expectOk, SourceError } from '../http.ts'
import { findJobPostings, readLdPosting } from '../jsonld.ts'
import type { Adapter, Board, SourcedJob } from '../types.ts'

/**
 * An employer's own careers page, read through schema.org JobPosting JSON-LD.
 *
 * `url` is the careers page. If it carries JobPosting data itself, those
 * postings are the list. Otherwise its links to job pages on the same host
 * are the list (titles from the link text), and each selected posting's page
 * is read for its JobPosting. `linkPattern`, a regular expression, picks the
 * job links when the default (`/job`, `/jobs/`, `/careers/`, `/positions/`,
 * `/openings/`) does not fit.
 */

export type LdRaw = { url: string; title: string; posting: ReturnType<typeof readLdPosting> }

const DEFAULT_LINKS = /\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies))\/[^?#]*[a-z0-9]/i
const MAX_LINKS = 300

function listing(board: Board): URL {
  let url: URL
  try {
    url = new URL(board.url ?? '')
  } catch {
    throw new SourceError('source_error', 'A JSON-LD board needs url: the careers page.')
  }
  if (url.protocol !== 'https:') throw new SourceError('source_error', 'The careers page must be https.')
  return url
}

function idFor(url: string, identifier: string | null): string {
  if (identifier) return identifier.slice(0, 200)
  const parsed = new URL(url)
  return (parsed.pathname + parsed.search).slice(0, 300)
}

export function jobLinks(html: string, page: URL, pattern: RegExp): { url: string; title: string }[] {
  const links = new Map<string, string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(match[1]!), page)
    } catch {
      continue
    }
    url.hash = ''
    if (url.hostname !== page.hostname || url.protocol !== 'https:' || url.toString() === page.toString()) continue
    if (!pattern.test(url.pathname + url.search)) continue
    const title = decodeEntities(match[2]!.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (title.length < 3 || title.length > 200 || links.has(url.toString())) continue
    links.set(url.toString(), title)
    if (links.size >= MAX_LINKS) break
  }
  return [...links].map(([url, title]) => ({ url, title }))
}

export const jsonld: Adapter<LdRaw> = {
  source: 'jsonld',
  listHasDescriptions: false,
  allowedHosts: (board) => [listing(board).hostname],

  async discoverPage({ board }, http) {
    const page = listing(board)
    const response = await http.request({ url: page.toString(), headers: { accept: 'text/html' } })
    expectOk(response)
    const postings = findJobPostings(response.text)
      .map(readLdPosting)
      .filter((posting) => posting !== null)
    if (postings.length)
      return {
        items: postings.map((posting) => ({ url: posting.url ?? page.toString(), title: posting.title, posting })),
        nextCursor: null,
      }
    const pattern = board.linkPattern ? new RegExp(board.linkPattern, 'i') : DEFAULT_LINKS
    return {
      items: jobLinks(response.text, page, pattern).map((link) => ({ ...link, posting: null })),
      nextCursor: null,
    }
  },

  normalize(raw, board): SourcedJob | null {
    const title = str(raw.title)
    if (!title) return null
    const posting = raw.posting
    return {
      sourceId: idFor(raw.url, posting?.identifier ?? null),
      tenant: board.token,
      source: 'jsonld',
      company: board.company,
      title,
      location: posting?.location ?? null,
      workplaceType: posting?.workplaceType ?? null,
      description: posting?.description ?? null,
      url: raw.url,
      employmentType: posting?.employmentType ?? null,
      postedAt: posting?.postedAt ?? null,
    }
  },

  async hydrate(job, _board, http) {
    const response = await http.request({ url: job.url, headers: { accept: 'text/html' } })
    if (response.status === 404 || response.status === 410) return null
    expectOk(response)
    const node = findJobPostings(response.text)[0]
    const posting = node ? readLdPosting(node) : null
    if (!posting) return job
    return {
      ...job,
      title: posting.title,
      location: posting.location,
      workplaceType: posting.workplaceType,
      description: posting.description,
      employmentType: posting.employmentType,
      postedAt: posting.postedAt,
    }
  },
}
