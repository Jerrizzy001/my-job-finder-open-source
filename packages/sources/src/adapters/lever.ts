import type { WorkMode } from '@jobfinder/core'
import { htmlToText, isoDate, isRecord, joinPlaces, plain, str } from '../html.ts'
import type { Adapter, Board, SourcedJob } from '../types.ts'

/**
 * Lever postings: a public JSON list, paged with `skip` and `limit`.
 *
 *   GET https://api.lever.co/v0/postings/{company}?mode=json&skip=0&limit=100
 *
 * EU-hosted boards live on `api.eu.lever.co`; set `host: api.eu.lever.co`.
 */

type Raw = Record<string, unknown>
const PAGE = 100

function host(board: Board): string {
  return board.host === 'api.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co'
}

function workMode(value: unknown): WorkMode | null {
  if (value === 'remote') return 'remote'
  if (value === 'hybrid') return 'hybrid'
  if (value === 'on-site' || value === 'onsite') return 'onsite'
  return null
}

function description(raw: Raw): string | null {
  const parts: string[] = []
  const intro = plain(raw.descriptionPlain) ?? htmlToText(typeof raw.description === 'string' ? raw.description : null)
  if (intro) parts.push(intro)
  if (Array.isArray(raw.lists))
    for (const list of raw.lists.filter(isRecord)) {
      const heading = str(list.text)
      const body = htmlToText(typeof list.content === 'string' ? `<ul>${list.content}</ul>` : null)
      if (body) parts.push(heading ? `${heading}\n${body}` : body)
    }
  const extra = plain(raw.additionalPlain, 20_000)
  if (extra) parts.push(extra)
  return parts.length ? parts.join('\n\n') : null
}

export const lever: Adapter<Raw> = {
  source: 'lever',
  listHasDescriptions: true,
  allowedHosts: (board) => [host(board)],

  async discoverPage({ board, cursor }, http) {
    const skip = Number(cursor ?? 0)
    const items = await http.json<unknown>({
      url: `https://${host(board)}/v0/postings/${encodeURIComponent(board.token)}?mode=json&skip=${skip}&limit=${PAGE}`,
    })
    const page = Array.isArray(items) ? items.filter(isRecord) : []
    return { items: page, nextCursor: page.length === PAGE ? String(skip + PAGE) : null }
  },

  normalize(raw, board): SourcedJob | null {
    const id = str(raw.id)
    const title = str(raw.text)
    const url = str(raw.hostedUrl, 2000)
    if (!id || !title || !url) return null
    const categories = isRecord(raw.categories) ? raw.categories : {}
    const all = Array.isArray(categories.allLocations) ? categories.allLocations.map((place) => str(place)) : []
    return {
      sourceId: id,
      tenant: board.token,
      source: 'lever',
      company: board.company,
      title,
      location: joinPlaces([str(categories.location), ...all]),
      workplaceType: workMode(raw.workplaceType),
      description: description(raw),
      url,
      employmentType: str(categories.commitment),
      postedAt: isoDate(raw.createdAt),
    }
  },
}
