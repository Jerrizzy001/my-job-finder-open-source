# @jobfinder/server

The local service: SQLite through `node:sqlite` with forward-only migrations, discovery with a run ledger and auto-pause, matching with policy versions and scoring revisions, drafts, answer packages, and the HTTP API on 127.0.0.1.

| Route                                                                    |                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `GET /api/jobs?stage=for_you\|drafted\|applied\|pending\|dismissed\|all` | current matches with reasons                                    |
| `GET /api/jobs/:id`                                                      | one job, its description and drafts                             |
| `POST /api/jobs/:id/tailor`                                              | draft for one job                                               |
| `POST /api/jobs/:id/prepare`                                             | an answer package (`questions` in, answers or `needs_user` out) |
| `POST /api/jobs/:id/dismiss`, `/restore`, `/applied`                     | thumbs-down (teaches `rejectedTitles`), undo, mark applied      |
| `POST /api/discover/run`, `GET /api/discover/status`                     | read boards now                                                 |
| `GET/POST /api/preferences`, `/api/profile`, `/api/answers`              | your files and the vault                                        |
| `GET /api/runs`                                                          | the run ledger and board status                                 |
| `/api/ext/*`                                                             | extension routes; need the token `jobfinder serve` prints       |
