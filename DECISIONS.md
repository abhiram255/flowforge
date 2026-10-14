# FlowForge — Decisions, Conventions and Open Questions

This file is the engineering log for the project: environment facts, the decisions behind the code,
the conventions to follow when extending it, and everything that is still open or unverified.

---

## Environment (this machine)

| Item | Value |
| --- | --- |
| OS | Windows 11 (win32 x64) |
| Node / npm | v22.17.1 / 11.15.0 |
| MongoDB | 8.2.4, local service on `127.0.0.1:27017` |
| Redis | 7.4.11 via `docker compose up -d redis` during the scalability pass; without it the graceful in-process fallback path is what runs in dev/tests |
| Docker | Docker Desktop 29.1 + Compose v2.40; daemon is available, `docker compose up -d redis` is what the experiments use — image builds are still exercised in CI rather than locally |
| Shell quirk | `NODE_ENV=production` is set globally on this machine → `npm install` must use `--include=dev`; every project script pins its own `NODE_ENV` via `cross-env` so this cannot leak into dev/test/benchmark runs |

## Commands and ports

```bash
npm run dev        # API :4000 + web :5173 (concurrently)
npm run build      # tsup (API) → apps/api/dist, vite (web) → apps/web/dist
npm run typecheck  # strict TypeScript across all workspaces
npm test           # 66 API integration + 16 web unit tests (needs MongoDB)
npm run seed       # demo data (idempotent; SEED_RESET=true to wipe)
npm run bench      # MongoDB explain + latency benchmark → docs/benchmark-results.json
npm run load       # autocannon smoke → docs/load-smoke-results.json (RATE_LIMIT_DISABLED=true)
npm run exp:1 …6   # six scalability experiments → docs/experiments/*.json (docs/SCALABILITY_EXPERIMENTS.md)
npm run e2e        # Playwright; boots a seeded API (flowforge_e2e) + Vite
```

MongoDB databases: `flowforge_dev` (dev/seed), `flowforge_test` (integration tests), `flowforge_e2e`
(Playwright), `flowforge_bench` / `flowforge_load` (benchmarks, dropped afterwards).

## Conventions

- **Contract-first**: every request shape and response DTO lives in `packages/shared` (zod schemas +
  types). The API validates with those schemas; the web compiles against the same types.
- **Tenancy by construction**: services take a `WorkspaceContext` and always filter by
  `ctx.workspace._id`. Cross-tenant reads return `404`, never `403`.
- **Writes are versioned**: task updates must include `version`; the API answers `409 VERSION_CONFLICT`
  with the latest task payload so clients can recover.
- **Events after writes**: Socket.IO emits happen only after the database write succeeded.
- **Graceful degradation**: Redis, SMTP and S3 are optional; the fallbacks are real implementations
  (in-process cache, inline jobs, console mailer, disk storage), not stubs.
- **Fails loudly in production**: `SEED_ON_START`, `RATE_LIMIT_DISABLED`, default JWT secrets and
  `COOKIE_SECURE=false` are refused when `NODE_ENV=production` (see `src/config/env.ts`).

## Key decisions and why

| Decision | Rationale | Trade-off accepted |
| --- | --- | --- |
| Modular monolith, not microservices | One deployable, clear module boundaries (`src/modules/*`) — complexity where it pays | Horizontal scaling is coarse-grained |
| MongoDB with explicit compound indexes | Schema suits Kanban documents; indexes proven with `explain` (10× p95 on the board read; 88–229× across the app's query shapes at 400k documents) | Aggregations needed for analytics instead of SQL joins |
| Custom `version` field, not Mongoose `__v` | Increment is explicit in every update and visible in the API contract | Every write path must remember `$inc` |
| Refresh tokens as opaque hashes + rotation + family revocation | Stolen tokens are useless; replay revokes the family | 15 s grace window needed for concurrent tabs (documented in `auth.service.ts`) |
| Refresh cookie scoped to `/api/v1/auth`, `httpOnly`, `SameSite=Lax` | Minimal exposure; CSRF-resistant for the refresh endpoint | Cross-site embedding would need `SameSite=None` + CSRF tokens |
| scrypt (Node built-in) for passwords | Memory-hard, OWASP-approved, zero native build issues on Windows | Slightly slower than bcrypt at equal factors — fine at N=16384 |
| Cursor pagination `(createdAt, _id)` | Stable under inserts, index-friendly, no `skip` scans | Only meaningful for time-ordered feeds; board reads are bounded snapshots instead |
| Fractional `position` for board ordering | Drag & drop needs a single-field update between neighbours | Float precision exhausts after ~50 consecutive same-gap inserts (acceptable; renormalisation is a documented future task) |
| Redis optional everywhere | The project must run on a laptop without Redis and in compose with it | In-process cache/queues are per-instance — documented limitation |
| Local disk default storage, S3 driver included | Demo works offline; S3-compatible services (MinIO/R2/AWS) supported by config | S3 path untested against a live bucket |
| `compression({ level: 1 })` | JSON compresses well at low effort; measurably cheaper per request than level 6 | ~10% larger payloads |
| Workspace-member "minis" cached 30 s | Removes one Mongo query from every board render (measured) | Names/avatars can be stale for up to 30 s; busted on membership changes |
| Cache reads are single-flight per process (`lib/cache.ts`) | A cold key under concurrency must not stampede the database (measured: 50 parallel cold requests → exactly 1 producer, 49 coalesced) | One producer per instance per key — with N replicas a cold key can still be computed N times |
| Access caches: workspace doc 30 s, membership 15 s, user existence 30 s | Removed up to three DB round-trips from every authenticated request (dashboard @ 100 conns 130 → 335 rps) | Changes made *outside the API* propagate within the TTL; API-driven changes invalidate immediately (globally when Redis is shared) |
| Rate-limit counters in Redis when available (in-process otherwise) | One shared budget across replicas (measured: 30 of 60 logins allowed through a two-instance balancer) | One Redis round-trip per limited request; without Redis the budget is per process again |
| Socket.IO Redis adapter + presence via `fetchSockets()` | Rooms, emits and presence span replicas (measured: event written on one instance reached a socket on the other in 97 ms) | Two extra Redis connections per instance; without Redis realtime stays per-instance |
| Shutdown order: close realtime → drain HTTP (10 s bound) → close queues/Redis/Mongo | Attached websockets used to hold the drain open until the timeout (10.1 s → 0.8 s) and in-flight requests could be cut | Stopping under load takes as long as the drain (measured 4.9 s with 30 concurrent connections, 0 failed requests) |
| Board reads default to `MAX_BOARD_TASKS` (500); cursor feeds keep the 25 default | The shared list schema's 25-item default silently truncated every board to its first 25 tasks | Boards stay bounded snapshots; column-level pagination for very large boards remains future work |
| `description` omitted from list/board payloads; the edit dialog hydrates the full task | Descriptions allow 20,000 chars and dominated list serialisation (measured 11.5 % of the board response on demo data, more with real content) | One extra detail fetch when opening the edit dialog |
| Rate limiting skipped in test/e2e (and benchmark only via `RATE_LIMIT_DISABLED`, refused in prod) | Deterministic suites and honest load numbers | Must never ship with it on — enforced by env validation |
| Vite pinned to v6 with Vitest v3 | One Vite instance in the tree (a nested copy broke type identity earlier) | Upgrade Vitest and Vite together in future |
| Route-level code splitting in the web app | 1.20 MB → 633 kB initial JS (195 kB gzip); recharts only loads with analytics | A loading splash between pages on first visit |
| Access tokens stateless (15 m) | No DB hit per request | A revoked session keeps its access token valid for ≤15 m (documented limitation) |
| Comments: author-only edit, author-or-admin delete | Editing someone's words is never legitimate; moderation still possible | Admins cannot fix typos for others — they can delete instead |

## Verification status

- ✅ 66 API integration tests, 16 web unit tests, strict typecheck on all workspaces, both production builds.
- ✅ Playwright suite: **6/6 passing locally** against a seeded disposable database (`npm run e2e`).
- ✅ Query benchmark measured and committed (`docs/benchmark-results.json`); the explain extraction was
  hardened after the first run produced incoherent counters, and the dataset generator fixed to stop
  correlating status with project id — the committed artifact now reports the real index name and
  `docsExamined = nReturned`.
- ✅ HTTP load smoke measured and committed (`docs/load-smoke-results.json`) — see `docs/BENCHMARKS.md`
  for the honest interpretation (single process + single machine saturation point).
- ✅ Six scalability experiments measured and committed (`docs/SCALABILITY_EXPERIMENTS.md`,
  `docs/experiments/*.json`): load at 10/50/100 connections, a 400k-document index/pagination proof,
  cache hit ratio + single-flight + freshness bounds, one vs two instances behind a balancer (shared
  rate limits, cross-instance realtime), 20 rounds of same-version write contention, and four failure
  drills. The exercises surfaced and fixed four defects on the way: the board silently truncating at
  25 tasks, the Socket.IO adapter never starting, websockets holding the graceful drain to its timeout,
  and the cache having no stampede protection.
- ✅ `docker compose config -q` passes; the daemon is available (`docker compose up -d redis` backs the
  experiments), while image builds remain CI-only.

## Open questions / future work

1. **Float position exhaustion** — renormalise a column when neighbouring positions get within 1e-6.
2. **Session revocation propagation** — check a revoked-session cache in `requireAuth` to cut the
   15 m window; adds one lookup per request.
3. **Attachment virus scanning** and per-workspace storage quotas.
4. **Password reset + email verification** flows (emails already have a mailer + queue).
5. **Webhook / integration surface** for external systems consuming task events.
6. **Multi-region reads** — Mongo replica set + reading from secondaries for analytics.
7. **S3 driver integration test** against MinIO in CI (service container).
8. **Dedicated load-generator host + MongoDB replica set** — the current numbers share one CPU, which
   caps what can be honestly claimed at 100+ concurrent users.
9. **Column-level board pagination** — boards are bounded at `MAX_BOARD_TASKS` (500); beyond that each
   column would need its own cursor page.
