/**
 * robots.txt, read the way RFC 9309 says.
 *
 * - The group for our product token wins over `*`.
 * - The longest matching rule wins; on a tie, Allow wins.
 * - `*` matches any run of characters and `$` anchors the end.
 * - A 4xx robots.txt means "no rules"; a 5xx or unreachable one means
 *   "assume everything is disallowed" (the caller decides that, not the parser).
 *
 * `Content-Signal` lines (used by some hosts) are kept: `ai-input=no` tells
 * the tailor not to send that host's descriptions to a model.
 */

type Rule = { allow: boolean; path: string }

export type Robots = {
  isAllowed(path: string): boolean
  contentSignals: Record<string, string>
}

export const ALLOW_ALL: Robots = { isAllowed: () => true, contentSignals: {} }
export const DISALLOW_ALL: Robots = { isAllowed: () => false, contentSignals: {} }

function toRegex(path: string): RegExp {
  const anchored = path.endsWith('$')
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

export function parseRobots(text: string, productToken: string): Robots {
  const groups = new Map<string, Rule[]>()
  const contentSignals: Record<string, string> = {}
  let agents: string[] = []
  let lastWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (!lastWasAgent) agents = []
      agents.push(value.toLowerCase())
      for (const agent of agents) if (!groups.has(agent)) groups.set(agent, [])
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue
      for (const agent of agents) groups.get(agent)!.push({ allow: key === 'allow', path: value })
    } else if (key === 'content-signal') {
      for (const pair of value.split(',')) {
        const [name, setting] = pair.split('=').map((part) => part.trim().toLowerCase())
        if (name && setting) contentSignals[name] = setting
      }
    }
  }

  const rules = groups.get(productToken.toLowerCase()) ?? groups.get('*') ?? []
  const compiled = rules.map((rule) => ({ ...rule, regex: toRegex(rule.path) }))
  return {
    contentSignals,
    isAllowed(path) {
      let best: { allow: boolean; length: number } | null = null
      for (const rule of compiled) {
        if (!rule.regex.test(path)) continue
        const length = rule.path.length
        if (!best || length > best.length || (length === best.length && rule.allow))
          best = { allow: rule.allow, length }
      }
      return best ? best.allow : true
    },
  }
}
