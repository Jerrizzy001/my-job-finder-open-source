import type { WorkMode } from './location.ts'

/** A posting, as every source adapter normalises it. */
export type Job = {
  title: string
  company: string
  location: string | null
  workplaceType: WorkMode | null
  /** Plain text. `null` when the board list had none and it was not read yet. */
  description: string | null
  url: string
  source: string
  employmentType?: string | null
  postedAt?: string | null
}

/**
 * The saved search: the same `preferences.json` the CLI and the UI edit.
 * Every list may be empty; an empty list does not filter.
 */
export type Preferences = {
  /** Titles you want. All student-level ("... intern") makes a student search. */
  roleTitles: string[]
  /** Titles to drop even when they match ("Senior Software Engineer"). */
  excludedTitles?: string[]
  /** Places you can work on site or hybrid: "Toronto", "Waterloo, ON". */
  locations?: string[]
  /** Where you can work remotely from: "Canada", "North America", "Anywhere". Defaults to your places' countries. */
  remoteRegions?: string[]
  /** Work modes you accept. Empty accepts all. */
  workModes?: WorkMode[]
  /** Expected graduation, "YYYY-MM". A student term ending after it is ineligible. */
  graduation?: string | null
  blockedCompanies?: string[]
  /** Words that drop a posting when they appear in its title ("senior", "clearance"). */
  blockedTerms?: string[]
  /** Titles you gave a thumbs-down; similar titles score lower. */
  rejectedTitles?: string[]
}

export type ReasonKind = 'plus' | 'minus' | 'info' | 'fail'

/** One line of "Why this job". */
export type Reason = {
  kind: ReasonKind
  code: string
  text: string
  points?: number
}
