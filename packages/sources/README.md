# @jobfinder/sources

Discovery adapters for public ATS boards, behind one bounded runner. See [docs/adapters.md](../../docs/adapters.md).

```ts
import { runBoard } from '@jobfinder/sources'

const result = await runBoard(
  { company: 'Acme', source: 'greenhouse', token: 'acme' },
  { select: (job) => /engineer/i.test(job.title) },
)
// result.outcome, result.jobs (selected), result.seen, result.requests
```
