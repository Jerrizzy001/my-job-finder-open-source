import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Preferences, WorkMode } from '@jobfinder/core'
import { parseCatalog, type CatalogEntry } from '@jobfinder/sources'
import { validateProfile, type Profile } from '@jobfinder/tailor'

/**
 * The workspace: a folder of plain files you can edit by hand, plus the
 * database. The CLI and the UI read and write the same files.
 *
 *   preferences.json   your saved search
 *   profile.json       who you are
 *   master-resume.md   your full resume
 *   catalog.yaml       the boards to read
 *   drafts/            tailored resumes and cover letters
 *   .jobfinder/        the SQLite database
 *
 * The folder is the current directory, or JOBFINDER_HOME.
 */

export type Workspace = {
  root: string
  dbPath: string
  preferencesPath: string
  profilePath: string
  catalogPath: string
  draftsDir: string
}

export function resolveWorkspace(root = process.env.JOBFINDER_HOME ?? process.cwd()): Workspace {
  const dir = resolve(root)
  return {
    root: dir,
    dbPath: join(dir, '.jobfinder', 'jobfinder.sqlite'),
    preferencesPath: join(dir, 'preferences.json'),
    profilePath: join(dir, 'profile.json'),
    catalogPath: join(dir, 'catalog.yaml'),
    draftsDir: join(dir, 'drafts'),
  }
}

function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) throw new Error(`${what} not found at ${path}. Run "jobfinder init" first.`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`)
  }
}

const WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite']

function stringList(value: unknown, key: string, problems: string[]): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    problems.push(`"${key}" must be a list of strings`)
    return []
  }
  return value.map((item: string) => item.trim()).filter(Boolean)
}

export function validatePreferences(value: unknown): Preferences {
  const raw = (value ?? {}) as Record<string, unknown>
  const problems: string[] = []
  const prefs: Preferences = {
    roleTitles: stringList(raw.roleTitles, 'roleTitles', problems),
    excludedTitles: stringList(raw.excludedTitles, 'excludedTitles', problems),
    locations: stringList(raw.locations, 'locations', problems),
    remoteRegions: stringList(raw.remoteRegions, 'remoteRegions', problems),
    workModes: stringList(raw.workModes, 'workModes', problems) as WorkMode[],
    graduation: typeof raw.graduation === 'string' && raw.graduation.trim() ? raw.graduation.trim() : null,
    blockedCompanies: stringList(raw.blockedCompanies, 'blockedCompanies', problems),
    blockedTerms: stringList(raw.blockedTerms, 'blockedTerms', problems),
    rejectedTitles: stringList(raw.rejectedTitles, 'rejectedTitles', problems),
  }
  if (!prefs.roleTitles.length) problems.push('"roleTitles" needs at least one title')
  for (const mode of prefs.workModes ?? [])
    if (!WORK_MODES.includes(mode)) problems.push(`"workModes" may only contain ${WORK_MODES.join(', ')}`)
  if (prefs.graduation && !/^20\d\d-(0[1-9]|1[0-2])$/.test(prefs.graduation))
    problems.push('"graduation" must look like "2027-04"')
  if (problems.length) throw new Error(`preferences.json: ${problems.join('; ')}.`)
  return prefs
}

export function readPreferences(ws: Workspace): Preferences {
  return validatePreferences(readJson(ws.preferencesPath, 'preferences.json'))
}

export function writePreferences(ws: Workspace, prefs: unknown): Preferences {
  const valid = validatePreferences(prefs)
  writeFileSync(ws.preferencesPath, `${JSON.stringify(valid, null, 2)}\n`)
  return valid
}

export function readProfile(ws: Workspace): Profile | null {
  if (!existsSync(ws.profilePath)) return null
  return validateProfile(readJson(ws.profilePath, 'profile.json'))
}

export function writeProfile(ws: Workspace, profile: unknown): Profile {
  const valid = validateProfile(profile)
  writeFileSync(ws.profilePath, `${JSON.stringify(valid, null, 2)}\n`)
  return valid
}

export function masterResumePath(ws: Workspace, profile: Profile | null): string {
  return resolve(ws.root, profile?.masterResume ?? 'master-resume.md')
}

export function readMasterResume(ws: Workspace, profile: Profile | null): string | null {
  const path = masterResumePath(ws, profile)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function readCatalog(ws: Workspace): CatalogEntry[] {
  if (!existsSync(ws.catalogPath))
    throw new Error(`catalog.yaml not found at ${ws.catalogPath}. Run "jobfinder init" first.`)
  return parseCatalog(readFileSync(ws.catalogPath, 'utf8'))
}
