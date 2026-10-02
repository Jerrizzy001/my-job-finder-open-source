import { droppedValues, fillForm, FILLED_CLASS, looksSubmitted, questionsOf, refusalFor, scanForm } from './form.ts'
import { el, render, showMessage, showReview } from './panel.ts'
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

let watching: MutationObserver | null = null

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
  showReview(pkg, report, dropped, () => void record(pkg))
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
