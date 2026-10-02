/** The few chrome.* APIs this extension uses, typed by hand (no @types/chrome dependency). */
declare namespace chrome {
  namespace runtime {
    const id: string
    const lastError: { message?: string } | undefined
    type MessageSender = { id?: string; tab?: { id?: number; url?: string } }
    function sendMessage(message: unknown, callback?: (response: never) => void): void
    const onMessage: {
      addListener<M, R>(
        callback: (message: M, sender: MessageSender, sendResponse: (response: R) => void) => boolean | void,
      ): void
    }
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
    }
  }
  namespace tabs {
    type Tab = { id?: number; url?: string }
    function query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]>
    function sendMessage(tabId: number, message: unknown, callback?: (response: never) => void): void
  }
}
