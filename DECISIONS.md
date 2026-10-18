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
| Docker | Docker Desktop 29.1.3 + Compose v2.40; daemon available. The **production topology is built and verified locally** (`docker-compose.prod.yml`), and image builds are exercised in CI. Engine 29 raised the minimum Docker API to 1.44 — Traefik must be ≥ v3.6 (AutoNegotiation); v3.5's 1.24 client gets a bare 400 from the daemon |
| Shell quirk | `NODE_ENV=production` is set globally on this machine → `npm install` must use `--include=dev`; every project script pins its own `NODE_ENV` via `cross-env` so this cannot leak into dev/test/benchmark runs |

## Commands and ports

```bash
npm run dev        # API :4000 + web :5173 (concurrently)
npm run build      # tsup (API) → apps/api/dist (index + scripts), vite (web) → apps/web/dist
npm run typecheck  # strict TypeScript across all workspaces
npm test           # 85 API integration + 16 web unit tests (needs MongoDB; 1 test S3-gated)
npm run seed       # demo data (idempotent; SEED_RESET=true to wipe; SEED_FORCE=true overrides the prod refusal)
npm run bench      # MongoDB explain + latency benchmark → docs/benchmark-results.json
npm run load       # autocannon smoke → docs/load-smoke-results.json (RATE_LIMIT_DISABLED=true)
npm run exp:1 …6   # scalability experiments on local infra → docs/experiments/*.json
npm run exp:7      # production topology (docker-compose.prod.yml) under load; needs only Docker
npm run exp:8      # replica set: 400k index build, failover drill, read-preference A/B
npm run stack:up   # build + start the production topology (Traefik :80)
npm run stack:down # stop it
npm run e2e        # Playwright; boots a seeded API (flowforge_e2e) + Vite
```

MongoDB databases: `flowforge_dev` (dev/seed), `flowforge_test` (integration tests), `flowforge_e2e`
(Playwright), `flowforge_bench` / `flowforge_load` (benchmarks, dropped afterwards).

`npm run e2e` reuses a server that is already listening on `http://localhost:4000`
(`reuseExistingServer: !CI` in `apps/web/playwright.config.ts`) — including its database. Run it with
`npm run dev` stopped, otherwise the suite seeds and writes to `flowforge_dev` instead of
`flowforge_e2e`. Observed directly: an e2e run left an `e2e-workspace`, an `@flowforge.test` user and
a task inside `flowforge_dev`.

## Conventions

- **Contract-first**: every request shape and response DTO lives in `packages/shared` (zod schemas +
  types). The API validates with those schemas; the web compiles against the same types.
- **Tenancy by construction**: services take a `WorkspaceContext` and always filter by
  `ctx.workspace._id`. Cross-tenant reads return `404`, never `403`.
- **Writes are versioned**: task updates must include `version`; the API answers `409 VERSION_CONFLICT`
  with the latest task payload so clients can recover.
- **Events after writes**: Socket.IO emits happen only after the database write succeeded.
- **Graceful degradation** (development posture): Redis, SMTP and S3 are optional; the fallbacks are
  real implementations (in-process cache, inline jobs, console mailer, disk storage), not stubs. The
  **production posture requires Redis** — cache, queues, rate limits and realtime are only correct
  across replicas with a shared store.
- **Fails loudly in production**: `SEED_ON_START`, `RATE_LIMIT_DISABLED`, `CACHE_DISABLED`, default JWT
  secrets, `COOKIE_SECURE=false` and a missing `REDIS_URL` are refused when `NODE_ENV=production`;
  `PROCESS_ROLE=worker` additionally requires Redis. `SEED_FORCE=true` is the one explicit, named
  override (demo/staging seeding) — there is no way to disable rate limiting or the cache. 

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
| Redis optional everywhere | The project must run on a laptop without Redis and in compose with it | In-process cache/queues are per-instance — **production therefore refuses to boot without `REDIS_URL`** |
| Traefik v3.6 as the production edge (`docker-compose.prod.yml`) | The edge owns what nginx-in-the-web-container cannot: health-checked load balancing across `--scale`d replicas, retry middleware, sticky cookies for Socket.IO polling, active readiness probes on `/api/v1/health/ready`; only the edge is published | One more moving part; v3.6+ is mandatory on Docker Engine 29+; TLS/ACME is an operator opt-in documented in `.env.prod.example` |
| Scaling via `docker compose up -d --scale api=N`, repeated on every `up` | Compose v2 ignores `deploy.replicas` outside swarm and refuses it together with `--scale` | Forgetting `--scale` on a later `up` silently drops to one replica (the deploy workflow always passes it) |
| Three process roles (`PROCESS_ROLE=all/api/worker`) | Job CPU must not compete with request serving; a dedicated worker can be scaled and restarted independently. API replicas still `initQueues()` so enqueueing works, but never consume | Two service definitions to deploy; the ops-only worker app exposes just health/metrics |
| `MONGODB_AUTO_INDEX=false` in production + one-shot `ensure-indexes` | A 400k-document build measured 15.5 s — fine as a one-shot before replicas start, wrong as a surprise at first boot; `createIndexes()` is additive and never drops | Index changes require re-running the one-shot (compose ordering handles fresh boots) |
| 3-node replica set + `MONGODB_ANALYTICS_READ_PREFERENCE=secondaryPreferred` (analytics only) | Failover measured at 3.6 s with zero failed reads/writes under load; auth/tenancy/task reads always use the primary so nothing user-visible is served stale | Secondary reads showed **no gain on a single host** (122 vs 119 rps, Experiment 8) — the setting exists for multi-host replica sets |
| Explicit Mongo pool sizing (`MONGODB_MAX_POOL_SIZE`, 50 per replica in prod) | pool × replicas must stay under the server's connection budget; relying on the driver default (100) silently multiplies with replica count | One more value to keep consistent when scaling out |
| Graceful drain bounded by `DRAIN_TIMEOUT_MS`, compose `stop_grace_period` larger (api 20 s, worker 30 s) | The app closes realtime first, drains HTTP for up to 10 s, then exits; Docker must not SIGKILL mid-drain (worker drains active BullMQ jobs on close) | A `docker restart` under load still cuts ~0.24 % of in-flight requests (Experiment 7) — zero needs orchestrator-style pre-deregistration |
| SeaweedFS (pinned 4.48) as the bundled S3 store | MinIO's public images are no longer distributed (Docker Hub and Quay pulls verified failing); SeaweedFS is a real, actively released S3-compatible server and its path is our CI integration test target | One more component to secure/back up; point `S3_*` at AWS/R2 instead if preferred |
| Streamed uploads (disk temp + `putStream`) and a bounded JSON logger fallback | Files never buffer in the heap (8 × 10 MB measured with ≤ 11 MB RSS delta); the production image ships without devDependencies, so a `NODE_ENV=development` process there must not crash on the missing `pino-pretty` transport | One temp write per upload (removed in `finally`); pretty logs are skipped when the transport is absent |
| Local disk default storage, S3 driver included and integration-tested | Demo works offline; S3-compatible services (AWS, R2, SeaweedFS) supported by config; the S3 path is exercised against a live, SigV4-enforcing SeaweedFS (upload → streamed read → delete) locally and in CI | Multi-replica deployments must use S3 — replicas do not share local disks |
| Uploads are parked on disk (`multer.diskStorage`) and streamed into the driver | A 10 MB upload never sits in the Node heap; the temp file is removed in `finally` (multer cleans partials on reject itself) | One temp write per upload before the storage write; a process crash between the two can leave a stale temp file |
| `compression({ level: 1 })` | JSON compresses well at low effort; measurably cheaper per request than level 6 | ~10% larger payloads |
| Workspace-member "minis" cached 30 s | Removes one Mongo query from every board render (measured) | Names/avatars can be stale for up to 30 s; busted on membership changes |
| Cache reads are single-flight per process (`lib/cache.ts`) | A cold key under concurrency must not stampede the database (measured: 50 parallel cold requests → exactly 1 producer, 49 coalesced) | One producer per instance per key — with N replicas a cold key can still be computed up to N times. A distributed Redis lock was considered and rejected: it adds a fail-open polling path and a latency tax on every cold key to save at most N−1 producers on ~6 key shapes |
| Cached `null` is stored behind a sentinel (negative caching) | An unknown workspace ref or non-membership 404 was re-hitting Mongo on every request because `wrap()` treated cached `null` as a miss | `cache.get()` cannot distinguish a cached null from a miss — `wrap()` is the only consumer that needs to |
| In-process cache fallback is bounded and jittered | The memory store grew for the process lifetime (unread keys leaked); TTLs could expire across replicas in lockstep | Sweep-on-write evicts expired then oldest (cap `CACHE_MEMORY_MAX_ENTRIES`, default 5,000); TTLs jitter downward only (0.9–1.0×) so documented staleness bounds hold |
| Access caches: workspace doc 30 s, membership 15 s, user existence 30 s | Removed up to three DB round-trips from every authenticated request (dashboard @ 100 conns 130 → 335 rps) | Changes made *outside the API* propagate within the TTL; API-driven changes invalidate immediately (globally when Redis is shared) |
| Rate-limit counters in Redis when available (in-process otherwise) | One shared budget across replicas (measured: 30 of 60 logins allowed through a two-instance balancer) | One Redis round-trip per limited request; without Redis the budget is per process again |
| Socket.IO Redis adapter + presence via `fetchSockets()` | Rooms, emits and presence span replicas (measured: event written on one instance reached a socket on the other in 97 ms) | Two extra Redis connections per instance; without Redis realtime stays per-instance |
| Shutdown order: close realtime → drain HTTP (10 s bound) → close queues/Redis/Mongo | Attached websockets used to hold the drain open until the timeout (10.1 s → 0.8 s) and in-flight requests could be cut | Stopping under load takes as long as the drain (measured 4.9 s with 30 concurrent connections, 0 failed requests) |
| Board reads default to `MAX_BOARD_TASKS` (500); cursor feeds keep the 25 default | The shared list schema's 25-item default silently truncated every board to its first 25 tasks | Boards stay bounded snapshots; column-level pagination for very large boards remains future work |
| `description` omitted from list/board payloads; the edit dialog hydrates the full task | Descriptions allow 20,000 chars and dominated list serialisation (measured 11.5 % of the board response on demo data, more with real content) | One extra detail fetch when opening the edit dialog |
| Rate limiting skipped in test/e2e (and benchmark only via `RATE_LIMIT_DISABLED`, refused in prod) | Deterministic suites and honest load numbers | Must never ship with it on — enforced by env validation |
| Vite pinned to v6 with Vitest v3 | One Vite instance in the tree (a nested copy broke type identity earlier) | Upgrade Vitest and Vite together in future |
| Route-level code splitting in the web app | 1.20 MB → 636 kB initial JS (196 kB gzip); recharts only loads with analytics | A loading splash between pages on first visit |
| Access tokens stateless (15 m) | No DB hit per request | A revoked session keeps its access token valid for ≤15 m (documented limitation) |
| Comments: author-only edit, author-or-admin delete | Editing someone's words is never legitimate; moderation still possible | Admins cannot fix typos for others — they can delete instead |

## Verification status

- ✅ 85 API integration tests (1 S3-gated), 16 web unit tests, strict typecheck on all workspaces, both
  production builds.
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
- ✅ **Production topology built and smoke-verified locally**: `docker-compose.prod.yml` boots with
  2–3 api replicas behind Traefik (readiness `{"db":"up","redis":"up"}` through the edge), all
  one-shot services exit 0, demo data seeds through the image, and an attachment uploaded via Traefik
  downloads 200 from *every* replica (shared SeaweedFS). Defects found and fixed on the way: the web
  container's dev nginx proxy would pin one replica (static-only prod config added), Traefik v3.5 is
  incompatible with Docker Engine 29 (pinned v3.6), the production image crashed on a missing
  dev-only pino-pretty transport, and the deploy workflow's `--scale` would silently drop to one
  replica on later `up`s (pinned in the script).
- ✅ **Experiments 7–8** measured on that topology and committed (`docs/experiments/exp7-*.json`,
  `exp8-*.json`): 1 → 2 replicas +51 % board / +47 % dashboard at 0 errors (2 → 3 plateaus on one CPU-
  saturated host); rolling-restart cost 0.24 % 502s (mid-flight cuts — orchestrator pre-deregistration
  is the zero path); cross-replica realtime 417 ms; negative caching 635 vs 333 rps and 4 vs 6,676 DB
  misses; 400k-document index build 15.5 s as a one-shot; replica-set failover 3.6 s with 0 failed
  reads (102/102) and writes (52/52); secondary reads show no gain on a single host.
- ✅ **S3 driver integration-tested** against a live, SigV4-enforcing SeaweedFS — locally and in CI
  (closes the old open item).
- ✅ `docker compose config -q` and `docker compose -f docker-compose.prod.yml config -q` pass (the
  latter also runs in CI), and image builds are exercised in CI.

## Open questions / future work

1. **Float position exhaustion** — renormalise a column when neighbouring positions get within 1e-6.
2. **Session revocation propagation** — check a revoked-session cache in `requireAuth` to cut the
   15 m window; adds one lookup per request.
3. **Attachment virus scanning** and per-workspace storage quotas.
4. **Password reset + email verification** flows (emails already have a mailer + queue).
5. **Webhook / integration surface** for external systems consuming task events.
6. **Multi-region reads** — the replica set now exists; multi-region topology (tagged read
   preferences, local reads) is the next step beyond single-host `.read('secondaryPreferred')`.
7. **Orchestrator-style zero-downtime restarts** — deregister from the LB, wait one healthcheck
   interval, then stop; `docker restart` still costs 0.24 % of in-flight requests (Experiment 7).
8. **Dedicated load-generator host** — the current numbers share one CPU, which caps what can be
   honestly claimed at 100+ concurrent users (the MongoDB replica set part of this item is done).
9. **Column-level board pagination** — boards are bounded at `MAX_BOARD_TASKS` (500); beyond that each
   column would need its own cursor page.
