import type { WorkMode } from '@jobfinder/core'
import { htmlToText, isoDate, isRecord, joinPlaces, str } from '../html.ts'
import type { Adapter, SourcedJob } from '../types.ts'

/**
 * Workable: the public jobs widget, descriptions included with `details=true`.
 *
 *   GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
 */

type Raw = Record<string, unknown>

function places(raw: Raw): string | null {
  const listed = Array.isArray(raw.locations)
    ? raw.locations
        .filter(isRecord)
        .map((place) => [str(place.city), str(place.region), str(place.country)].filter(Boolean).join(', '))
    : []
  const primary = [str(raw.city), str(raw.state), str(raw.country)].filter(Boolean).join(', ')
  return joinPlaces([primary, ...listed, raw.telecommuting === true ? 'Remote' : null])
}

export const workable: Adapter<Raw> = {
  source: 'workable',
  listHasDescriptions: true,
  allowedHosts: () => ['apply.workable.com'],

  async discoverPage({ board }, http) {
    const body = await http.json<{ jobs?: unknown }>({
      url: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board.token)}?details=true`,
    })
    return { items: Array.isArray(body.jobs) ? body.jobs.filter(isRecord) : [], nextCursor: null }
  },

  normalize(raw, board): SourcedJob | null {
    const id = str(raw.shortcode)
    const title = str(raw.title)
    if (!id || !title) return null
    const mode: WorkMode | null = raw.telecommuting === true ? 'remote' : null
    return {
      sourceId: id,
      tenant: board.token,
      source: 'workable',
      company: board.company,
      title,
      location: places(raw),
      workplaceType: mode,
      description: htmlToText(typeof raw.description === 'string' ? raw.description : null),
      url:
        str(raw.url, 2000) ??
        `https://apply.workable.com/${encodeURIComponent(board.token)}/j/${encodeURIComponent(id)}/`,
      employmentType: str(raw.employment_type),
      postedAt: isoDate(raw.published_on ?? raw.created_at),
    }
  },
}
