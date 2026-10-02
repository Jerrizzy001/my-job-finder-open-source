import { describe, expect, it } from 'vitest'
import { costUsd, llmConfigFromEnv, openAiCompatible } from '../src/index.ts'

describe('llmConfigFromEnv', () => {
  it('is null with nothing configured', () => {
    expect(llmConfigFromEnv({})).toBeNull()
  })

  it('reads an Ollama endpoint with no key', () => {
    expect(
      llmConfigFromEnv({ JOBFINDER_LLM_BASE_URL: 'http://127.0.0.1:11434/v1/', JOBFINDER_LLM_MODEL: 'llama3.1' }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: undefined,
      model: 'llama3.1',
    })
  })

  it('falls back to OpenAI when only OPENAI_API_KEY is set', () => {
    expect(llmConfigFromEnv({ OPENAI_API_KEY: 'test-key' })).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
    })
  })
})

describe('openAiCompatible', () => {
  it('posts a chat completion and reads text and usage', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const fetch = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      return Response.json({
        model: 'm',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      })
    }) as unknown as typeof globalThis.fetch
    const llm = openAiCompatible({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'm', apiKey: 'k' }, fetch)
    const result = await llm.complete({ system: 's', user: 'u', json: true })
    expect(result).toEqual({ text: '{"ok":true}', model: 'm', usage: { promptTokens: 12, completionTokens: 3 } })
    expect(sent!.url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    const body = JSON.parse(String(sent!.init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect((sent!.init.headers as Record<string, string>).authorization).toBe('Bearer k')
  })

  it('surfaces an endpoint error', async () => {
    const fetch = (async () =>
      Response.json({ error: { message: 'model not found' } }, { status: 404 })) as unknown as typeof globalThis.fetch
    await expect(
      openAiCompatible({ baseUrl: 'http://x/v1', model: 'm' }, fetch).complete({ system: '', user: '' }),
    ).rejects.toThrow(/404: model not found/)
  })
})

describe('costUsd', () => {
  it('is null without prices and computed with them', () => {
    expect(costUsd({ promptTokens: 1000, completionTokens: 1000 }, {})).toBeNull()
    expect(
      costUsd(
        { promptTokens: 1_000_000, completionTokens: 500_000 },
        { JOBFINDER_LLM_PRICE_INPUT_PER_M: '0.15', JOBFINDER_LLM_PRICE_OUTPUT_PER_M: '0.6' },
      ),
    ).toBeCloseTo(0.45)
  })
})
