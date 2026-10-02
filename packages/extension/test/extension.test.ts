import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atsOf, isAshbyApplication } from '../src/shared.ts'

const src = join(import.meta.dirname, '..', 'src')
const sources = readdirSync(src)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => [name, readFileSync(join(src, name), 'utf8')] as const)

describe('which pages the extension acts on', () => {
  it('fills only Ashby application pages', () => {
    expect(isAshbyApplication('https://jobs.ashbyhq.com/acme/11111111-2222-4333-8444-555555555555/application')).toBe(
      true,
    )
    expect(isAshbyApplication('https://jobs.ashbyhq.com/acme/11111111-2222-4333-8444-555555555555')).toBe(false)
    expect(isAshbyApplication('https://evil.example/acme/11111111-2222-4333-8444-555555555555/application')).toBe(false)
  })

  it('names other ATS pages so the popup can point to guided apply instead', () => {
    expect(atsOf('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse')
    expect(atsOf('https://jobs.lever.co/acme/1/apply')).toBe('lever')
    expect(atsOf('https://acme.myworkdayjobs.com/External/job/x')).toBe('workday')
    expect(atsOf('https://example.com/careers')).toBeNull()
  })
})

describe('the review stop, enforced in source', () => {
  it.each(sources)('%s never submits a form or presses Enter', (_, text) => {
    expect(text).not.toMatch(/\.submit\(|requestSubmit|KeyboardEvent|key:\s*['"]Enter/)
  })

  it('talks to 127.0.0.1 only', () => {
    const urls = sources.flatMap(([, text]) => [...text.matchAll(/fetch\(\s*`([^`]+)`/g)].map((m) => m[1]!))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((url) => url.startsWith('http://127.0.0.1:'))).toBe(true)
  })

  it('declares no host access beyond 127.0.0.1 and runs its page script only on Ashby', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'manifest.json'), 'utf8'))
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*'])
    expect(manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches)).toEqual([
      'https://jobs.ashbyhq.com/*',
    ])
    expect(manifest.permissions).toEqual(['storage', 'activeTab'])
  })
})
