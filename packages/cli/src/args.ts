/**
 * A small, strict flag parser. `known` lists the options: `"all"` is a
 * switch, `"limit="` takes a value (`--limit 5` or `--limit=5`).
 */
export type Parsed = { flags: Record<string, string | true>; positional: string[] }

export function parseArgs(argv: readonly string[], known: readonly string[]): Parsed {
  const flags: Record<string, string | true> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const equals = arg.indexOf('=')
    const name = arg.slice(2, equals < 0 ? undefined : equals)
    const inline = equals < 0 ? undefined : arg.slice(equals + 1)
    if (known.includes(`${name}=`)) {
      const value = inline ?? argv[++i]
      if (value === undefined) throw new Error(`--${name} needs a value.`)
      flags[name] = value
    } else if (known.includes(name)) {
      if (inline !== undefined) throw new Error(`--${name} takes no value.`)
      flags[name] = true
    } else throw new Error(`Unknown option --${name}.`)
  }
  return { flags, positional }
}

export function intFlag(flags: Parsed['flags'], name: string, fallback: number): number {
  const value = flags[name]
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a whole number.`)
  return number
}
