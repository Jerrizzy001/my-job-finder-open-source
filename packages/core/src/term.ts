/**
 * Student terms against expected graduation.
 *
 * A co-op or internship runs for a term: "May–Dec 2027", "September 2026 to
 * April 2027", "Summer 2027", "an 8-month term starting May 2027". A student
 * graduating in April 2027 cannot take a term that ends in December 2027, so
 * that posting is ineligible for them.
 *
 * Months are counted as `year * 12 + monthIndex` so comparisons are plain
 * integer comparisons.
 */

export type Term = { start: number; end: number; text: string }

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

/** Canadian co-op seasons: Winter Jan–Apr, Summer (and Spring) May–Aug, Fall Sep–Dec. */
const SEASONS: Readonly<Record<string, readonly [number, number]>> = {
  winter: [0, 3], spring: [4, 7], summer: [4, 7], fall: [8, 11], autumn: [8, 11],
}

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
const YEAR = String.raw`(20\d\d)`
const DASH = String.raw`\s*(?:-|–|—|to|through|until|thru)\s*`

const RANGE = new RegExp(String.raw`\b${MONTH}(?:\s+${YEAR})?${DASH}${MONTH}\s*,?\s*${YEAR}\b`, 'gi')
const SEASON = new RegExp(String.raw`\b(winter|spring|summer|fall|autumn)\s*(?:term\s*)?,?\s*${YEAR}\b`, 'gi')
const LENGTH_START = new RegExp(
  String.raw`\b(\d{1,2}|four|eight|twelve|sixteen)[ -]?months?\b[^.]{0,60}?\b(?:starting|beginning|commencing|from)\s+(?:in\s+)?${MONTH}\s+${YEAR}\b`,
  'gi',
)

const WORD_NUMBERS: Readonly<Record<string, number>> = { four: 4, eight: 8, twelve: 12, sixteen: 16 }

function month(name: string): number {
  return MONTHS[name.toLowerCase().replace(/\.$/, '')] ?? MONTHS[name.toLowerCase().slice(0, 3)]!
}

/** Every term a text states. */
export function parseTerms(text: string): Term[] {
  const terms: Term[] = []
  for (const m of text.matchAll(RANGE)) {
    const endYear = Number(m[4])
    const startMonth = month(m[1]!)
    const endMonth = month(m[3]!)
    const startYear = m[2] ? Number(m[2]) : startMonth > endMonth ? endYear - 1 : endYear
    terms.push({ start: startYear * 12 + startMonth, end: endYear * 12 + endMonth, text: m[0] })
  }
  for (const m of text.matchAll(SEASON)) {
    const [from, to] = SEASONS[m[1]!.toLowerCase()]!
    const year = Number(m[2])
    terms.push({ start: year * 12 + from, end: year * 12 + to, text: m[0] })
  }
  for (const m of text.matchAll(LENGTH_START)) {
    const length = WORD_NUMBERS[m[1]!.toLowerCase()] ?? Number(m[1])
    const start = Number(m[3]) * 12 + month(m[2]!)
    terms.push({ start, end: start + length - 1, text: m[0] })
  }
  return terms
}

/** "2027-04" as a month count, or null. */
export function parseGraduation(value: string | null | undefined): number | null {
  const m = /^(20\d\d)-(0[1-9]|1[0-2])$/.exec(value?.trim() ?? '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

export function formatMonth(count: number): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[count % 12]} ${Math.floor(count / 12)}`
}

export type TermFit =
  | { kind: 'no_term' }
  | { kind: 'fits'; term: Term }
  | { kind: 'after_graduation'; term: Term }

/**
 * Whether any stated term ends by graduation. A posting that offers several
 * terms ("Winter or Summer 2027") fits when one of them does.
 */
export function termFit(text: string, graduation: number | null): TermFit {
  const terms = parseTerms(text)
  if (!terms.length || graduation === null) return { kind: 'no_term' }
  const fitting = terms.find((term) => term.end <= graduation)
  if (fitting) return { kind: 'fits', term: fitting }
  return { kind: 'after_graduation', term: terms.reduce((a, b) => (a.end <= b.end ? a : b)) }
}
