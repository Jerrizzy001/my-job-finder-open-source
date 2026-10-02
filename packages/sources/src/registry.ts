import { ashby } from './adapters/ashby.ts'
import { dayforce } from './adapters/dayforce.ts'
import { greenhouse } from './adapters/greenhouse.ts'
import { icims } from './adapters/icims.ts'
import { jsonld } from './adapters/jsonld.ts'
import { lever } from './adapters/lever.ts'
import { smartrecruiters } from './adapters/smartrecruiters.ts'
import { workable } from './adapters/workable.ts'
import { workday } from './adapters/workday.ts'
import type { Adapter, SourceKey } from './types.ts'

export const ADAPTERS: Readonly<Record<SourceKey, Adapter<never>>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  icims,
  workday,
  dayforce,
  jsonld,
} as Record<SourceKey, Adapter<never>>

export function adapterFor(source: SourceKey): Adapter<unknown> {
  const adapter = ADAPTERS[source] as Adapter<unknown> | undefined
  if (!adapter) throw new Error(`No adapter for source "${source}".`)
  return adapter
}

export const SOURCE_KEYS = Object.keys(ADAPTERS) as SourceKey[]
