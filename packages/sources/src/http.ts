import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type Robots } from './robots.ts'

/**
 * Polite, bounded HTTP. Every adapter request goes through here, so no
 * adapter can misbehave:
 *
 * - an honest User-Agent with a contact URL, never a browser's;
 * - https only, and only to the hosts the board allows;
 * - robots.txt fetched once per host and honoured;
 * - at least one second between requests to the same host;
 * - a request budget and a byte budget per run;
 * - 429 or 503 stops the run and backs the host off (Retry-After, or 10
 *   minutes); nothing is retried in a loop;
 * - redirects followed only to allowed hosts, at most three.
 */

export const PRODUCT_TOKEN = 'jobfinder-oss'
export const USER_AGENT = `${PRODUCT_TOKEN}/0.1 (+https://github.com/Jerrizzy001/my-job-finder-open-source; personal job search, run locally)`

export type Limits = {
  maxRequests: number
  maxBytesPerResponse: number
  maxTotalBytes: number
  minDelayMs: number
  timeoutMs: number
}

export const DEFAULT_LIMITS: Limits = {
  maxRequests: 60,
  maxBytesPerResponse: 24 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  minDelayMs: 1000,
  timeoutMs: 20_000,
}

export type SourceErrorCode =
  | 'rate_limited'
  | 'blocked_by_robots'
  | 'budget_exhausted'
  | 'host_not_allowed'
  | 'source_not_found'
  | 'gone'
  | 'source_error'

export class SourceError extends Error {
  readonly code: SourceErrorCode
  readonly status: number | null
  constructor(code: SourceErrorCode, message: string, status: number | null = null) {
    super(message)
    this.code = code
    this.status = status
  }
}

export type HttpRequest = {
  url: string
  method?: 'GET' | 'POST'
  /** A JSON body (Workday, Dayforce). */
  json?: unknown
  /** The only extra headers an adapter may set: Dayforce's CSRF pair. */
  headers?: { cookie?: string; 'x-csrf-token'?: string; accept?: string }
}

export type HttpResponse = {
  status: number
  url: string
  text: string
  headers: Headers
  /** `name=value` pairs from Set-Cookie, attributes dropped. */
  cookies: string[]
}

export type Clock = { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Per-host state shared by every run in one process: when each host was last
 * called, its robots.txt, and any backoff it asked for.
 */
export class Politeness {
  readonly lastRequestAt = new Map<string, number>()
  readonly robots = new Map<string, Robots>()
  readonly backoffUntil = new Map<string, number>()
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern))
}

function retryAfterMs(headers: Headers, now: number): number {
  const value = headers.get('retry-after')
  const tenMinutes = 10 * 60 * 1000
  if (!value) return tenMinutes
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 60_000), 24 * 3600 * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(date - now, 60_000) : tenMinutes
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new SourceError('source_error', `Response is ${declared} bytes, over the ${maxBytes} limit.`)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new SourceError('source_error', `Response exceeded the ${maxBytes}-byte limit.`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export type BoundedHttpOptions = {
  allowedHosts: readonly string[]
  limits?: Partial<Limits>
  politeness?: Politeness
  fetch?: typeof fetch
  clock?: Clock
}

export class BoundedHttp {
  readonly limits: Limits
  requests = 0
  bytes = 0
  private readonly allowedHosts: readonly string[]
  private readonly politeness: Politeness
  private readonly fetchImpl: typeof fetch
  private readonly clock: Clock

  constructor(options: BoundedHttpOptions) {
    this.allowedHosts = options.allowedHosts
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.politeness = options.politeness ?? new Politeness()
    this.fetchImpl = options.fetch ?? fetch
    this.clock = options.clock ?? realClock
  }

  get remainingRequests(): number {
    return this.limits.maxRequests - this.requests
  }

  /** The Content-Signal settings of a host's robots.txt, once it was read. */
  contentSignals(host: string): Record<string, string> {
    return this.politeness.robots.get(host)?.contentSignals ?? {}
  }

  private checkUrl(raw: string): URL {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new SourceError('host_not_allowed', `Not a URL: ${raw}`)
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      throw new SourceError('host_not_allowed', `Only plain https URLs are allowed: ${url.origin}`)
    if (!hostAllowed(url.hostname, this.allowedHosts))
      throw new SourceError('host_not_allowed', `${url.hostname} is not an allowed host for this board.`)
    return url
  }

  private async waitTurn(host: string): Promise<void> {
    const last = this.politeness.lastRequestAt.get(host)
    if (last !== undefined) {
      const wait = last + this.limits.minDelayMs - this.clock.now()
      if (wait > 0) await this.clock.sleep(wait)
    }
    this.politeness.lastRequestAt.set(host, this.clock.now())
  }

  private async send(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal })
    } catch (error) {
      throw new SourceError('source_error', `Request to ${url.hostname} failed: ${(error as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async robotsFor(url: URL): Promise<Robots> {
    const cached = this.politeness.robots.get(url.hostname)
    if (cached) return cached
    await this.waitTurn(url.hostname)
    let robots: Robots
    try {
      const response = await this.send(new URL('/robots.txt', url.origin), { headers: { 'user-agent': USER_AGENT } })
      if (response.status >= 200 && response.status < 300)
        robots = parseRobots(await readBounded(response, 512 * 1024), PRODUCT_TOKEN)
      else if (response.status >= 300 && response.status < 500) robots = ALLOW_ALL
      else robots = DISALLOW_ALL
    } catch {
      robots = DISALLOW_ALL
    }
    this.politeness.robots.set(url.hostname, robots)
    return robots
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    let url = this.checkUrl(request.url)
    for (let hop = 0; hop <= 3; hop++) {
      if (this.requests >= this.limits.maxRequests)
        throw new SourceError('budget_exhausted', `Request budget of ${this.limits.maxRequests} used up.`)
      const backoff = this.politeness.backoffUntil.get(url.hostname)
      if (backoff && backoff > this.clock.now())
        throw new SourceError(
          'rate_limited',
          `${url.hostname} asked us to back off until ${new Date(backoff).toISOString()}.`,
        )

      const robots = await this.robotsFor(url)
      if (!robots.isAllowed(url.pathname + url.search))
        throw new SourceError('blocked_by_robots', `robots.txt on ${url.hostname} disallows ${url.pathname}.`)

      await this.waitTurn(url.hostname)
      this.requests++
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: request.headers?.accept ?? 'application/json, text/html;q=0.9, */*;q=0.5',
      }
      if (request.headers?.cookie) headers.cookie = request.headers.cookie
      if (request.headers?.['x-csrf-token']) headers['x-csrf-token'] = request.headers['x-csrf-token']
      for (const value of Object.values(headers))
        if (/[\r\n]/.test(value)) throw new SourceError('source_error', 'Header values may not contain line breaks.')
      if (request.json !== undefined) headers['content-type'] = 'application/json'

      const response = await this.send(url, {
        method: request.method ?? 'GET',
        headers,
        body: request.json === undefined ? undefined : JSON.stringify(request.json),
      })

      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = this.checkUrl(new URL(response.headers.get('location')!, url).toString())
        continue
      }
      if (response.status === 429 || response.status === 503) {
        this.politeness.backoffUntil.set(
          url.hostname,
          this.clock.now() + retryAfterMs(response.headers, this.clock.now()),
        )
        throw new SourceError('rate_limited', `${url.hostname} answered ${response.status}.`, response.status)
      }

      const remaining = Math.min(this.limits.maxBytesPerResponse, this.limits.maxTotalBytes - this.bytes)
      if (remaining <= 0) throw new SourceError('budget_exhausted', 'Byte budget used up.')
      const text = await readBounded(response, remaining)
      this.bytes += Buffer.byteLength(text)
      const cookies = (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(';')[0]!.trim())
      return { status: response.status, url: url.toString(), text, headers: response.headers, cookies }
    }
    throw new SourceError('source_error', 'Too many redirects.')
  }

  /** GET and parse JSON, mapping 404 and 410 to their own codes. */
  async json<T = unknown>(request: HttpRequest): Promise<T> {
    const response = await this.request(request)
    expectOk(response)
    try {
      return JSON.parse(response.text) as T
    } catch {
      throw new SourceError('source_error', `${new URL(response.url).hostname} did not answer JSON.`)
    }
  }
}

export function expectOk(response: HttpResponse): void {
  if (response.status === 404) throw new SourceError('source_not_found', `Not found: ${response.url}`, 404)
  if (response.status === 410) throw new SourceError('gone', `Gone: ${response.url}`, 410)
  if (response.status < 200 || response.status >= 300)
    throw new SourceError('source_error', `${response.url} answered ${response.status}.`, response.status)
}
