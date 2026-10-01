/**
 * A tiny property-test helper: a seeded generator, so a failure prints a seed
 * that reproduces it. No dependency; enough for the marker properties.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

/** Run `check` for `runs` generated cases; the message names the seed and case. */
export function forAll<T>(runs: number, generate: (random: () => number) => T, check: (value: T) => void, seed = 20261001): void {
  const random = rng(seed)
  for (let run = 0; run < runs; run++) {
    const value = generate(random)
    try {
      check(value)
    } catch (error) {
      throw new Error(`property failed (seed ${seed}, run ${run}) for ${JSON.stringify(value)}: ${(error as Error).message}`)
    }
  }
}
