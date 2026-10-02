# @jobfinder/core

The matching engine. Pure TypeScript, no I/O, no dependencies. Read it in this order:

| File                             | What it decides                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/text.ts`                    | How every title is read: lower case, punctuation as spaces, "front-end" as "frontend", "co-op" as "coop", synonyms ("engineer" = "developer"). |
| `src/student.ts`                 | Student markers are one level, and "Student Success Manager" is not one.                                                                       |
| `src/families.ts`                | The kind of work a title names, by ordered recognisers, and which families a search reaches.                                                   |
| `src/titles.ts`                  | The tiers: `exact → close → family → related → none`, levels, exclusions.                                                                      |
| `src/evidence.ts`                | What a description says the work is; how a `related` title is decided.                                                                         |
| `src/location.ts`, `src/term.ts` | Places, remote regions, work modes; co-op terms against graduation.                                                                            |
| `src/rules.ts`                   | Hard rules, each failure with a code and a sentence.                                                                                           |
| `src/score.ts`                   | Points, ceilings, penalties, reasons.                                                                                                          |
| `src/evaluate.ts`                | The whole idea in one function.                                                                                                                |
| `src/llm.ts`, `src/policy.ts`    | Optional model assist under the rules' ceiling; the policy version.                                                                            |

```ts
import { evaluateJob } from '@jobfinder/core'

const result = evaluateJob(
  {
    title: 'Software Developer, Work Term',
    company: 'Acme',
    location: 'Toronto, ON',
    workplaceType: null,
    description: null,
    url: '',
    source: 'greenhouse',
  },
  { roleTitles: ['Software developer intern'], locations: ['Toronto'], graduation: '2027-04' },
)
// result.status === 'eligible', result.title.tier === 'exact', result.reasons explain the score
```

The tests are the spec: `test/acceptance.test.ts` is 72 titles against four searches, `test/student.test.ts` has property tests for the markers, and `test/policy.test.ts` pins the rules' hash to `MATCHING_POLICY_VERSION`.
