/**
 * Probe candidate boards politely and write the live ones as a catalog.
 *
 *   node scripts/validate-boards.ts examples/candidates.yaml catalog.yaml
 *
 * Each candidate gets at most a few requests, one at a time, through the same
 * bounded runner as discovery (robots.txt, one second per host, backoff on
 * 429). Boards that answer with postings are kept, with their job count and
 * a few sample titles so you can see what you are adding. A failed probe is
 * reported and not retried.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { formatCatalog, parseCatalog, Politeness, runBoard, type CatalogEntry } from '@jobfinder/sources'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: node scripts/validate-boards.ts <candidates.yaml> <catalog.yaml>')
  process.exit(2)
}

const candidates = parseCatalog(readFileSync(input, 'utf8'))
const politeness = new Politeness()
const live: CatalogEntry[] = []

for (const candidate of candidates) {
  const { company, source, token, host, site, url, cadenceHours } = candidate
  const board = { company, source, token, host, site, url, cadenceHours }
  const result = await runBoard(board, { politeness, limits: { maxRequests: 4 }, maxItems: 2000 })
  const ok = (result.outcome === 'complete_full' || result.outcome === 'complete_partial') && result.seen > 0
  console.log(
    `${ok ? 'live ' : 'skip '} ${source.padEnd(15)} ${company.padEnd(24)} ${result.outcome} seen=${result.seen}${result.message ? ` (${result.message})` : ''}`,
  )
  if (!ok) continue
  const sample = [...new Set(result.jobs.map((job) => job.title))].slice(0, 3).join(' | ')
  const defined = Object.fromEntries(Object.entries(board).filter(([, value]) => value !== undefined)) as CatalogEntry
  live.push({ ...defined, jobs: result.seen, sample })
}

writeFileSync(
  output,
  formatCatalog(
    live,
    `Verified by scripts/validate-boards.ts on ${new Date().toISOString().slice(0, 10)}.\n"jobs" and "sample" are what each board listed that day; they are not read back.`,
  ),
)
console.log(`\n${live.length} of ${candidates.length} boards are live; wrote ${output}.`)
