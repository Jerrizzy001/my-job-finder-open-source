import type { AnswerPackage, AnsweredQuestion, FileData, FormQuestion } from './shared.ts'

/**
 * Reading and filling an Ashby application form.
 *
 * The rules, in code and not just in docs:
 * - nothing is ever clicked that submits: no submit buttons, no form submit,
 *   no Enter key; the only clicks are on a question's own Yes/No or radio option;
 * - a consent or terms checkbox is never ticked: agreeing is yours to do;
 * - a question with no answer from your profile or vault is left empty and listed;
 * - if a CAPTCHA or sign-in is on the page, nothing is filled at all.
 */

export type Field = {
  label: string
  required: boolean
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'yesno' | 'checkbox' | 'file' | 'combobox'
  elements: HTMLElement[]
  options: string[]
}

export type FillReport = {
  filled: { label: string; value: string }[]
  skipped: { label: string; reason: string }[]
}

export type Refusal = { reason: 'captcha' | 'login'; message: string }

const SUBMIT_TEXT = /\b(submit|apply|send application)\b/i
const CONSENT = /\b(consent|agree|acknowledge|terms|privacy|certify|attest)\b/i

function clean(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\*\s*$/, '')
    .trim()
}

/** A CAPTCHA or bot challenge the person must complete, or a sign-in wall. */
export function refusalFor(doc: Document): Refusal | null {
  const frames = [...doc.querySelectorAll('iframe')]
  const challenge = frames.some((frame) => {
    const src = frame.getAttribute('src') ?? ''
    const title = frame.getAttribute('title') ?? ''
    if (/recaptcha\/api2\/anchor.*size=invisible/i.test(src)) return false
    return (
      /hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|recaptcha\/(api2|enterprise)\/(anchor|bframe)/i.test(
        src,
      ) || /captcha challenge|recaptcha$/i.test(title)
    )
  })
  if (challenge || doc.querySelector('.h-captcha, .cf-turnstile, [data-hcaptcha-widget-id]'))
    return {
      reason: 'captcha',
      message:
        'This page has a CAPTCHA. Please complete it and submit the application yourself; the extension does not touch CAPTCHAs.',
    }
  if (doc.querySelector('input[type="password"]'))
    return { reason: 'login', message: 'This page asks you to sign in. Sign in, then press Fill again.' }
  return null
}

function labelFor(element: HTMLElement, doc: Document): string {
  const id = element.getAttribute('id')
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (label) return clean(label.textContent)
  }
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((ref) => doc.getElementById(ref)?.textContent ?? '')
      .join(' ')
    if (clean(text)) return clean(text)
  }
  const container = element.closest('fieldset, [class*="application-form-field-entry"], [class*="field"]')
  const heading = container?.querySelector('legend, label, [class*="question-title"]')
  if (heading) return clean(heading.textContent)
  return clean(
    element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? element.getAttribute('name'),
  )
}

function isRequired(element: HTMLElement, label: string, container: Element | null): boolean {
  return (
    element.hasAttribute('required') ||
    element.getAttribute('aria-required') === 'true' ||
    /\*\s*$/.test(container?.querySelector('label, legend, [class*="question-title"]')?.textContent ?? '') ||
    /\(required\)/i.test(label)
  )
}

function visible(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && element.type === 'file') return true
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return !!style && style.display !== 'none' && style.visibility !== 'hidden'
}

/** Every question on the form, grouped so a radio set or Yes/No pair is one field. */
export function scanForm(doc: Document): Field[] {
  const form = doc.querySelector('form') ?? doc.body
  const fields: Field[] = []
  const seenGroups = new Set<string>()

  for (const element of form.querySelectorAll<HTMLElement>('input, textarea, select, [role="combobox"]')) {
    if (
      element instanceof HTMLInputElement &&
      ['hidden', 'submit', 'button', 'image', 'reset', 'password'].includes(element.type)
    )
      continue
    if (!visible(element)) continue
    const container = element.closest('fieldset, [class*="application-form-field-entry"], [class*="field"]')
    const label = labelFor(element, doc)
    if (!label) continue
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const group = element.name || label
      if (seenGroups.has(group)) continue
      seenGroups.add(group)
      const radios = [
        ...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`),
      ]
      const groupLabel = clean(container?.querySelector('legend, [class*="question-title"]')?.textContent) || label
      fields.push({
        label: groupLabel,
        required: isRequired(element, groupLabel, container),
        kind: 'radio',
        elements: radios,
        options: radios.map((radio) => labelFor(radio, doc)),
      })
      continue
    }
    const kind: Field['kind'] =
      element instanceof HTMLTextAreaElement
        ? 'textarea'
        : element instanceof HTMLSelectElement
          ? 'select'
          : element.getAttribute('role') === 'combobox'
            ? 'combobox'
            : element instanceof HTMLInputElement && element.type === 'checkbox'
              ? 'checkbox'
              : element instanceof HTMLInputElement && element.type === 'file'
                ? 'file'
                : 'text'
    const options =
      element instanceof HTMLSelectElement
        ? [...element.options].map((option) => clean(option.textContent)).filter(Boolean)
        : []
    fields.push({ label, required: isRequired(element, label, container), kind, elements: [element], options })
  }

  // Ashby's Yes/No questions are two plain buttons inside the question.
  for (const container of form.querySelectorAll<HTMLElement>('[class*="application-form-field-entry"], fieldset')) {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')].filter((button) =>
      /^(yes|no)$/i.test(clean(button.textContent)),
    )
    if (buttons.length !== 2) continue
    const label = clean(container.querySelector('label, legend, [class*="question-title"]')?.textContent)
    if (!label || fields.some((field) => field.label === label)) continue
    fields.push({
      label,
      required: isRequired(buttons[0]!, label, container),
      kind: 'yesno',
      elements: buttons,
      options: ['Yes', 'No'],
    })
  }
  return fields
}

export function questionsOf(fields: readonly Field[]): FormQuestion[] {
  return fields
    .filter((field) => field.kind !== 'file')
    .map((field) => ({
      label: field.label,
      required: field.required,
      type: field.kind,
      ...(field.options.length ? { options: field.options } : {}),
    }))
}

/** Set a value the way typing does, so React-controlled inputs keep it. */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as object
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(element, value)
  else element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
}

function fileFrom(data: FileData, doc: Document): File {
  const bytes = Uint8Array.from(atob(data.base64), (char) => char.charCodeAt(0))
  const FileCtor = (doc.defaultView as (Window & typeof globalThis) | null)?.File ?? File
  return new FileCtor([bytes], data.fileName, { type: data.type })
}

export const FILLED_CLASS = 'jobfinder-filled'

function mark(element: HTMLElement) {
  element.classList.add(FILLED_CLASS)
}

/** The answer for a field, from the package. */
function answerFor(field: Field, answers: readonly AnsweredQuestion[]): AnsweredQuestion | undefined {
  return answers.find((answer) => answer.label === field.label)
}

export function fillForm(
  fields: readonly Field[],
  pkg: AnswerPackage,
  files: { resume: FileData | null; coverLetter: FileData | null },
  doc: Document,
): FillReport {
  const report: FillReport = { filled: [], skipped: [] }

  for (const field of fields) {
    if (field.kind === 'file') {
      const input = field.elements[0] as HTMLInputElement
      const isCover = /cover/i.test(field.label)
      const isResume = /resume|cv\b|curriculum/i.test(field.label)
      const data = isCover ? files.coverLetter : isResume ? files.resume : null
      if (!data) {
        report.skipped.push({
          label: field.label,
          reason: isCover || isResume ? 'The draft file could not be loaded.' : 'Not a resume or cover letter upload.',
        })
        continue
      }
      const transfer = new DataTransfer()
      transfer.items.add(fileFrom(data, doc))
      input.files = transfer.files
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      mark((input.closest('[class*="field"]') as HTMLElement) ?? input)
      report.filled.push({ label: field.label, value: data.fileName })
      continue
    }

    if (field.kind === 'checkbox' && CONSENT.test(field.label)) {
      report.skipped.push({ label: field.label, reason: 'Agreeing is yours to do. Read it and tick it yourself.' })
      continue
    }
    if (field.kind === 'combobox') {
      report.skipped.push({ label: field.label, reason: 'A search-as-you-type field. Choose it yourself.' })
      continue
    }

    const isCoverText = field.kind === 'textarea' && /cover letter/i.test(field.label)
    const answer = isCoverText ? { status: 'answered', answer: pkg.coverLetter.text } : answerFor(field, pkg.questions)
    if (!answer || answer.status !== 'answered' || answer.answer === null) {
      report.skipped.push({
        label: field.label,
        reason: field.required
          ? 'Required, and not in your profile or vault. Answer it in the vault (or here), then Fill again.'
          : 'No answer in your profile or vault.',
      })
      continue
    }
    const value = answer.answer

    if (field.kind === 'text' || field.kind === 'textarea') {
      const input = field.elements[0] as HTMLInputElement | HTMLTextAreaElement
      if (input.value.trim() && input.value.trim() !== value.trim()) {
        report.skipped.push({ label: field.label, reason: 'Already has a different value; left as you had it.' })
        continue
      }
      setNativeValue(input, value)
      mark(input)
      report.filled.push({ label: field.label, value })
    } else if (field.kind === 'select') {
      const select = field.elements[0] as HTMLSelectElement
      const option = [...select.options].find((o) => clean(o.textContent).toLowerCase() === value.trim().toLowerCase())
      if (!option) {
        report.skipped.push({ label: field.label, reason: `Your answer "${value}" is not one of the choices.` })
        continue
      }
      setNativeValue(select, option.value)
      mark(select)
      report.filled.push({ label: field.label, value: clean(option.textContent) })
    } else if (field.kind === 'radio' || field.kind === 'yesno' || field.kind === 'checkbox') {
      const target =
        field.kind === 'checkbox'
          ? /^(yes|true)$/i.test(value)
            ? field.elements[0]
            : undefined
          : field.elements.find(
              (element, index) =>
                (field.options[index] ?? clean(element.textContent)).toLowerCase() === value.trim().toLowerCase(),
            )
      if (!target) {
        report.skipped.push({ label: field.label, reason: `Your answer "${value}" is not one of the choices.` })
        continue
      }
      // A question's own option, never anything that submits.
      if (
        target instanceof HTMLButtonElement &&
        (target.type !== 'button' || SUBMIT_TEXT.test(clean(target.textContent)))
      ) {
        report.skipped.push({ label: field.label, reason: 'Refused: that control looks like it submits.' })
        continue
      }
      if (!(target instanceof HTMLInputElement && target.checked)) target.click()
      mark(target)
      report.filled.push({ label: field.label, value })
    }
  }
  return report
}

/** Values the page dropped after filling (Ashby can re-render a field). */
export function droppedValues(report: FillReport, fields: readonly Field[]): string[] {
  const dropped: string[] = []
  for (const entry of report.filled) {
    const field = fields.find((f) => f.label === entry.label)
    if (!field || (field.kind !== 'text' && field.kind !== 'textarea')) continue
    const input = field.elements[0] as HTMLInputElement
    if (!input.isConnected || input.value.trim() !== entry.value.trim()) dropped.push(entry.label)
  }
  return dropped
}

/** Ashby's confirmation after a submit: unambiguous enough to record. */
export function looksSubmitted(doc: Document): boolean {
  const text = clean(doc.body?.innerText ?? doc.body?.textContent)
  return (
    /thank you for applying|application (?:was |has been )?(?:successfully )?submitted|we(?:'|’)ve received your application/i.test(
      text,
    ) && !doc.querySelector('form [type="submit"]')
  )
}
