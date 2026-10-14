# FlowForge

**A scalable, real-time project management SaaS** — multi-tenant workspaces, role-based access control,
versioned Kanban boards with live collaboration, analytics, and an evidence-backed performance story.

Built as a production-shaped MERN/TypeScript monorepo: Express + MongoDB + Socket.IO + Redis on the
backend, React + Vite + TanStack Query on the frontend, Docker + GitHub Actions around all of it.

> New here? **[HOW_TO_RUN.md](./HOW_TO_RUN.md)** walks through setup and every feature, click by click.

---

## Why this is more than a CRUD app

Every claim below is enforced by code and checked by tests — not just described in a README.

| Claim | How it is enforced | Evidence |
| --- | --- | --- |
| Tenant isolation | Every workspace-owned query is scoped through a request context loader; non-members get `404`, never `403` | `apps/api/src/tests/tenancy.test.ts` (11 cross-tenant attack cases) |
| Concurrency safety | Tasks carry a `version`; writes are compare-and-set, conflicts return `409` with the latest payload | OCC race test: two same-version writes → exactly one winner |
| Secure sessions | Refresh tokens are opaque, stored only as SHA-256 hashes, rotated on use, with family reuse detection | `auth.test.ts`: replay after rotation revokes the family |
| Server-side RBAC | Role hierarchy (`owner > admin > member > viewer`) enforced in middleware and services | `rbac.test.ts` — viewers/ members/ admins each constrained |
| Measurable DB work | Compound indexes sized to the board query, verified with `explain` | p95 **15.65 ms → 0.92 ms**, docs examined **20,000 → 0** (`docs/BENCHMARKS.md`) |
| Real-time correctness | Socket.IO rooms are joined only after a membership check; events fire only after successful writes | `realtime.test.ts` incl. foreign-room rejection |
| Reconnect sync | Clients refetch everything on socket reconnect and patch caches from events otherwise | `apps/web/src/hooks/useRealtime.ts` |

## Feature tour

**Six primary interfaces** (see HOW_TO_RUN for screenshots-by-description walkthroughs):

1. **Dashboard** — personal workload, deadlines, recent activity, team capacity.
2. **Project board** — Kanban columns with drag & drop, filters, live presence of who is viewing.
3. **Task detail** — comments, subtasks, file attachments, activity history, inline field editing.
4. **Team** — invitations with hashed single-use tokens, role management, pending-invite control.
5. **Analytics** — completion trend, workload distribution, status mix, cycle time, per-project progress.
6. **Settings** — workspace config, profile/preferences, active-session management, danger zone.

**Under the hood** — JWT access tokens + rotating refresh cookies, invitation emails through a queue,
attachments on a pluggable storage driver (local disk or any S3-compatible service), Prometheus metrics,
structured logs with redaction, rate limiting, and graceful degradation when Redis is absent.

## Repository layout

```
flowforge/
├── apps/
│   ├── api/                  # Express + Mongoose + Socket.IO (modular monolith)
│   │   ├── src/config/       # env validation, db, redis, logging, storage driver
│   │   ├── src/middleware/   # auth, tenancy loaders, RBAC, validation, errors, limits
│   │   ├── src/modules/      # auth, workspaces, projects, tasks, comments, attachments,
│   │   │                     # activity, notifications, analytics, users
│   │   ├── src/realtime/     # Socket.IO gateway (rooms, presence)
│   │   ├── src/jobs/         # BullMQ queues with an inline fallback
│   │   ├── src/tests/        # 66 integration tests against a real MongoDB
│   │   └── scripts/          # seed, benchmark, load smoke, e2e bootstrap
│   └── web/                  # React 19 + Vite + Tailwind v4 + TanStack Query + Zustand
│       ├── src/features/     # auth, dashboard, projects, board, task, team, analytics, settings
│       ├── src/components/   # design system (Radix-based) + layout shell
│       └── e2e/              # Playwright journeys
├── packages/
│   ├── shared/               # zod schemas, constants, DTO contracts (API ⇄ web)
│   └── config/               # shared TypeScript base config
├── infra/                    # docker (nginx), monitoring (Prometheus/Grafana)
├── load/k6/                  # k6 scenario with p95 thresholds
├── docs/                     # ARCHITECTURE, API, BENCHMARKS, DEMO + measured JSON artifacts
├── docker-compose.yml        # mongo + redis + api + web
└── .github/workflows/        # CI (verify + e2e + images) and CD (GHCR + SSH)
```

## Architecture in one picture

```mermaid
flowchart LR
  subgraph Client
    UI[React SPA] -- REST /api/v1 --> API
    UI -- WebSocket --> WS[Socket.IO gateway]
  end
  subgraph API["Express API (modular monolith)"]
    MW[request-id → logging → metrics → auth → tenancy → RBAC] --> SVC[Domain services]
    SVC --> REPO[(Mongoose models\n11 collections, tenant-scoped indexes)]
    SVC --> CACHE{{Cache: Redis or in-process}}
    SVC --> JOBS{{Jobs: BullMQ or inline}}
    SVC -- after write --> EVT[Emit events]
  end
  EVT --> WS
  REPO -.-> MONGO[(MongoDB)]
  CACHE -.-> REDIS[(Redis)]
  JOBS -.-> REDIS
  SVC --> STORE[(Attachments: local disk or S3)]
  API --> METRICS[/metrics for Prometheus/]
```

Details, schema and data flows: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quick start

```bash
git clone <your-fork> flowforge && cd flowforge
npm install --include=dev          # see Troubleshooting if NODE_ENV=production is set
cp .env.example .env               # dev defaults work as-is
npm run seed                       # demo workspace, users, tasks (password: Password123!)
npm run dev                        # API on :4000, web on :5173
```

Open http://localhost:5173 and sign in as `aarav.mehta@flowforge.dev` / `Password123!`.

**Prefer containers?** `docker compose up --build` → http://localhost:8080 (MongoDB + Redis included).

## Verification status

Run everything locally with `npm run typecheck && npm test && npm run build`.

| Check | Status | Detail |
| --- | --- | --- |
| API typecheck / build | ✅ passing | `tsc --noEmit`, `tsup` bundle |
| API integration tests | ✅ 66 passing | real MongoDB; tenancy, RBAC, OCC, pagination, invitations, sockets |
| Web typecheck / build | ✅ passing | route-level code splitting (initial JS 195 kB gzip) |
| Web unit tests | ✅ 16 passing | API client refresh single-flight, drag-drop math, task card |
| Query benchmark | ✅ measured | `docs/benchmark-results.json` (16.9× p95 improvement with the compound index) |
| HTTP load smoke | ✅ measured | `docs/load-smoke-results.json` — see honest interpretation below |
| E2E (Playwright) | ⏳/✅ | runs in CI against a seeded database; `npm run e2e` |

**Honest performance note.** At 10 concurrent connections the board read serves p97.5 ≈ 104 ms;
at 100 connections the single process saturates (~160 rps) and latency queues. That is a
single-machine measurement with the load generator, API and MongoDB sharing one CPU — not a
capacity claim. The remediation path (horizontal scale behind a load balancer, replica set,
dedicated load generator) is documented in [docs/BENCHMARKS.md](./docs/BENCHMARKS.md).

## Known limitations

- Access tokens remain valid for up to 15 minutes after a session is revoked (short-TTL trade-off; revocation is immediate for refresh).
- Without Redis the cache and job queue are in-process — correct for a single instance, not shared across replicas.
- The S3 storage driver is implemented and type-checked but has not been exercised against a live bucket in this environment.
- Email delivery logs to the console unless `SMTP_URL` is configured; invitation links are also returned to admins so the flow works offline.
- Presence (who is viewing a board) is tracked per API instance.
- Password reset / email verification are not implemented.

## Documentation map

- **[HOW_TO_RUN.md](./HOW_TO_RUN.md)** — setup, demo accounts, and how to exercise every feature.
- **[DECISIONS.md](./DECISIONS.md)** — environment facts, conventions, and the decisions behind the code.
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — modules, data model, request lifecycle, realtime design, security model.
- **[docs/API.md](./docs/API.md)** — endpoint reference with permissions and error codes.
- **[docs/BENCHMARKS.md](./docs/BENCHMARKS.md)** — methodology and measured results.
- **[docs/DEMO.md](./docs/DEMO.md)** — the 7-scenario demo script.

## License

MIT — build on it freely.
