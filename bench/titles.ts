/**
 * Title-matching precision and recall against hand labels.
 *
 *   npm run bench            (or: node bench/titles.ts [labels.jsonl])
 *
 * Each line of examples/titles.jsonl is a title, a saved search and a human
 * label: would someone running that search want to see this title? The
 * labels were written by hand, not from the matcher's output, so a miss here
 * is a real miss. A title counts as selected when it reaches any tier above
 * `none` (a `related` title is selected for a description read).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchTitle, MATCHING_POLICY_VERSION } from '@jobfinder/core'

export const SEARCHES: Record<string, string[]> = {
  student: ['AI engineer intern', 'Software developer intern'],
  swe: ['Software Engineer'],
  data: ['Data Analyst'],
  pm: ['Product Manager'],
}

type Label = { title: string; search: string; relevant: boolean }

const path = process.argv[2] ?? join(import.meta.dirname, '..', 'examples', 'titles.jsonl')
const labels = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Label)

const rows: string[] = []
const totals: Record<string, { tp: number; fp: number; fn: number; tn: number }> = {}
for (const label of labels) {
  const search = SEARCHES[label.search]
  if (!search) throw new Error(`Unknown search "${label.search}" in ${path}.`)
  const tier = matchTitle(label.title, { roleTitles: search }).tier
  const selected = tier !== 'none'
  const bucket = (totals[label.search] ??= { tp: 0, fp: 0, fn: 0, tn: 0 })
  if (selected && label.relevant) bucket.tp++
  else if (selected) {
    bucket.fp++
    rows.push(`  false positive  [${label.search}] ${label.title} (${tier})`)
  } else if (label.relevant) {
    bucket.fn++
    rows.push(`  missed          [${label.search}] ${label.title}`)
  } else bucket.tn++
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a')
console.log(`Title matching, policy ${MATCHING_POLICY_VERSION}, ${labels.length} labelled titles\n`)
console.log('search     precision  recall   tp  fp  fn  tn')
const all = { tp: 0, fp: 0, fn: 0, tn: 0 }
for (const [search, t] of Object.entries(totals)) {
  for (const key of ['tp', 'fp', 'fn', 'tn'] as const) all[key] += t[key]
  console.log(
    `${search.padEnd(10)} ${pct(t.tp, t.tp + t.fp).padStart(9)}  ${pct(t.tp, t.tp + t.fn).padStart(6)}  ${String(t.tp).padStart(3)} ${String(t.fp).padStart(3)} ${String(t.fn).padStart(3)} ${String(t.tn).padStart(3)}`,
  )
}
console.log(
  `${'all'.padEnd(10)} ${pct(all.tp, all.tp + all.fp).padStart(9)}  ${pct(all.tp, all.tp + all.fn).padStart(6)}  ${String(all.tp).padStart(3)} ${String(all.fp).padStart(3)} ${String(all.fn).padStart(3)} ${String(all.tn).padStart(3)}`,
)
if (rows.length) console.log(`\nDisagreements:\n${rows.join('\n')}`)
