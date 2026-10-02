import { htmlToText, isoDate, isRecord, joinPlaces, str } from '../html.ts'
import type { Adapter, SourcedJob } from '../types.ts'

/**
 * SmartRecruiters: the public Posting API. The list has no descriptions, so
 * selected postings are read in detail (list-first).
 *
 *   GET https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=N
 *   GET https://api.smartrecruiters.com/v1/companies/{id}/postings/{postingId}
 *
 * Note: as of 2026-10 the API host's robots.txt allows only LinkedInBot, so
 * the runner refuses these reads and the board reports `blocked_by_robots`.
 * The adapter is kept so it works the day that changes; see docs/adapters.md.
 */

type Raw = Record<string, unknown>
const PAGE = 100

function location(raw: Raw): { text: string | null; remote: boolean } {
  const loc = isRecord(raw.location) ? raw.location : {}
  const remote = loc.remote === true
  const place =
    str(loc.fullLocation) ??
    joinPlaces([[str(loc.city), str(loc.region), str(loc.country)?.toUpperCase()].filter(Boolean).join(', ')])
  return { text: joinPlaces([place, remote ? 'Remote' : null]), remote }
}

export const smartrecruiters: Adapter<Raw> = {
  source: 'smartrecruiters',
  listHasDescriptions: false,
  allowedHosts: () => ['api.smartrecruiters.com'],

  async discoverPage({ board, cursor }, http) {
    const offset = Number(cursor ?? 0)
    const body = await http.json<{ content?: unknown; totalFound?: unknown }>({
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings?limit=${PAGE}&offset=${offset}`,
    })
    const items = Array.isArray(body.content) ? body.content.filter(isRecord) : []
    const total = Number(body.totalFound ?? 0)
    return { items, nextCursor: items.length === PAGE && offset + PAGE < total ? String(offset + PAGE) : null }
  },

  normalize(raw, board): SourcedJob | null {
    const id = str(raw.id)
    const title = str(raw.name)
    if (!id || !title) return null
    const place = location(raw)
    const sections = isRecord(raw.jobAd) && isRecord(raw.jobAd.sections) ? raw.jobAd.sections : null
    const description = sections
      ? ['jobDescription', 'qualifications', 'additionalInformation']
          .map((key) => (isRecord(sections[key]) ? htmlToText(String(sections[key].text ?? '')) : null))
          .filter(Boolean)
          .join('\n\n') || null
      : null
    const typeOfEmployment = isRecord(raw.typeOfEmployment) ? str(raw.typeOfEmployment.label) : null
    return {
      sourceId: id,
      tenant: board.token,
      source: 'smartrecruiters',
      company: board.company,
      title,
      location: place.text,
      workplaceType: place.remote ? 'remote' : null,
      description,
      url:
        str(raw.postingUrl, 2000) ??
        `https://jobs.smartrecruiters.com/${encodeURIComponent(board.token)}/${encodeURIComponent(id)}`,
      employmentType: typeOfEmployment,
      postedAt: isoDate(raw.releasedDate),
    }
  },

  async hydrate(job, board, http) {
    const detail = await http.json<Raw>({
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings/${encodeURIComponent(job.sourceId)}`,
    })
    return smartrecruiters.normalize(detail, board)
  },
}
