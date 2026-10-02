import type { AnswerPackage, FileData, Message, Reply, Settings } from './shared.ts'

/**
 * The only part that makes network requests, and only to your own
 * jobfinder on 127.0.0.1 with the token you pasted. Nothing else, ever.
 */

async function settings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(['port', 'token'])) as Partial<Settings>
  if (!stored.token) throw new Error('Paste the token that "jobfinder serve" printed into the extension popup first.')
  return { port: Number(stored.port) || 4321, token: stored.token }
}

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const { port, token } = await settings()
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new Error(`jobfinder is not running on port ${port}. Start it with "jobfinder serve".`)
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `jobfinder answered ${response.status}.`)
  }
  return response
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function handle(message: Message): Promise<unknown> {
  switch (message.kind) {
    case 'ping':
      return (await call('/api/ext/ping')).json()
    case 'package':
      return (
        await call('/api/ext/package', { body: { pageUrl: message.pageUrl, questions: message.questions } })
      ).json() as Promise<AnswerPackage>
    case 'file': {
      if (!/^\/api\/ext\/files\/\d+\/(resume|cover-letter)\.pdf$/.test(message.download))
        throw new Error('Refused: not a draft file.')
      const response = await call(message.download)
      return {
        fileName: message.fileName,
        type: 'application/pdf',
        base64: toBase64(await response.arrayBuffer()),
      } satisfies FileData
    }
    case 'submitted':
      return (await call('/api/ext/submitted', { body: { jobId: message.jobId } })).json()
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse: (reply: Reply<unknown>) => void) => {
  // Only this extension's own popup and page script may ask.
  if (sender.id !== chrome.runtime.id) return false
  handle(message).then(
    (value) => sendResponse({ ok: true, value }),
    (error: Error) => sendResponse({ ok: false, error: error.message }),
  )
  return true
})
