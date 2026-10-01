import type { WorkMode } from '@jobfinder/core'
import { htmlToText, isoDate, isRecord, joinPlaces, plain, str } from '../html.ts'
import type { Adapter, SourcedJob } from '../types.ts'

/**
 * Ashby job boards: the public posting API, one JSON list per org.
 *
 *   GET https://api.ashbyhq.com/posting-api/job-board/{org}
 *
 * Unlisted postings (`isListed: false`) are skipped.
 */

type Raw = Record<string, unknown>

function workMode(raw: Raw): WorkMode | null {
  const value = String(raw.workplaceType ?? '').toLowerCase()
  if (value === 'remote') return 'remote'
  if (value === 'hybrid') return 'hybrid'
  if (value === 'onsite' || value === 'on-site') return 'onsite'
  return raw.isRemote === true ? 'remote' : null
}

export const ashby: Adapter<Raw> = {
  source: 'ashby',
  listHasDescriptions: true,
  allowedHosts: () => ['api.ashbyhq.com'],

  async discoverPage({ board }, http) {
    const body = await http.json<{ jobs?: unknown }>({
      url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}`,
    })
    const jobs = Array.isArray(body.jobs) ? body.jobs.filter(isRecord) : []
    return { items: jobs.filter((job) => job.isListed !== false), nextCursor: null }
  },

  normalize(raw, board): SourcedJob | null {
    const id = str(raw.id)
    const title = str(raw.title)
    const url = str(raw.jobUrl, 2000)
    if (!id || !title || !url) return null
    const secondary = Array.isArray(raw.secondaryLocations)
      ? raw.secondaryLocations.filter(isRecord).map((place) => str(place.location))
      : []
    return {
      sourceId: id,
      tenant: board.token,
      source: 'ashby',
      company: board.company,
      title,
      location: joinPlaces([str(raw.location), ...secondary]),
      workplaceType: workMode(raw),
      description:
        plain(raw.descriptionPlain) ?? htmlToText(typeof raw.descriptionHtml === 'string' ? raw.descriptionHtml : null),
      url,
      employmentType: str(raw.employmentType),
      postedAt: isoDate(raw.publishedAt),
    }
  },
}
