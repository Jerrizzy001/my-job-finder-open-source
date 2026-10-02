# Changelog

## 0.1.0 (unreleased)

First release.

- Matching engine: title families, one student level, related titles decided by their description, hard rules for place, remote region, work mode, blocks and co-op term vs graduation, 0–100 scores with reasons, optional model assist under the rules' ceiling, policy versions pinned by hash.
- Discovery from Greenhouse, Lever, Ashby, Workable, iCIMS, Workday, Dayforce, SmartRecruiters and JSON-LD career pages, through one polite runner with robots.txt, per-host delay, backoff and budgets; list first, with a reserved budget for detail reads.
- A 23-board example catalog and `scripts/validate-boards.ts`.
- Local drafting with a no-invention verifier, an OpenAI-compatible client (Ollama, LM Studio, OpenAI), a built-in PDF writer, and a per-run draft cap with a token and cost log.
- The local server (127.0.0.1 only) and UI: Jobs, Preferences, Profile & answers.
- The Ashby extension with the review-before-submit stop.
- CLI: `init`, `discover`, `match`, `tailor`, `run`, `serve`, `boards`, `export --csv`.
