# Adapters

An adapter teaches the runner one ATS. It builds requests and parses answers; the runner (`packages/sources/src/runner.ts`) owns the budget, delays, robots.txt and the host allowlist, so an adapter cannot misbehave even if it tries.

## The interface

```ts
interface Adapter<Raw> {
  source: SourceKey
  listHasDescriptions: boolean // false → selected postings are hydrated
  allowedHosts(board): string[] // everything else is refused
  discoverPage(
    { board, cursor, searchTerms, remainingItems },
    http,
  ): Promise<{ items: Raw[]; nextCursor: string | null }>
  normalize(raw, board): SourcedJob | null
  hydrate?(job, board, http): Promise<SourcedJob | null> // null = the posting is gone
}
```

`http.request` and `http.json` are the only way out. `http.json` maps 404 to `source_not_found` and 410 to `gone`.

## The adapters that ship

| Source          | Endpoint                                                                              | List has descriptions                           | Notes                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse      | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`                    | yes                                             | Content arrives entity-encoded.                                                                                                                     |
| Lever           | `GET api.lever.co/v0/postings/{company}?mode=json&skip&limit`                         | yes                                             | `host: api.eu.lever.co` for EU boards.                                                                                                              |
| Ashby           | `GET api.ashbyhq.com/posting-api/job-board/{org}`                                     | yes                                             | Unlisted postings skipped.                                                                                                                          |
| Workable        | `GET apply.workable.com/api/v1/widget/accounts/{account}?details=true`                | yes                                             |                                                                                                                                                     |
| Dayforce        | `GET jobs.dayforcehcm.com/api/auth/csrf`, then `POST /api/geo/{ns}/jobposting/search` | yes                                             | See below.                                                                                                                                          |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings`, detail per posting          | no                                              | Blocked by its robots.txt today; see below.                                                                                                         |
| iCIMS           | `GET {tenant}.icims.com/sitemap.xml`, then each page `?in_iframe=1`                   | no                                              | Titles come from URL slugs until the page's JSON-LD is read. Login, candidate and referral paths are never requested. A 404 or 410 page means gone. |
| Workday         | `POST {host}/wday/cxs/{tenant}/{site}/jobs`, then `GET …/job/{path}`                  | no                                              | Searched term by term with your titles; cursor `term:offset:total`.                                                                                 |
| JSON-LD         | the careers page in `url`, then each job link                                         | no (unless the page itself has JobPosting data) | `linkPattern` overrides the default job-link pattern.                                                                                               |

**Dayforce, honestly.** Its search endpoint wants the CSRF token that any visitor's browser fetches from `/api/auth/csrf`, sent back with the cookie it comes with. That is a CSRF token on a public endpoint, not a login and not an auth bypass: no account, no session, nothing hidden. A tenant that answers with a bot challenge simply fails the run.

**SmartRecruiters, honestly.** As of October 2026, `api.smartrecruiters.com/robots.txt` allows only LinkedInBot. The runner honours that, so a SmartRecruiters board reports `blocked_by_robots` and is paused after three runs. The adapter stays so it works if that changes; it is tested against a synthetic fixture, because recording a live one would mean ignoring the robots.txt.

## Run outcomes

`complete_full` (the whole board was read; postings no longer listed are closed), `complete_partial` (budget reached, or a later page failed; nothing is closed), `rate_limited`, `source_not_found`, `blocked_by_robots`, `source_error`. Three failures in a row (rate limits excepted) pause a board; `jobfinder boards` shows why.

## Add a board

Add it to `catalog.yaml`, then check it:

```bash
node scripts/validate-boards.ts my-candidates.yaml catalog.yaml
```

It probes each candidate with a few requests, keeps the live ones, and records their job counts and sample titles. [`examples/catalog.more.yaml`](../examples/catalog.more.yaml) shows an entry for every source.

## Add an adapter

[CONTRIBUTING.md](../CONTRIBUTING.md#add-an-adapter-in-30-minutes) walks through it.
