import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createApp,
  listen,
  matchJobs,
  openDb,
  readPreferences,
  resolveWorkspace,
  syncBoards,
  upsertJobs,
  type App,
} from '../src/index.ts'

const examples = join(import.meta.dirname, '..', '..', '..', 'examples')
const root = mkdtempSync(join(tmpdir(), 'jobfinder-app-'))
for (const file of ['preferences.json', 'profile.json', 'master-resume.md', 'catalog.yaml', 'answers.json'])
  copyFileSync(join(examples, file), join(root, file))
const ws = resolveWorkspace(root)
const db = openDb(':memory:')
const PORT = 47_000 + Math.floor(Math.random() * 1000)
const ASHBY_ID = '11111111-2222-4333-8444-555555555555'
let app: App

function call(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path,
        headers: {
          host: `127.0.0.1:${PORT}`,
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, body: text.startsWith('{') ? JSON.parse(text) : { raw: text } })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

beforeAll(async () => {
  syncBoards(db, [{ company: 'Example', source: 'ashby', token: 'example' }])
  upsertJobs(db, [
    {
      sourceId: ASHBY_ID,
      tenant: 'example',
      source: 'ashby',
      company: 'Example',
      title: 'Backend Engineer',
      location: 'Toronto, ON',
      workplaceType: 'hybrid',
      description: 'Build Python and TypeScript services on AWS with PostgreSQL.',
      url: `https://jobs.ashbyhq.com/example/${ASHBY_ID}`,
    },
  ])
  await matchJobs(db, readPreferences(ws))
  app = createApp({ db, ws, port: PORT, llm: null })
  await listen(app, PORT)
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('local API safety', () => {
  it('refuses a request for another host (DNS rebinding)', async () => {
    const res = await call('GET', '/api/health', { headers: { host: `evil.example:${PORT}` } })
    expect(res.status).toBe(421)
  })

  it('refuses a cross-origin write', async () => {
    const res = await call('POST', '/api/preferences', {
      body: { roleTitles: ['x'] },
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  it('refuses a form-encoded write', async () => {
    const res = await call('POST', '/api/answers', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(415)
  })

  it('requires the token on extension routes', async () => {
    const res = await call('POST', '/api/ext/package', {
      body: { pageUrl: `https://jobs.ashbyhq.com/example/${ASHBY_ID}/application` },
    })
    expect(res.status).toBe(401)
  })

  it('sends no CORS headers', async () => {
    const res = await new Promise<Record<string, unknown>>((resolve) => {
      request(
        {
          host: '127.0.0.1',
          port: PORT,
          path: '/api/health',
          headers: { host: `127.0.0.1:${PORT}`, origin: 'https://evil.example' },
        },
        (r) => resolve(r.headers),
      ).end()
    })
    expect(res['access-control-allow-origin']).toBeUndefined()
  })
})

describe('jobs, drafts and the answer package', () => {
  it('lists the match with its reasons', async () => {
    const res = await call('GET', '/api/jobs?stage=for_you')
    const jobs = res.body.jobs as { title: string; reasons: unknown[] }[]
    expect(jobs.map((job) => job.title)).toEqual(['Backend Engineer'])
    expect(jobs[0]!.reasons.length).toBeGreaterThan(2)
  })

  it('prepares a package for the extension: profile, verified resume PDF, vault answers, and needs_user for the unknown', async () => {
    const res = await call('POST', '/api/ext/package', {
      headers: { authorization: `Bearer ${app.token}` },
      body: {
        pageUrl: `https://jobs.ashbyhq.com/example/${ASHBY_ID}/application`,
        questions: [
          { label: 'Name', required: true },
          { label: 'Email', required: true },
          { label: 'Will you now or in the future require visa sponsorship?', required: true, options: ['Yes', 'No'] },
          { label: 'Describe a time you disagreed with a manager', required: true },
        ],
      },
    })
    expect(res.status).toBe(200)
    const pkg = res.body as {
      verified: boolean
      resume: { download: string }
      questions: { status: string; answer: string | null; source: string | null }[]
    }
    expect(pkg.verified).toBe(true)
    expect(pkg.questions.map((q) => [q.status, q.answer])).toEqual([
      ['answered', 'Sam Example'],
      ['answered', 'sam@example.com'],
      ['answered', 'No'],
      ['needs_user', null],
    ])
    const pdf = await call('GET', pkg.resume.download, { headers: { authorization: `Bearer ${app.token}` } })
    expect(pdf.status).toBe(200)
    expect(String(pdf.body.raw).startsWith('%PDF')).toBe(true)
  })

  it('moves the job to Drafted, then Applied once confirmed', async () => {
    expect(((await call('GET', '/api/jobs?stage=drafted')).body.jobs as unknown[]).length).toBe(1)
    const jobId = ((await call('GET', '/api/jobs?stage=drafted')).body.jobs as { id: number }[])[0]!.id
    await call('POST', '/api/ext/submitted', { headers: { authorization: `Bearer ${app.token}` }, body: { jobId } })
    expect(((await call('GET', '/api/jobs?stage=applied')).body.jobs as unknown[]).length).toBe(1)
  })

  it('a thumbs-down records the title as rejected and re-scores', async () => {
    const jobId = ((await call('GET', '/api/jobs?stage=all')).body.jobs as { id: number }[])[0]!.id
    expect((await call('POST', `/api/jobs/${jobId}/dismiss`, { body: {} })).status).toBe(200)
    expect(JSON.parse(readFileSync(ws.preferencesPath, 'utf8')).rejectedTitles).toEqual(['Backend Engineer'])
  })
})
