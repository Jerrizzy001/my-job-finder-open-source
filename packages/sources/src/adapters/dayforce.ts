import { htmlToText, isoDate, isRecord, joinPlaces, str } from '../html.ts'
import { expectOk, SourceError, type BoundedHttp } from '../http.ts'
import type { Adapter, Board, SourcedJob } from '../types.ts'

/**
 * Dayforce job boards, `https://jobs.dayforcehcm.com/en-US/<namespace>/<BOARD>`.
 *
 * The board page is a web app whose search is a public JSON endpoint:
 *   1. GET  /api/auth/csrf  answers `{ csrfToken }` and sets a CSRF cookie;
 *   2. POST /api/geo/<namespace>/jobposting/search with that token in
 *      `x-csrf-token` and the cookie, one page per `paginationStart`.
 *
 * To be plain about it: that is a CSRF token on a public endpoint, the same
 * one any visitor's browser fetches, not a login and not an auth bypass. No
 * account, no session, nothing hidden. A board that answers a bot challenge
 * fails with the usual error; nothing tries to get around it.
 */

type Raw = Record<string, unknown>
const HOST = 'jobs.dayforcehcm.com'
const sessions = new WeakMap<BoundedHttp, { token: string; cookie: string }>()

function namespaceOf(board: Board): { ns: string; code: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(board.token))
    throw new SourceError('source_error', `"${board.token}" is not a Dayforce namespace.`)
  const code = board.site ?? 'CANDIDATEPORTAL'
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code))
    throw new SourceError('source_error', `"${code}" is not a Dayforce job board code.`)
  return { ns: board.token, code }
}

async function csrf(http: BoundedHttp): Promise<{ token: string; cookie: string }> {
  const existing = sessions.get(http)
  if (existing) return existing
  const response = await http.request({ url: `https://${HOST}/api/auth/csrf` })
  expectOk(response)
  let token: unknown
  try {
    token = (JSON.parse(response.text) as { csrfToken?: unknown }).csrfToken
  } catch {
    token = null
  }
  const cookie = response.cookies.find((pair) => /csrf-token=/.test(pair))
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token) || !cookie)
    throw new SourceError('source_error', 'Dayforce did not hand out its public CSRF token.')
  const session = { token, cookie }
  sessions.set(http, session)
  return session
}

export const dayforce: Adapter<Raw> = {
  source: 'dayforce',
  listHasDescriptions: true,
  allowedHosts: () => [HOST],

  async discoverPage({ board, cursor }, http) {
    const { ns, code } = namespaceOf(board)
    const start = Number(cursor ?? 0)
    const session = await csrf(http)
    const body = await http.json<{ jobPostings?: unknown; maxCount?: unknown; offset?: unknown }>({
      url: `https://${HOST}/api/geo/${encodeURIComponent(ns)}/jobposting/search`,
      method: 'POST',
      headers: { cookie: session.cookie, 'x-csrf-token': session.token },
      json: { clientNamespace: ns, jobBoardCode: code, cultureCode: 'en-US', distanceUnit: 0, paginationStart: start },
    })
    const postings = Array.isArray(body.jobPostings) ? body.jobPostings.filter(isRecord) : []
    const total = Number(body.maxCount ?? 0)
    const end = start + postings.length
    return { items: postings, nextCursor: postings.length && end < total ? String(end) : null }
  },

  normalize(raw, board): SourcedJob | null {
    const { ns, code } = namespaceOf(board)
    const id = str(raw.jobPostingId)
    const title = str(raw.jobTitle)
    if (!id || !title) return null
    const places = Array.isArray(raw.postingLocations)
      ? raw.postingLocations
          .filter(isRecord)
          .map((place) =>
            [str(place.cityName), str(place.stateCode), str(place.isoCountryCode)].filter(Boolean).join(', '),
          )
      : []
    const location = joinPlaces(places)
    const remote = raw.hasVirtualLocation === true
    return {
      sourceId: id,
      tenant: board.token,
      source: 'dayforce',
      company: board.company,
      title,
      location: remote ? joinPlaces([location, 'Remote']) : location,
      workplaceType: remote && !location ? 'remote' : null,
      description: htmlToText(typeof raw.jobDescription === 'string' ? raw.jobDescription : null),
      url: `https://${HOST}/en-US/${ns}/${code}/jobs/${id}`,
      postedAt: isoDate(raw.postingStartTimestampUTC),
    }
  },
}
