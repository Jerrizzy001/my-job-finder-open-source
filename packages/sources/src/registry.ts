import { ashby } from './adapters/ashby.ts'
import { greenhouse } from './adapters/greenhouse.ts'
import { lever } from './adapters/lever.ts'
import type { Adapter, SourceKey } from './types.ts'

export const ADAPTERS: Readonly<Partial<Record<SourceKey, Adapter<never>>>> = {
  greenhouse,
  lever,
  ashby,
} as Partial<Record<SourceKey, Adapter<never>>>

export function adapterFor(source: SourceKey): Adapter<unknown> {
  const adapter = ADAPTERS[source] as Adapter<unknown> | undefined
  if (!adapter) throw new Error(`No adapter for source "${source}".`)
  return adapter
}

export const SOURCE_KEYS = Object.keys(ADAPTERS) as SourceKey[]
