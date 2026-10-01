import { htmlToText, isoDate, isRecord, str } from '../html.ts'
import type { Adapter, SourcedJob } from '../types.ts'

/**
 * Greenhouse job boards: one public JSON list per board, descriptions
 * included with `content=true`.
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 */

type Raw = Record<string, unknown>

export const greenhouse: Adapter<Raw> = {
  source: 'greenhouse',
  listHasDescriptions: true,
  allowedHosts: () => ['boards-api.greenhouse.io'],

  async discoverPage({ board }, http) {
    const body = await http.json<{ jobs?: unknown }>({
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`,
    })
    return { items: Array.isArray(body.jobs) ? body.jobs.filter(isRecord) : [], nextCursor: null }
  },

  normalize(raw, board): SourcedJob | null {
    const id = str(raw.id)
    const title = str(raw.title)
    const url = str(raw.absolute_url, 2000)
    if (!id || !title || !url) return null
    const location = isRecord(raw.location) ? str(raw.location.name) : null
    return {
      sourceId: id,
      tenant: board.token,
      source: 'greenhouse',
      company: board.company,
      title,
      location,
      workplaceType: null,
      description: htmlToText(typeof raw.content === 'string' ? raw.content : null),
      url,
      postedAt: isoDate(raw.first_published ?? raw.updated_at),
    }
  },
}
