import {
  droppedValues,
  fillForm,
  FILLED_CLASS,
  looksSubmitted,
  questionsOf,
  refusalFor,
  scanForm,
  type FillReport,
} from './form.ts'
import { isAshbyApplication, type AnswerPackage, type FileData, type Message, type Reply } from './shared.ts'

/**
 * The page script on jobs.ashbyhq.com. It does nothing until you press Fill
 * in the popup. Then it fills what it can, highlights it, lists what it could
 * not, and stops. Submit is yours.
 */

function ask<T>(message: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply: Reply<T> | undefined) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (!reply) return reject(new Error('No answer from the extension.'))
      if (reply.ok) resolve(reply.value)
      else reject(new Error(reply.error))
    })
  })
}

const PANEL_CSS = `
:host { all: initial; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 640px);
  overflow: auto; background: #fff; color: #14181b; border: 1px solid #c3cbd1; border-radius: 10px;
  box-shadow: 0 2px 4px rgb(20 24 27 / 8%), 0 12px 32px rgb(20 24 27 / 18%); font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #d9dfe3; position: sticky; top: 0; background: #fff; }
h2 { margin: 0; font-size: 15px; }
.body { padding: 10px 14px 14px; }
p { margin: 6px 0; }
.stop { padding: 8px 10px; border-radius: 8px; background: #e2f0eb; color: #175747; font-weight: 600; }
.warn { padding: 8px 10px; border-radius: 8px; background: #fbeceb; color: #a3302b; }
h3 { margin: 12px 0 4px; font-size: 13px; color: #444d54; }
ul { margin: 0; padding: 0; list-style: none; }
li { padding: 5px 0; border-bottom: 1px solid #edf0f2; }
li b { display: block; font-weight: 600; }
li span { color: #444d54; word-break: break-word; }
.actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
button { font: inherit; font-weight: 500; min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #c3cbd1; background: #fff; color: #14181b; cursor: pointer; }
button.primary { background: #1d6b57; border-color: #1d6b57; color: #fff; }
button:focus-visible { outline: 2px solid #1d6b57; outline-offset: 2px; }
`

let host: HTMLElement | null = null
let watching: MutationObserver | null = null

function panel(): ShadowRoot {
  if (!host) {
    host = document.createElement('jobfinder-review')
    host.attachShadow({ mode: 'open' })
    document.documentElement.append(host)
    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    host.shadowRoot!.append(style)
  }
  return host.shadowRoot!
}

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function render(title: string, build: (body: HTMLElement) => void) {
  const root = panel()
  root.querySelector('.panel')?.remove()
  const box = el('section', undefined, 'panel')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', title)
  const header = el('header')
  header.append(el('h2', title))
  const close = el('button', 'Close')
  close.addEventListener('click', () => box.remove())
  header.append(close)
  const body = el('div', undefined, 'body')
  build(body)
  box.append(header, body)
  root.append(box)
}

function showMessage(title: string, message: string, tone: 'warn' | 'stop' = 'warn') {
  render(title, (body) => body.append(el('p', message, tone)))
}

function list(body: HTMLElement, heading: string, rows: { label: string; text: string }[]) {
  if (!rows.length) return
  body.append(el('h3', heading))
  const ul = el('ul')
  for (const row of rows) {
    const li = el('li')
    li.append(el('b', row.label), el('span', row.text))
    ul.append(li)
  }
  body.append(ul)
}

function showReview(pkg: AnswerPackage, report: FillReport, dropped: string[]) {
  render('Review before you submit', (body) => {
    body.append(el('p', 'Submit is untouched. Read every field, fix anything, then press Submit yourself.', 'stop'))
    body.append(el('p', `${pkg.title} at ${pkg.company}`))
    if (!pkg.verified)
      body.append(el('p', 'Your drafts did not pass verification. Read the resume before you send it.', 'warn'))
    if (dropped.length)
      body.append(
        el(
          'p',
          `The page cleared ${dropped.length} field(s) after filling: ${dropped.join(', ')}. Press Fill again or type them.`,
          'warn',
        ),
      )
    list(
      body,
      `Entered (${report.filled.length})`,
      report.filled.map((entry) => ({
        label: entry.label,
        text: entry.value.length > 160 ? `${entry.value.slice(0, 160)}…` : entry.value,
      })),
    )
    list(
      body,
      `Left for you (${report.skipped.length})`,
      report.skipped.map((entry) => ({ label: entry.label, text: entry.reason })),
    )
    const actions = el('div', undefined, 'actions')
    const submitted = el('button', 'I submitted it', 'primary')
    submitted.addEventListener('click', () => void record(pkg))
    actions.append(submitted)
    body.append(actions)
  })
}

async function record(pkg: AnswerPackage) {
  try {
    await ask({ kind: 'submitted', jobId: pkg.jobId })
    showMessage('Recorded', `Marked ${pkg.title} at ${pkg.company} as applied in your local jobfinder.`, 'stop')
  } catch (error) {
    showMessage('Could not record it', (error as Error).message)
  }
  watching?.disconnect()
}

function watchForConfirmation(pkg: AnswerPackage) {
  watching?.disconnect()
  watching = new MutationObserver(() => {
    if (looksSubmitted(document)) {
      watching?.disconnect()
      void record(pkg)
    }
  })
  watching.observe(document.body, { childList: true, subtree: true, characterData: true })
}

function injectHighlight() {
  if (document.getElementById('jobfinder-highlight')) return
  const style = document.createElement('style')
  style.id = 'jobfinder-highlight'
  style.textContent = `.${FILLED_CLASS} { outline: 2px solid #1d6b57 !important; outline-offset: 2px !important; background-color: rgb(29 107 87 / 6%) !important; }`
  document.head.append(style)
}

async function fill(): Promise<string> {
  if (!isAshbyApplication(location.href))
    return 'Open the application tab of an Ashby posting (the URL ends in /application), then press Fill.'
  const refusal = refusalFor(document)
  if (refusal) {
    showMessage(refusal.reason === 'captcha' ? 'Please finish this one yourself' : 'Sign in first', refusal.message)
    return refusal.message
  }
  render('Filling…', (body) => body.append(el('p', 'Reading the form and asking your local jobfinder for answers.')))
  const fields = scanForm(document)
  if (!fields.length) {
    showMessage('No form found', 'The application form has not loaded yet. Wait a moment, then press Fill again.')
    return 'No form found.'
  }
  let pkg: AnswerPackage
  try {
    pkg = await ask<AnswerPackage>({ kind: 'package', pageUrl: location.href, questions: questionsOf(fields) })
  } catch (error) {
    showMessage('jobfinder could not prepare this one', (error as Error).message)
    return (error as Error).message
  }
  const wantsCover = fields.some((field) => field.kind === 'file' && /cover/i.test(field.label))
  const [resume, coverLetter] = await Promise.all([
    ask<FileData>({ kind: 'file', download: pkg.resume.download, fileName: pkg.resume.fileName }).catch(() => null),
    wantsCover
      ? ask<FileData>({ kind: 'file', download: pkg.coverLetter.download, fileName: pkg.coverLetter.fileName }).catch(
          () => null,
        )
      : Promise.resolve(null),
  ])
  injectHighlight()
  const report = fillForm(fields, pkg, { resume, coverLetter }, document)
  // Ashby can re-render a field after it changes; look again a moment later.
  await new Promise((resolve) => setTimeout(resolve, 700))
  const dropped = droppedValues(report, fields)
  showReview(pkg, report, dropped)
  watchForConfirmation(pkg)
  return `Filled ${report.filled.length}, left ${report.skipped.length} for you. Submit is untouched.`
}

chrome.runtime.onMessage.addListener(
  (message: { kind: string }, sender, sendResponse: (reply: Reply<string>) => void) => {
    if (sender.id !== chrome.runtime.id || message.kind !== 'fill') return false
    fill().then(
      (value) => sendResponse({ ok: true, value }),
      (error: Error) => sendResponse({ ok: false, error: error.message }),
    )
    return true
  },
)
