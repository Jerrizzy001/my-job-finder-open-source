import type { Board, SourceKey } from './types.ts'

/**
 * `catalog.yaml`: the boards to read.
 *
 *   boards:
 *     - company: Example
 *       source: greenhouse
 *       token: example
 *
 * This reads and writes a small, strict subset of YAML — a `boards:` list of
 * flat maps with scalar values, plus comments — so the project needs no YAML
 * dependency. Anything outside that subset is an error with a line number.
 */

const SOURCES: ReadonlySet<string> = new Set<SourceKey>([
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workable',
  'icims',
  'workday',
  'dayforce',
  'jsonld',
])

export type CatalogEntry = Board & Record<string, string | number | undefined>

function scalar(raw: string, line: number): string | number {
  const value = raw.trim()
  if (/^".*"$/.test(value)) return JSON.parse(value) as string
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^[[{&*!|>%@`]/.test(value)) throw new Error(`catalog.yaml line ${line}: only plain scalar values are supported.`)
  return value
}

function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i)
  }
  return line
}

export function parseCatalog(text: string): CatalogEntry[] {
  const entries: Record<string, string | number>[] = []
  let inBoards = false
  let current: Record<string, string | number> | null = null
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1
    const line = stripComment(rawLine).replace(/\s+$/, '')
    if (!line.trim()) return
    if (/^boards:\s*$/.test(line)) {
      inBoards = true
      return
    }
    if (!/^\s/.test(line)) {
      if (/^[A-Za-z_][\w-]*:/.test(line)) {
        inBoards = false
        return
      }
      throw new Error(`catalog.yaml line ${lineNo}: expected "boards:" or a top-level key.`)
    }
    if (!inBoards) return
    const item = /^\s+-\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const field = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (item) {
      current = { [item[1]!]: scalar(item[2]!, lineNo) }
      entries.push(current)
    } else if (field && current) {
      current[field[1]!] = scalar(field[2]!, lineNo)
    } else throw new Error(`catalog.yaml line ${lineNo}: expected "- key: value" or "key: value".`)
  })

  return entries.map((entry, index) => {
    const where = `catalog.yaml board ${index + 1}`
    if (typeof entry.company !== 'string' || !entry.company) throw new Error(`${where}: "company" is required.`)
    if (typeof entry.source !== 'string' || !SOURCES.has(entry.source))
      throw new Error(`${where} (${entry.company}): unknown source "${entry.source}".`)
    if (entry.token === undefined || entry.token === '')
      throw new Error(`${where} (${entry.company}): "token" is required.`)
    return { ...entry, token: String(entry.token) } as CatalogEntry
  })
}

function formatScalar(value: string | number): string {
  if (typeof value === 'number') return String(value)
  return /^[\w.@/:+-]+(?: [\w.@/:+&()-]+)*$/.test(value) && !/^-?\d/.test(value) && !/: /.test(value)
    ? value
    : JSON.stringify(value)
}

export function formatCatalog(entries: readonly CatalogEntry[], header = ''): string {
  const lines = header ? header.split('\n').map((line) => (line ? `# ${line}` : '#')) : []
  lines.push('boards:')
  for (const entry of entries) {
    const keys = [
      'company',
      'source',
      'token',
      ...Object.keys(entry).filter((key) => !['company', 'source', 'token'].includes(key)),
    ]
    keys.forEach((key, index) => {
      const value = entry[key]
      if (value === undefined || value === null) return
      lines.push(`${index === 0 ? '  - ' : '    '}${key}: ${formatScalar(value as string | number)}`)
    })
  }
  return `${lines.join('\n')}\n`
}
