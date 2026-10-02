import { atsOf, HOSTED_URL, isAshbyApplication, type Reply } from './shared.ts'

/**
 * The popup: connection settings, and one button on an Ashby application.
 * Other application pages get a plain pointer to the hosted guided apply.
 */

const main = document.getElementById('main')!
const NAMES: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  dayforce: 'Dayforce',
  icims: 'iCIMS',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
}

function p(text: string, className?: string): HTMLParagraphElement {
  const node = document.createElement('p')
  node.textContent = text
  if (className) node.className = className
  return node
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply: Reply<T> | undefined) => {
      if (chrome.runtime.lastError || !reply)
        return reject(new Error(chrome.runtime.lastError?.message ?? 'No answer.'))
      if (reply.ok) resolve(reply.value)
      else reject(new Error(reply.error))
    })
  })
}

async function render() {
  main.replaceChildren()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  const ats = atsOf(url)

  if (ats === 'ashby' && isAshbyApplication(url)) {
    main.append(
      p(
        'Fills this application from your local profile, vault and tailored resume, then stops so you can review it. You press Submit.',
      ),
    )
    const button = document.createElement('button')
    button.className = 'primary'
    button.textContent = 'Fill this application'
    const status = p('', 'muted')
    status.setAttribute('role', 'status')
    button.addEventListener('click', async () => {
      button.disabled = true
      status.textContent = 'Filling…'
      try {
        const result = await new Promise<string>((resolve, reject) =>
          chrome.tabs.sendMessage(tab!.id!, { kind: 'fill' }, (reply: Reply<string> | undefined) => {
            if (chrome.runtime.lastError || !reply) return reject(new Error('Reload the page, then try again.'))
            if (reply.ok) resolve(reply.value)
            else reject(new Error(reply.error))
          }),
        )
        status.textContent = result
        status.className = 'ok'
      } catch (error) {
        status.textContent = (error as Error).message
        status.className = 'err'
      } finally {
        button.disabled = false
      }
    })
    main.append(button, status)
  } else if (ats === 'ashby') {
    main.append(p('Open the Application tab of this posting, then press Fill.'))
  } else if (ats) {
    main.append(p(`This is a ${NAMES[ats]} application. The open-source extension fills Ashby forms only.`))
    const link = document.createElement('a')
    link.className = 'btn'
    link.href = HOSTED_URL
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = 'Open in My Job Finder for guided apply'
    main.append(link)
  } else {
    main.append(p('Open an Ashby application page (jobs.ashbyhq.com/…/application) to fill it.', 'muted'))
  }

  try {
    await send({ kind: 'ping' })
  } catch (error) {
    main.append(p((error as Error).message, 'err'))
    ;(document.getElementById('settings') as HTMLDetailsElement).open = true
  }
}

async function loadSettings() {
  const stored = (await chrome.storage.local.get(['port', 'token'])) as { port?: number; token?: string }
  ;(document.getElementById('port') as HTMLInputElement).value = String(stored.port ?? 4321)
  ;(document.getElementById('token') as HTMLInputElement).value = stored.token ?? ''
}

document.getElementById('settings-form')!.addEventListener('submit', async (event) => {
  event.preventDefault()
  const port = Number((document.getElementById('port') as HTMLInputElement).value) || 4321
  const token = (document.getElementById('token') as HTMLInputElement).value.trim()
  await chrome.storage.local.set({ port, token })
  const status = document.getElementById('settings-status')!
  try {
    await send({ kind: 'ping' })
    status.textContent = 'Connected.'
    status.className = 'ok'
  } catch (error) {
    status.textContent = (error as Error).message
    status.className = 'err'
  }
  void render()
})

void loadSettings().then(render)
