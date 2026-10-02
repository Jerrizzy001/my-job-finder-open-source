import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Politeness } from '@jobfinder/sources'
import { llmConfigFromEnv, markdownToHtml, openAiCompatible, type Llm } from '@jobfinder/tailor'
import { listAnswers, saveAnswers, seedAnswers, type FormQuestion, type VaultAnswer } from './answers.ts'
import { getSetting, LOCAL_USER, setSetting, type Db } from './db.ts'
import { discover, syncBoards, type DiscoverSummary } from './discover.ts'
import { tailorJob } from './drafts.ts'
import { matchJobs, type JobRow } from './match.ts'
import { draftFile, markSubmitted, prepareApplication } from './prepare.ts'
import { boardStatus, listJobs, recentRuns, setStage, type Stage } from './queries.ts'
import {
  masterResumePath,
  readCatalog,
  readMasterResume,
  readPreferences,
  readProfile,
  writePreferences,
  writeProfile,
  type Workspace,
} from './workspace.ts'

/**
 * The local API and UI, on 127.0.0.1 only.
 *
 * Any web page you visit can try to call localhost, so:
 * - the Host header must be this server (stops DNS rebinding);
 * - a request that changes anything must be JSON from this server's own
 *   origin (stops cross-site form posts), or carry the extension token;
 * - extension routes (`/api/ext/*`) need the extension token, always;
 * - no CORS headers are ever sent.
 */

export type AppOptions = {
  db: Db
  ws: Workspace
  port: number
  webDir?: string
  llm?: Llm | null
  /** Run the board scheduler every minute. */
  schedule?: boolean
  log?: (line: string) => void
}

export type App = { server: Server; token: string; url: string; close(): Promise<void> }

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_BODY = 1024 * 1024

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.')
    chunks.push(chunk as Buffer)
  }
  if (!size) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Body is not a JSON object.')
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

export function getOrCreateToken(db: Db): string {
  const existing = getSetting(db, 'extension_token')
  if (existing) return existing
  const token = randomBytes(24).toString('base64url')
  setSetting(db, 'extension_token', token)
  return token
}

function tokensEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function jobIdFrom(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad job id.')
  return id
}

/** The stored job for an Ashby application page URL, `jobs.ashbyhq.com/<org>/<id>/application`. */
export function findJobByApplyUrl(db: Db, pageUrl: string): JobRow | null {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  const match = /^\/([^/]+)\/([0-9a-f-]{36})(?:\/application)?\/?$/i.exec(url.pathname)
  if (url.hostname !== 'jobs.ashbyhq.com' || !match) return null
  const alias = db
    .prepare("SELECT job_id FROM job_aliases WHERE source = 'ashby' AND lower(tenant) = lower(?) AND source_id = ?")
    .get(decodeURIComponent(match[1]!), match[2]!.toLowerCase()) as { job_id: number } | undefined
  return alias ? ((db.prepare('SELECT * FROM jobs WHERE id = ?').get(alias.job_id) as JobRow) ?? null) : null
}

export function createApp(options: AppOptions): App {
  const { db, ws } = options
  const token = getOrCreateToken(db)
  const llm =
    options.llm === undefined ? (llmConfigFromEnv() ? openAiCompatible(llmConfigFromEnv()!) : null) : options.llm
  const origin = `http://127.0.0.1:${options.port}`
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const allowedOrigins = new Set([origin, `http://localhost:${options.port}`])
  const politeness = new Politeness()
  const discovery = {
    running: false,
    startedAt: null as string | null,
    finishedAt: null as string | null,
    log: [] as string[],
    summary: null as DiscoverSummary | null,
    error: null as string | null,
  }
  seedAnswers(db, ws)

  // Re-scores run one after another, so a request never reads half-written
  // matches. Each run re-reads the preferences and skips matches already current.
  let queue: Promise<unknown> = Promise.resolve()
  function rescore() {
    const run = queue.then(() => matchJobs(db, readPreferences(ws), { profileSkills: readProfile(ws)?.skills ?? [] }))
    queue = run.catch(() => undefined)
    return run
  }

  async function runDiscovery(all: boolean) {
    if (discovery.running) return
    Object.assign(discovery, {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      log: [],
      summary: null,
      error: null,
    })
    try {
      const prefs = readPreferences(ws)
      syncBoards(db, readCatalog(ws))
      discovery.summary = await discover(db, prefs, { all, politeness, log: (line) => discovery.log.push(line) })
      await rescore()
    } catch (error) {
      discovery.error = (error as Error).message
    } finally {
      discovery.running = false
      discovery.finishedAt = new Date().toISOString()
    }
  }

  function requireExtension(req: IncomingMessage) {
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!given || !tokensEqual(given, token))
      throw new HttpError(401, 'Paste the token "jobfinder serve" printed into the extension.')
  }

  type Handler = (req: IncomingMessage, params: string[], url: URL, res: ServerResponse) => Promise<unknown>
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/health$/, async () => ({ ok: true, llm: llm?.model ?? null })],
    [
      'GET',
      /^\/api\/jobs$/,
      async (_req, _params, url) => {
        await rescore()
        const stage = (url.searchParams.get('stage') ?? 'for_you') as Stage | 'all'
        return { jobs: listJobs(db, { stage }) }
      },
    ],
    [
      'GET',
      /^\/api\/jobs\/(\d+)$/,
      async (_req, [id]) => {
        const jobId = jobIdFrom(id)
        const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
        if (!row) throw new HttpError(404, 'No such job.')
        await rescore()
        const listed = listJobs(db, { stage: 'all', jobId })[0] ?? null
        const resume = draftFile(db, jobId, 'resume.md')
        const cover = draftFile(db, jobId, 'cover-letter.md')
        const manifestRow = db
          .prepare('SELECT verified, problems_json, llm_used FROM drafts WHERE user_id = ? AND job_id = ?')
          .get(LOCAL_USER, jobId) as { verified: number; problems_json: string; llm_used: number } | undefined
        return {
          job: { ...row, match: listed },
          draft:
            resume && cover
              ? {
                  resumeHtml: markdownToHtml(readFileSync(resume.path, 'utf8')),
                  coverLetterHtml: markdownToHtml(readFileSync(cover.path, 'utf8')),
                  verified: manifestRow?.verified === 1,
                  llmUsed: manifestRow?.llm_used === 1,
                  problems: JSON.parse(manifestRow?.problems_json ?? '[]') as string[],
                }
              : null,
        }
      },
    ],
    [
      'POST',
      /^\/api\/jobs\/(\d+)\/dismiss$/,
      async (_req, [id]) => {
        const jobId = jobIdFrom(id)
        const row = db.prepare('SELECT title FROM jobs WHERE id = ?').get(jobId) as { title: string } | undefined
        if (!row) throw new HttpError(404, 'No such job.')
        setStage(db, jobId, 'dismissed')
        const prefs = readPreferences(ws)
        if (!(prefs.rejectedTitles ?? []).includes(row.title))
          writePreferences(ws, { ...prefs, rejectedTitles: [...(prefs.rejectedTitles ?? []), row.title] })
        await rescore()
        return { ok: true }
      },
    ],
    [
      'POST',
      /^\/api\/jobs\/(\d+)\/restore$/,
      async (_req, [id]) => {
        const jobId = jobIdFrom(id)
        const row = db.prepare('SELECT title FROM jobs WHERE id = ?').get(jobId) as { title: string } | undefined
        if (!row) throw new HttpError(404, 'No such job.')
        setStage(db, jobId, 'new')
        const prefs = readPreferences(ws)
        writePreferences(ws, {
          ...prefs,
          rejectedTitles: (prefs.rejectedTitles ?? []).filter((title) => title !== row.title),
        })
        await rescore()
        return { ok: true }
      },
    ],
    [
      'POST',
      /^\/api\/jobs\/(\d+)\/tailor$/,
      async (_req, [id]) => (await tailorJob(db, ws, jobIdFrom(id), llm)).manifest,
    ],
    [
      'POST',
      /^\/api\/jobs\/(\d+)\/prepare$/,
      async (req, [id]) => {
        const body = await readJson(req)
        return prepareApplication(db, ws, jobIdFrom(id), {
          questions: (body.questions as FormQuestion[] | undefined) ?? [],
          llm,
        })
      },
    ],
    [
      'POST',
      /^\/api\/jobs\/(\d+)\/applied$/,
      async (req, [id]) => {
        const body = await readJson(req)
        markSubmitted(db, jobIdFrom(id), typeof body.note === 'string' ? body.note : null)
        return { ok: true }
      },
    ],
    [
      'GET',
      /^\/api\/jobs\/(\d+)\/files\/([a-z-]+\.(?:pdf|md))$/,
      async (_req, [id, name], _url, res) => {
        const file = draftFile(db, jobIdFrom(id), name!)
        if (!file) throw new HttpError(404, 'No such draft file.')
        res.writeHead(200, {
          'content-type': file.type,
          'content-disposition': `inline; filename="${name}"`,
          'cache-control': 'no-store',
        })
        createReadStream(file.path).pipe(res)
        return undefined
      },
    ],
    [
      'POST',
      /^\/api\/discover\/run$/,
      async (req) => {
        const body = await readJson(req)
        void runDiscovery(body.all === true)
        return { started: true }
      },
    ],
    ['GET', /^\/api\/discover\/status$/, async () => discovery],
    ['GET', /^\/api\/preferences$/, async () => readPreferences(ws)],
    [
      'POST',
      /^\/api\/preferences$/,
      async (req) => {
        const prefs = writePreferences(ws, await readJson(req))
        const summary = await rescore()
        return { preferences: prefs, rescored: summary.scored }
      },
    ],
    [
      'GET',
      /^\/api\/profile$/,
      async () => {
        const profile = readProfile(ws)
        return {
          profile,
          masterResumePath: masterResumePath(ws, profile),
          masterResumeFound: readMasterResume(ws, profile) !== null,
        }
      },
    ],
    ['POST', /^\/api\/profile$/, async (req) => ({ profile: writeProfile(ws, await readJson(req)) })],
    ['GET', /^\/api\/answers$/, async () => ({ answers: listAnswers(db) })],
    [
      'POST',
      /^\/api\/answers$/,
      async (req) => {
        const body = await readJson(req)
        if (!Array.isArray(body.answers)) throw new HttpError(400, '"answers" must be a list.')
        return { answers: saveAnswers(db, body.answers as VaultAnswer[]) }
      },
    ],
    ['GET', /^\/api\/runs$/, async () => ({ runs: recentRuns(db), boards: boardStatus(db) })],
    // Extension routes: token required.
    [
      'POST',
      /^\/api\/ext\/package$/,
      async (req) => {
        requireExtension(req)
        const body = await readJson(req)
        const job = typeof body.pageUrl === 'string' ? findJobByApplyUrl(db, body.pageUrl) : null
        if (!job)
          throw new HttpError(
            404,
            'This posting is not in your local matches. Run discovery, or open it in the UI first.',
          )
        return prepareApplication(db, ws, job.id, {
          questions: (body.questions as FormQuestion[] | undefined) ?? [],
          llm,
        })
      },
    ],
    [
      'GET',
      /^\/api\/ext\/files\/(\d+)\/(resume\.pdf|cover-letter\.pdf)$/,
      async (req, [id, name], _url, res) => {
        requireExtension(req)
        const file = draftFile(db, jobIdFrom(id), name!)
        if (!file) throw new HttpError(404, 'No such draft file.')
        res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' })
        createReadStream(file.path).pipe(res)
        return undefined
      },
    ],
    [
      'POST',
      /^\/api\/ext\/submitted$/,
      async (req) => {
        requireExtension(req)
        const body = await readJson(req)
        markSubmitted(
          db,
          jobIdFrom(String(body.jobId)),
          typeof body.note === 'string' ? body.note : 'Confirmed in the extension',
        )
        return { ok: true }
      },
    ],
  ]

  function serveStatic(pathname: string, res: ServerResponse): boolean {
    const webDir = options.webDir
    if (!webDir || !existsSync(webDir)) return false
    const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
    let file = join(webDir, clean)
    if (!file.startsWith(webDir + sep) && file !== webDir) return false
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, 'index.html')
    if (!existsSync(file)) return false
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      // Hashed assets never change; the page itself must always be re-read.
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-security-policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    })
    createReadStream(file).pipe(res)
    return true
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? '')) throw new HttpError(421, 'Wrong host.')
      const url = new URL(req.url ?? '/', origin)
      const method = req.method ?? 'GET'
      const isExtension = url.pathname.startsWith('/api/ext/')
      if (method !== 'GET' && method !== 'HEAD' && !isExtension) {
        const requestOrigin = req.headers.origin
        if (requestOrigin && !allowedOrigins.has(requestOrigin))
          throw new HttpError(403, 'Cross-origin request refused.')
        if (!requestOrigin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
          throw new HttpError(403, 'Cross-site request refused.')
      }
      if (url.pathname.startsWith('/api/')) {
        for (const [routeMethod, pattern, handler] of routes) {
          const match = pattern.exec(url.pathname)
          if (!match || routeMethod !== method) continue
          const result = await handler(req, match.slice(1), url, res)
          if (result !== undefined) send(res, 200, result)
          return
        }
        throw new HttpError(404, 'No such route.')
      }
      if (method === 'GET' && serveStatic(url.pathname, res)) return
      send(res, 404, { error: 'The UI is not built. Run "npm run build:web".' })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (!res.headersSent) send(res, status, { error: (error as Error).message })
      else res.end()
      if (status === 500) options.log?.(`error: ${(error as Error).stack ?? error}`)
    }
  })

  let timer: ReturnType<typeof setInterval> | null = null
  if (options.schedule) {
    timer = setInterval(() => void runDiscovery(false), 60_000)
    timer.unref()
  }

  return {
    server,
    token,
    url: origin,
    close: () =>
      new Promise((resolve) => {
        if (timer) clearInterval(timer)
        server.close(() => resolve())
      }),
  }
}

export function listen(app: App, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(port, '127.0.0.1', () => resolve())
  })
}
