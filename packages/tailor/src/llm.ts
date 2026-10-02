/**
 * One function to talk to a model: `complete({ system, user, json })`.
 *
 * Any OpenAI-compatible chat endpoint works:
 *   - Ollama (free, local):  JOBFINDER_LLM_BASE_URL=http://127.0.0.1:11434/v1  JOBFINDER_LLM_MODEL=llama3.1
 *   - LM Studio (local):     JOBFINDER_LLM_BASE_URL=http://127.0.0.1:1234/v1
 *   - OpenAI:                JOBFINDER_LLM_BASE_URL=https://api.openai.com/v1  JOBFINDER_LLM_API_KEY=...
 *
 * With nothing configured, there is no model, and the tailor says so.
 */

export type CompleteInput = { system: string; user: string; json?: boolean }
export type Usage = { promptTokens: number; completionTokens: number }
export type Completion = { text: string; usage: Usage; model: string }

export interface Llm {
  readonly model: string
  complete(input: CompleteInput): Promise<Completion>
}

export type LlmConfig = { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number }

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const baseUrl = env.JOBFINDER_LLM_BASE_URL?.trim() || (env.OPENAI_API_KEY ? 'https://api.openai.com/v1' : '')
  if (!baseUrl) return null
  const apiKey = env.JOBFINDER_LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined
  const model = env.JOBFINDER_LLM_MODEL?.trim() || (baseUrl.includes('api.openai.com') ? 'gpt-4o-mini' : 'llama3.1')
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

export function openAiCompatible(config: LlmConfig, fetchImpl: typeof fetch = fetch): Llm {
  return {
    model: config.model,
    async complete({ system, user, json }) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 180_000)
      try {
        const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
        })
        const body = (await response.json().catch(() => null)) as {
          choices?: { message?: { content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          model?: string
          error?: { message?: string }
        } | null
        if (!response.ok)
          throw new Error(`Model endpoint answered ${response.status}: ${body?.error?.message ?? 'no detail'}`)
        const text = body?.choices?.[0]?.message?.content
        if (typeof text !== 'string') throw new Error('Model endpoint returned no message.')
        return {
          text,
          model: body?.model ?? config.model,
          usage: {
            promptTokens: body?.usage?.prompt_tokens ?? 0,
            completionTokens: body?.usage?.completion_tokens ?? 0,
          },
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Cost from per-million-token prices in the environment, when set. */
export function costUsd(usage: Usage, env: Record<string, string | undefined> = process.env): number | null {
  const input = Number(env.JOBFINDER_LLM_PRICE_INPUT_PER_M)
  const output = Number(env.JOBFINDER_LLM_PRICE_OUTPUT_PER_M)
  if (!Number.isFinite(input) || !Number.isFinite(output) || !env.JOBFINDER_LLM_PRICE_INPUT_PER_M) return null
  return (usage.promptTokens * input + usage.completionTokens * output) / 1_000_000
}
