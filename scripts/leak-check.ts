/**
 * The leak guard: fails if the repo contains anything that looks like it came
 * from a private deployment — hostnames, keys, tokens, account ids, emails.
 * Runs in CI and before every release. `node scripts/leak-check.ts`
 *
 * The one allowed mention is the public hosted product's address,
 * `myjobfinder.live`, which the README links to on purpose.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['private hostname', /myjobfinder(?!\.live\b)/i],
  ['Workday tenant host', /wd\d+\.myworkdayjobs/i],
  ['owner identifier', /nwachi/i],
  ['webhook secret', /whsec_/],
  ['secret key', /(?<![A-Za-z0-9])sk_(?:live|test)?_?[A-Za-z0-9]{8,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['known account id', /268d92bb/i],
  ['32-hex account-like id', /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/],
  ['personal email', /[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo|icloud)\.com/i],
]

const SKIP = [/^package-lock\.json$/, /(^|\/)node_modules\//, /\.(png|jpg|gif|ico|pdf|zip)$/]

export function scan(path: string, text: string): string[] {
  const hits: string[] = []
  text.split('\n').forEach((line, index) => {
    for (const [name, pattern] of PATTERNS) if (pattern.test(line)) hits.push(`${path}:${index + 1}: ${name}`)
  })
  return hits
}

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  return out.split('\n').filter((path) => path && !SKIP.some((skip) => skip.test(path)))
}

if (import.meta.main) {
  const self = 'scripts/leak-check.ts'
  const hits = trackedFiles()
    .filter((path) => path !== self && path !== 'scripts/leak-check.test.ts')
    .flatMap((path) => {
      try {
        return scan(path, readFileSync(path, 'utf8'))
      } catch {
        return []
      }
    })
  if (hits.length) {
    console.error(`Leak check failed (${hits.length}):\n${hits.join('\n')}`)
    process.exit(1)
  }
  console.log('Leak check passed.')
}
