/**
 * Prints the current rules hash for `packages/core/test/policy.test.ts`.
 * Run it after bumping MATCHING_POLICY_VERSION: `node scripts/pin-policy.ts`.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'packages', 'core', 'src')
const hash = createHash('sha256')
for (const file of readdirSync(dir)
  .filter((name) => name.endsWith('.ts') && name !== 'policy.ts')
  .sort()) {
  hash.update(file)
  hash.update(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'))
}
console.log(hash.digest('hex').slice(0, 16))
