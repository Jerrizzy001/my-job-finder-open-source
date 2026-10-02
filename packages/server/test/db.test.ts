import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/index.ts'

describe('migrations', () => {
  it('run forward once, in order, and are idempotent', () => {
    const db = new DatabaseSync(':memory:')
    const version = migrate(db)
    expect(version).toBeGreaterThanOrEqual(2)
    expect(migrate(db)).toBe(version)
    const columns = (db.prepare('PRAGMA table_info(boards)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).toContain('link_pattern')
  })

  it('refuses a database newer than the code', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (999, ?)').run(new Date().toISOString())
    expect(() => migrate(db)).toThrow(/newer than this code/)
  })
})
