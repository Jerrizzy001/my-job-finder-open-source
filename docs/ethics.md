# Ethics

What this project will and will not do, and where in the code each promise is kept.

## Reading boards

| Promise                                                                                   | Where                                                      |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| An honest User-Agent with a contact URL; never a browser's                                | `USER_AGENT` in `packages/sources/src/http.ts`             |
| robots.txt fetched and honoured, our token's group before `*`                             | `parseRobots`, `BoundedHttp.robotsFor`                     |
| At least one second between requests to one host, across all boards                       | `Politeness`, `BoundedHttp.waitTurn`                       |
| Back off on 429/503 (Retry-After, or ten minutes); never retry in a loop                  | `BoundedHttp.request`; boards are re-read on their cadence |
| Only the hosts a board declares; https only; three redirects at most                      | `BoundedHttp.checkUrl`                                     |
| A request and byte budget for every run                                                   | `DEFAULT_LIMITS`                                           |
| Public, keyless endpoints only; nothing behind a login                                    | every adapter; none sends credentials                      |
| A host that says `Content-Signal: ai-input=no` never has its descriptions sent to a model | `runner.ts` marks the jobs, `tailor.ts` withholds the text |

Board harvesting at scale, discovering thousands of boards, is deliberately not part of this repository.

## Applying

The extension is human-in-the-loop only:

- It acts when you press **Fill**, on the page you are looking at. No background automation, no queues, no autonomous mode.
- It never presses Submit, never submits a form, and never sends an Enter key. `packages/extension/test/extension.test.ts` fails the build if the source ever does.
- It refuses pages with a CAPTCHA or bot challenge ("please complete and submit yourself") and pages that ask you to sign in.
- It never ticks a consent or terms box: agreeing is yours to do.
- It never makes up an answer. A question that is not in your profile or answer vault is left empty and listed.
- It never spoofs a user agent, fingerprint or typing rhythm.

## Your data

Everything stays in your folder: plain files you edit, and one SQLite file. There is no telemetry and nothing phones home. The only network traffic is to the boards in your catalog and, if you configure one, the model endpoint you chose (which can be Ollama on your own machine).

The local server listens on 127.0.0.1 only. It checks the Host header (against DNS rebinding), refuses cross-origin writes, sends no CORS headers, and requires the extension's token on the extension's routes.

## Facts about you

Drafts are built only from your master resume and profile. They may select, reorder and rephrase; they may not add an employer, title, degree, skill, metric, number or date. `packages/tailor/src/verify.ts` checks every name, number and date in a draft against your sources (the job description is deliberately not a source) and a draft that fails is discarded and replaced by the untailored package.
