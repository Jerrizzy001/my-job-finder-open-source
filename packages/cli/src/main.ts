import { commands, usage } from './commands.ts'

const [name, ...rest] = process.argv.slice(2)
const command = name ? commands[name] : undefined

if (!command) {
  console.log(usage)
  process.exit(name && name !== 'help' && name !== '--help' ? 2 : 0)
}

try {
  await command(rest)
} catch (error) {
  console.error(`jobfinder ${name}: ${(error as Error).message}`)
  if (process.env.JOBFINDER_DEBUG) console.error(error)
  process.exit(1)
}
