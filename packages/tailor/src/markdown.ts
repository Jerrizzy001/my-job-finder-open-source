/**
 * The Markdown the drafts use, and nothing more: `#`/`##`/`###` headings,
 * paragraphs, `-` bullets, and `**bold**`. Small enough to render to PDF
 * without a browser.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'blank' }

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]!.trim() })
    } else if (bullet) {
      flush()
      blocks.push({ type: 'bullet', text: bullet[1]!.trim() })
    } else if (!line.trim()) {
      flush()
      if (blocks.length && blocks.at(-1)!.type !== 'blank') blocks.push({ type: 'blank' })
    } else paragraph.push(line.trim())
  }
  flush()
  return blocks
}

/** Inline text without Markdown emphasis or link syntax. */
export function plainInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
}

/** Markdown as plain text, for checks and word counts. */
export function markdownToText(markdown: string): string {
  return parseMarkdown(markdown)
    .map((block) =>
      block.type === 'blank' ? '' : block.type === 'bullet' ? `- ${plainInline(block.text)}` : plainInline(block.text),
    )
    .join('\n')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Markdown as a small HTML fragment, for the local UI's preview. */
export function markdownToHtml(markdown: string): string {
  const out: string[] = []
  let inList = false
  for (const block of parseMarkdown(markdown)) {
    if (block.type !== 'bullet' && inList) {
      out.push('</ul>')
      inList = false
    }
    const inline = (text: string) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    if (block.type === 'heading') out.push(`<h${block.level}>${inline(block.text)}</h${block.level}>`)
    else if (block.type === 'paragraph') out.push(`<p>${inline(block.text)}</p>`)
    else if (block.type === 'bullet') {
      if (!inList) out.push('<ul>')
      inList = true
      out.push(`<li>${inline(block.text)}</li>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}
