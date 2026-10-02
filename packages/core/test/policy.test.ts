/**
 * The policy pin. The hash covers every rule file in `src/`. If this fails,
 * you changed matching behaviour: bump MATCHING_POLICY_VERSION in
 * `src/policy.ts` (so stored matches are re-scored) and update both values
 * below in the same commit.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATCHING_POLICY_VERSION } from '../src/index.ts'

const PINNED = { version: 'mp-2', hash: 'c1663a316b4a7a35' }

function rulesHash(): string {
  const dir = join(import.meta.dirname, '..', 'src')
  const hash = createHash('sha256')
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && name !== 'policy.ts')
    .sort()) {
    hash.update(file)
    hash.update(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  return hash.digest('hex').slice(0, 16)
}

describe('matching policy version', () => {
  it('is bumped whenever a rule file changes', () => {
    const actual = { version: MATCHING_POLICY_VERSION, hash: rulesHash() }
    expect(actual, 'Rules changed: bump MATCHING_POLICY_VERSION and update PINNED').toEqual(PINNED)
  })
})
