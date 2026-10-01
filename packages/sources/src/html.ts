/** HTML descriptions as plain text, and small readers shared by adapters. */

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
  middot: '·',
  eacute: 'é',
  copy: '©',
  reg: '®',
  trade: '™',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole
    }
    return NAMED[code.toLowerCase()] ?? whole
  })
}

export const MAX_DESCRIPTION = 60_000

/** HTML (possibly entity-encoded, as Greenhouse sends it) as readable plain text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  let text = html.includes('&lt;') && !html.includes('<') ? decodeEntities(html) : html
  text = text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, MAX_DESCRIPTION) : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed, bounded string, or null. */
export function str(value: unknown, max = 500): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

/** An ISO date from a string or epoch milliseconds, or null. */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A distinct, joined list of place names. */
export function joinPlaces(places: ReadonlyArray<string | null | undefined>): string | null {
  const seen = [...new Set(places.map((place) => place?.trim()).filter((place): place is string => !!place))]
  return seen.length ? seen.join('; ').slice(0, 500) : null
}

/** Plain text that keeps its line breaks, bounded. */
export function plain(value: unknown, max = MAX_DESCRIPTION): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, max) : null
}
