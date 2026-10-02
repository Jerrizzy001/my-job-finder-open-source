import { parseMarkdown, plainInline, type Block } from './markdown.ts'

/**
 * A small PDF writer for resumes and cover letters.
 *
 * It uses the two standard Helvetica fonts every PDF reader ships, so no
 * font files and no browser are needed, and the output is the same on every
 * machine. Text is laid out with the fonts' published character widths.
 * Characters outside Windows-1252 print as "?"; the drafts are plain text.
 */

/** Helvetica widths, in 1/1000 em, for characters 32–126. */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
]
/** Helvetica-Bold widths for characters 32–126. */
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
]

/** Windows-1252 bytes for the punctuation drafts use, with their widths. */
const SPECIAL: Readonly<Record<string, readonly [code: number, width: number]>> = {
  '–': [0x96, 556],
  '—': [0x97, 1000],
  '‘': [0x91, 222],
  '’': [0x92, 222],
  '“': [0x93, 333],
  '”': [0x94, 333],
  '•': [0x95, 350],
  '…': [0x85, 1000],
  '€': [0x80, 556],
}

function encodeChar(char: string): number {
  const special = SPECIAL[char]
  if (special) return special[0]
  const code = char.codePointAt(0)!
  return code >= 32 && code <= 255 && !(code >= 127 && code < 160) ? code : 63
}

function charWidth(char: string, bold: boolean): number {
  const special = SPECIAL[char]
  if (special) return special[1]
  const code = encodeChar(char)
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32]!
  return 556
}

export function textWidth(text: string, size: number, bold = false): number {
  let width = 0
  for (const char of text) width += charWidth(char, bold)
  return (width * size) / 1000
}

function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, size, bold) <= maxWidth || !line) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function pdfString(text: string): string {
  let out = ''
  for (const char of text) {
    const code = encodeChar(char)
    const ch = String.fromCharCode(code)
    out +=
      ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : code > 126 ? `\\${code.toString(8).padStart(3, '0')}` : ch
  }
  return `(${out})`
}

const PAGE = { width: 612, height: 792, margin: 54 }

type Style = { size: number; bold: boolean; before: number; after: number; indent: number; rule?: boolean }

const STYLES: Record<string, Style> = {
  h1: { size: 18, bold: true, before: 0, after: 4, indent: 0 },
  h2: { size: 11.5, bold: true, before: 10, after: 4, indent: 0, rule: true },
  h3: { size: 10.5, bold: true, before: 6, after: 1, indent: 0 },
  paragraph: { size: 10, bold: false, before: 2, after: 2, indent: 0 },
  bullet: { size: 10, bold: false, before: 1, after: 1, indent: 14 },
}

function styleOf(block: Exclude<Block, { type: 'blank' }>): Style {
  return block.type === 'heading' ? STYLES[`h${block.level}`]! : STYLES[block.type]!
}

/** Lay out Markdown into pages of PDF drawing operators. */
export function layout(markdown: string): string[][] {
  const pages: string[][] = [[]]
  const width = PAGE.width - 2 * PAGE.margin
  let y = PAGE.height - PAGE.margin

  const newPage = () => {
    pages.push([])
    y = PAGE.height - PAGE.margin
  }

  for (const block of parseMarkdown(markdown)) {
    if (block.type === 'blank') {
      y -= 4
      continue
    }
    const style = styleOf(block)
    const leading = style.size * 1.3
    const text = plainInline(block.text)
    const lines = wrap(text, style.size, style.bold, width - style.indent)
    y -= style.before
    if (y - leading * Math.min(lines.length, 2) < PAGE.margin) newPage()
    lines.forEach((line, index) => {
      if (y - leading < PAGE.margin) newPage()
      y -= leading
      const page = pages.at(-1)!
      const x = PAGE.margin + style.indent
      if (block.type === 'bullet' && index === 0)
        page.push(`BT /F1 ${style.size} Tf ${(PAGE.margin + 4).toFixed(2)} ${y.toFixed(2)} Td ${pdfString('•')} Tj ET`)
      page.push(
        `BT /${style.bold ? 'F2' : 'F1'} ${style.size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(line)} Tj ET`,
      )
    })
    if (style.rule) {
      y -= 3
      pages.at(-1)!.push(`0.6 w ${PAGE.margin} ${y.toFixed(2)} m ${PAGE.width - PAGE.margin} ${y.toFixed(2)} l S`)
    }
    y -= style.after
  }
  return pages.filter((page, index) => page.length || index === 0)
}

/** Markdown as a PDF file. `title` and `author` go in the document info. */
export function renderPdf(markdown: string, info: { title: string; author: string }): Buffer {
  const pages = layout(markdown)
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // object number = index + 1

  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // pages, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  add(`<< /Title ${pdfString(info.title)} /Author ${pdfString(info.author)} /Producer (my-job-finder-open-source) >>`)
  const kids: number[] = []
  for (const page of pages) {
    const content = page.join('\n')
    add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
    const contentRef = objects.length
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} 0 R >>`,
    )
    kids.push(objects.length)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export function pageCount(markdown: string): number {
  return layout(markdown).length
}
