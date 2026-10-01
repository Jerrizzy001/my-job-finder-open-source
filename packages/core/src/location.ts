/**
 * Location and work mode.
 *
 * A posting's location is free text: "Toronto, ON", "Remote - Canada",
 * "Remote (US only)", "Hybrid - London, UK; New York, NY". The rules need two
 * answers from it: does it name a place the person can work, and if it is
 * remote, where is that remote restricted to?
 */

export type WorkMode = 'remote' | 'hybrid' | 'onsite'

/** Countries by the names and codes postings use. Small on purpose: extend as needed. */
const COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  canada: ['canada', 'can'],
  us: ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a'],
  uk: ['united kingdom', 'uk', 'u k', 'england', 'scotland', 'wales', 'great britain', 'gb'],
  ireland: ['ireland'],
  germany: ['germany', 'deutschland'],
  france: ['france'],
  netherlands: ['netherlands', 'the netherlands'],
  spain: ['spain'],
  portugal: ['portugal'],
  poland: ['poland'],
  india: ['india'],
  australia: ['australia'],
  mexico: ['mexico'],
  brazil: ['brazil'],
}

/** Regions a posting may restrict remote work to, as countries. */
const REGIONS: Readonly<Record<string, readonly string[]>> = {
  'north america': ['canada', 'us', 'mexico'],
  americas: ['canada', 'us', 'mexico', 'brazil'],
  europe: ['uk', 'ireland', 'germany', 'france', 'netherlands', 'spain', 'portugal', 'poland'],
  emea: ['uk', 'ireland', 'germany', 'france', 'netherlands', 'spain', 'portugal', 'poland'],
  eu: ['ireland', 'germany', 'france', 'netherlands', 'spain', 'portugal', 'poland'],
}

const ANYWHERE = /\b(?:anywhere|worldwide|global|globally|any location)\b/

const CA_PROVINCES = [
  'on',
  'qc',
  'bc',
  'ab',
  'mb',
  'sk',
  'ns',
  'nb',
  'nl',
  'pe',
  'ontario',
  'quebec',
  'british columbia',
  'alberta',
  'manitoba',
  'saskatchewan',
  'nova scotia',
  'new brunswick',
]
const US_STATES = [
  'al',
  'ak',
  'az',
  'ar',
  'ca',
  'co',
  'ct',
  'de',
  'fl',
  'ga',
  'hi',
  'id',
  'il',
  'in',
  'ia',
  'ks',
  'ky',
  'la',
  'ma',
  'md',
  'me',
  'mi',
  'mn',
  'mo',
  'ms',
  'mt',
  'nc',
  'nd',
  'ne',
  'nh',
  'nj',
  'nm',
  'nv',
  'ny',
  'oh',
  'ok',
  'or',
  'pa',
  'ri',
  'sc',
  'sd',
  'tn',
  'tx',
  'ut',
  'va',
  'vt',
  'wa',
  'wi',
  'wv',
  'dc',
  'california',
  'new york',
  'texas',
  'washington',
  'massachusetts',
  'illinois',
  'colorado',
]

/** Other names a city goes by in postings. */
const CITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  toronto: ['gta', 'greater toronto area', 'toronto area'],
  'new york': ['nyc', 'new york city', 'manhattan', 'brooklyn'],
  'san francisco': ['sf', 'bay area', 'sf bay area', 'san francisco bay area'],
  vancouver: ['greater vancouver', 'metro vancouver'],
  montreal: ['greater montreal'],
  london: ['greater london'],
}

/** Lower case, accents off, punctuation as spaces. */
export function placeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasWord(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `)
}

/** The countries a place text names, directly or through a region, province or state. */
export function countriesIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const [country, names] of Object.entries(COUNTRIES))
    if (names.some((name) => hasWord(text, name))) found.add(country)
  for (const [region, countries] of Object.entries(REGIONS))
    if (hasWord(text, region)) countries.forEach((c) => found.add(c))
  return found
}

/**
 * Countries implied by "City, ST" parts of a raw location. A province or state
 * code counts only after a comma ("Toronto, ON"), so this reads the raw text.
 */
function countriesFromParts(raw: string): Set<string> {
  const found = new Set<string>()
  for (const part of raw.split(/[;|\n]/)) {
    const pieces = part
      .split(',')
      .map((piece) => placeText(piece))
      .filter(Boolean)
    for (const piece of pieces.slice(1)) {
      if (CA_PROVINCES.includes(piece)) found.add('canada')
      else if (US_STATES.includes(piece)) found.add('us')
    }
  }
  return found
}

export type ReadLocation = {
  text: string
  remote: boolean
  hybrid: boolean
  /** Countries the posting names. For a remote posting, where it is restricted to. */
  countries: Set<string>
  anywhere: boolean
}

export function readLocation(raw: string | null | undefined): ReadLocation {
  const text = placeText(raw ?? '')
  const countries = countriesIn(text)
  for (const country of countriesFromParts(raw ?? '')) countries.add(country)
  return {
    text,
    remote: /\b(?:remote|remotely|work from home|wfh|distributed|virtual)\b/.test(text),
    hybrid: /\bhybrid\b/.test(text),
    countries,
    anywhere: ANYWHERE.test(text),
  }
}

/** The work mode a posting states, from its structured field or its text. */
export function readWorkMode(input: {
  workplaceType?: WorkMode | null
  location?: string | null
  title?: string | null
}): WorkMode | null {
  if (input.workplaceType) return input.workplaceType
  const text = placeText(`${input.location ?? ''} ${input.title ?? ''}`)
  if (/\bhybrid\b/.test(text)) return 'hybrid'
  if (/\b(?:remote|work from home|wfh)\b/.test(text)) return 'remote'
  if (/\b(?:on site|onsite|in office|in person)\b/.test(text)) return 'onsite'
  return null
}

/** Whether a user's place ("Toronto" or "Waterloo, ON") appears in a location. */
export function placeMatches(userPlace: string, location: ReadLocation): boolean {
  const city = placeText(userPlace.split(',')[0] ?? '')
  if (!city) return false
  if (hasWord(location.text, city)) return true
  return (CITY_ALIASES[city] ?? []).some((alias) => hasWord(location.text, alias))
}

/** The countries a user can work remotely from: their stated regions, or their places' countries. */
export function userRemoteCountries(
  remoteRegions: readonly string[],
  places: readonly string[],
): {
  countries: Set<string>
  anywhere: boolean
} {
  const countries = new Set<string>()
  let anywhere = false
  for (const region of remoteRegions) {
    const text = placeText(region)
    if (ANYWHERE.test(text)) anywhere = true
    countriesIn(text).forEach((c) => countries.add(c))
  }
  if (!remoteRegions.length)
    for (const place of places) {
      countriesIn(placeText(place)).forEach((c) => countries.add(c))
      countriesFromParts(place).forEach((c) => countries.add(c))
    }
  return { countries, anywhere }
}
