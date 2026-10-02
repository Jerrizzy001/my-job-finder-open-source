import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  discover,
  jobsToCsv,
  listJobs,
  matchJobs,
  openDb,
  readCatalog,
  readPreferences,
  readProfile,
  resolveWorkspace,
  syncBoards,
  boardStatus,
  DEFAULT_DRAFT_LIMIT,
  llmUsageTotals,
  tailorBest,
  tailorJob,
  createApp,
  listen,
  type Workspace,
} from '@jobfinder/server'
import { llmConfigFromEnv, openAiCompatible } from '@jobfinder/tailor'
import { intFlag, parseArgs } from './args.ts'

export const HOSTED_LINE = 'Want this across thousands of boards, continuously? https://myjobfinder.live'

export const usage = `jobfinder — find jobs on public ATS boards, match them with reasons, draft applications locally.

Usage: jobfinder <command> [options]

  init [--student] [--force]   Write preferences.json, profile.json, master-resume.md, catalog.yaml here
  discover [--all]             Read the boards that are due (--all: every board, now)
  match [--force] [--top N]    Score open postings against preferences.json
  tailor [--limit N] [--job ID]  Draft a resume and cover letter for the best matches (default 10)
  run [--all] [--limit N]      discover, then match, then tailor — the one to put in cron
  serve [--port N] [--no-schedule]  Start the local UI and API on http://127.0.0.1:4321
  boards                       Show each board's last outcome and open postings
  export --csv [--out FILE]    Write your matches as CSV (stdout by default)

The workspace is the current folder, or JOBFINDER_HOME.`

type Command = (argv: string[]) => Promise<void>

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples')

function open(ws: Workspace) {
  return openDb(ws.dbPath)
}

function printTop(ws: Workspace, top: number) {
  const db = open(ws)
  const jobs = listJobs(db, { stage: 'all' })
    .filter((job) => job.status === 'eligible')
    .slice(0, top)
  if (!jobs.length) {
    console.log(
      'No eligible matches yet. Widen roleTitles or locations in preferences.json, or run "jobfinder discover --all".',
    )
    return
  }
  for (const job of jobs) {
    console.log(
      `\n${String(job.score).padStart(3)}  ${job.title} — ${job.company}${job.location ? ` (${job.location})` : ''}`,
    )
    console.log(`     #${job.id} ${job.url}`)
    for (const reason of job.reasons.slice(0, 4))
      console.log(`     ${reason.kind === 'minus' ? '−' : reason.kind === 'plus' ? '+' : '·'} ${reason.text}`)
  }
}

export async function runDiscover(ws: Workspace, all: boolean) {
  const db = open(ws)
  const prefs = readPreferences(ws)
  syncBoards(db, readCatalog(ws))
  console.log(all ? 'Reading every board (one request per second per host)…' : 'Reading the boards that are due…')
  const summary = await discover(db, prefs, { all, log: (line) => console.log(`  ${line}`) })
  if (!summary.boards) console.log('  No boards are due. Use --all to read them now.')
  else
    console.log(
      `Read ${summary.boards} boards: ${summary.seen} postings seen, ${summary.selected} kept by title, ${summary.inserted} new, ${summary.closed} closed.`,
    )
  return summary
}

export async function runMatch(ws: Workspace, force: boolean) {
  const db = open(ws)
  const prefs = readPreferences(ws)
  const profile = readProfile(ws)
  const summary = await matchJobs(db, prefs, { profileSkills: profile?.skills ?? [], force })
  console.log(
    `Scored ${summary.scored} postings (${summary.skipped} already current): ${summary.eligible} eligible, ${summary.pending} waiting for a description, ${summary.ineligible} ineligible.`,
  )
  return summary
}

function llmFromEnv() {
  const config = llmConfigFromEnv()
  return config ? openAiCompatible(config) : null
}

export async function runTailor(ws: Workspace, options: { limit: number; jobId?: number }) {
  const db = open(ws)
  const llm = llmFromEnv()
  console.log(
    llm
      ? `Drafting with ${llm.model}…`
      : 'No model configured: drafting your master resume and a templated cover letter (see docs/FAQ.md to add one).',
  )
  const before = llmUsageTotals(db)
  const results = options.jobId
    ? [await tailorJob(db, ws, options.jobId, llm)]
    : await tailorBest(db, ws, { limit: options.limit, llm, log: (line) => console.log(`  ${line}`) })
  if (options.jobId) console.log(`  ${relative(ws.root, results[0]!.dir)}`)
  if (!results.length) console.log('  Nothing new to draft: every top match already has a draft.')
  const after = llmUsageTotals(db)
  if (after.calls > before.calls)
    console.log(
      `Model use this run: ${after.calls - before.calls} calls, ${after.promptTokens - before.promptTokens} prompt + ${after.completionTokens - before.completionTokens} completion tokens${after.costUsd !== null ? `, $${((after.costUsd ?? 0) - (before.costUsd ?? 0)).toFixed(4)}` : ''}.`,
    )
  const unverified = results.filter((result) => !result.manifest.verified).length
  if (unverified) console.log(`${unverified} draft(s) did not pass verification; their manifest.json lists why.`)
  return results
}

export const commands: Record<string, Command> = {
  async init(argv) {
    const { flags } = parseArgs(argv, ['student', 'force'])
    const ws = resolveWorkspace()
    const files: [string, string][] = [
      [flags.student ? 'preferences.student.json' : 'preferences.json', ws.preferencesPath],
      ['profile.json', ws.profilePath],
      ['master-resume.md', join(ws.root, 'master-resume.md')],
      ['catalog.yaml', ws.catalogPath],
      ['answers.json', join(ws.root, 'answers.json')],
    ]
    for (const [from, to] of files) {
      if (existsSync(to) && !flags.force) {
        console.log(`  keep   ${relative(process.cwd(), to) || to} (exists; --force to overwrite)`)
        continue
      }
      copyFileSync(join(EXAMPLES, from), to)
      console.log(`  wrote  ${relative(process.cwd(), to) || to}`)
    }
    open(ws)
    console.log(`
Next:
  1. Edit preferences.json (the roles and places you want).
  2. Replace profile.json and master-resume.md with your own (the examples are a fictional person).
  3. Run: jobfinder run`)
  },

  async discover(argv) {
    const { flags } = parseArgs(argv, ['all'])
    await runDiscover(resolveWorkspace(), flags.all === true)
  },

  async match(argv) {
    const { flags } = parseArgs(argv, ['force', 'top='])
    const ws = resolveWorkspace()
    await runMatch(ws, flags.force === true)
    printTop(ws, intFlag(flags, 'top', 10))
  },

  async tailor(argv) {
    const { flags } = parseArgs(argv, ['limit=', 'job='])
    const jobId = flags.job === undefined ? undefined : intFlag(flags, 'job', 0)
    await runTailor(resolveWorkspace(), { limit: intFlag(flags, 'limit', DEFAULT_DRAFT_LIMIT), jobId })
  },

  async run(argv) {
    const { flags } = parseArgs(argv, ['all', 'limit='])
    const ws = resolveWorkspace()
    await runDiscover(ws, flags.all === true)
    await runMatch(ws, false)
    await runTailor(ws, { limit: intFlag(flags, 'limit', DEFAULT_DRAFT_LIMIT) })
    console.log(`\nDone. Open ${relative(process.cwd(), ws.draftsDir) || 'drafts'}/ to read your drafts.`)
    console.log(HOSTED_LINE)
  },

  async serve(argv) {
    const { flags } = parseArgs(argv, ['port=', 'no-schedule'])
    const port = intFlag(flags, 'port', 4321)
    const ws = resolveWorkspace()
    const db = open(ws)
    readPreferences(ws)
    syncBoards(db, readCatalog(ws))
    const webDir = join(import.meta.dirname, '..', '..', 'web', 'dist')
    const app = createApp({
      db,
      ws,
      port,
      webDir,
      schedule: flags['no-schedule'] !== true,
      log: (line) => console.error(line),
    })
    await listen(app, port)
    console.log(`jobfinder is running at ${app.url} (this computer only).`)
    if (!existsSync(webDir)) console.log('The UI is not built yet: run "npm run build:web" in the repo, then reload.')
    console.log(`Extension token (paste it into the extension once): ${app.token}`)
    console.log(
      flags['no-schedule']
        ? 'Scheduler off.'
        : 'Boards are re-read when due (every 6 hours by default). Ctrl+C to stop.',
    )
  },

  async boards() {
    const ws = resolveWorkspace()
    const db = open(ws)
    syncBoards(db, readCatalog(ws))
    for (const row of boardStatus(db) as Record<string, unknown>[])
      console.log(
        `${String(row.company).padEnd(22)} ${String(row.source).padEnd(15)} ${String(row.last_outcome ?? 'never read').padEnd(17)} open ${String(row.open_jobs).padStart(4)}${row.paused_at ? `  PAUSED (${row.paused_reason})` : ''}`,
      )
  },

  async export(argv) {
    const { flags } = parseArgs(argv, ['csv', 'out='])
    if (!flags.csv) throw new Error('Only --csv is supported.')
    const ws = resolveWorkspace()
    const csv = jobsToCsv(listJobs(open(ws), { stage: 'all' }))
    if (typeof flags.out === 'string') {
      writeFileSync(flags.out, csv)
      console.log(`Wrote ${flags.out}.`)
    } else process.stdout.write(csv)
  },
}
