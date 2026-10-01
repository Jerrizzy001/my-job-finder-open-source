#!/usr/bin/env node
// Runs the TypeScript CLI directly (Node 22.18+ strips types natively).
// Node's built-in SQLite still prints an "experimental" warning; hide only that one.
const emitWarning = process.emitWarning
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '')
  if (/SQLite is an experimental feature|Type Stripping is an experimental feature/.test(text)) return
  return emitWarning.call(process, warning, ...rest)
}
await import('../src/main.ts')
