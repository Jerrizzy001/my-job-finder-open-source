# Contributing

Thank you for helping. Small, focused pull requests with plain-English titles are easiest to review.

## Set up

```bash
npm install
npm test            # unit, fixture and API tests
npm run typecheck
npm run lint
npm run leak-check  # must pass: no hostnames, keys, tokens or personal data
```

Node 22.18 or newer. There is no build step for the CLI or server; `npm run build:web` and `npm run build:extension` build the UI and the extension.

## Ground rules

- Keep each package understandable on its own. `packages/core` does no I/O.
- Changing matching behaviour (anything in `packages/core/src`) means bumping `MATCHING_POLICY_VERSION` and re-pinning: `node scripts/pin-policy.ts` prints the hash for `packages/core/test/policy.test.ts`. Add or change a row in `acceptance.test.ts` that shows the new behaviour, and run `npm run bench`.
- Fixtures are real response _shapes_ with the prose replaced, the hosts renamed and nothing personal in them. Never commit a real person's data.
- The ethics rules in [docs/ethics.md](docs/ethics.md) are not up for negotiation in this repository: no submitting, no CAPTCHA handling, no account creation, no disguised clients, no private APIs.

## Add an adapter in 30 minutes

1. **Look (5 min).** Find the board's public, keyless JSON or page, and read its robots.txt. If robots.txt disallows it, stop here: the runner will refuse it anyway.
2. **Record a fixture (5 min).** Save one real list response (and one detail response if the list has no descriptions) under `packages/sources/test/fixtures/`. Keep three or four postings, replace descriptions with a synthetic paragraph, rename the tenant to `acme`, and run `npm run leak-check`.
3. **Write the adapter (10 min).** Copy `packages/sources/src/adapters/greenhouse.ts` (a list with descriptions) or `smartrecruiters.ts` (list first, then details). Declare `allowedHosts`, build requests with `http.json` or `http.request`, and map each raw item in `normalize`. Do not call `fetch`; do not set headers beyond the two the runner allows (`cookie`, `x-csrf-token`).
4. **Register it (1 min).** Add the key to `SourceKey` in `types.ts`, the adapter to `registry.ts`, and the source to the catalog parser's list in `catalog.ts`.
5. **Test it (8 min).** In `packages/sources/test/`, run it through `runBoard` with `fakeFetch` and `fakeClock`: the postings it normalises, its paging, what a 404 does, and, for list-first boards, that only selected postings are read in detail.
6. **Document it (1 min).** A row in [docs/adapters.md](docs/adapters.md) and an example entry in `examples/catalog.more.yaml`.

Then `npm test && npm run lint && npm run typecheck`, and open the pull request.

## Commits

Plain-English titles that say what changed for a user ("Workday boards are searched term by term"). No generated-by or co-author trailers for tools.
