# FlowForge Architecture

## 1. System overview

```mermaid
flowchart TB
  subgraph Browser
    SPA["React SPA<br/>(Vite, TanStack Query, Zustand)<br/>/app/:workspaceSlug/*"]
  end

  subgraph Edge
    NGINX["nginx (docker)<br/>static + /api + /socket.io proxy"]
  end

  subgraph API["apps/api — Express (modular monolith)"]
    direction TB
    MW["Middleware chain<br/>request-id → pino → metrics → helmet/cors<br/>→ rate limit → auth → tenancy loader → RBAC → zod validate"]
    MOD["Modules<br/>auth · users · workspaces · projects · tasks<br/>comments · attachments · activity · notifications · analytics"]
    REALTIME["realtime/io.ts<br/>rooms: user:{id} · workspace:{id} · project:{id}"]
    JOBS["jobs/queue.ts<br/>BullMQ or inline"]
    STORAGE["config/storage.ts<br/>LocalDisk | S3"]
    MW --> MOD --> REALTIME
    MOD --> JOBS
    MOD --> STORAGE
  end

  subgraph Data
    MONGO[("MongoDB<br/>11 collections<br/>tenant-scoped indexes")]
    REDIS[("Redis (optional)<br/>cache + queues")]
    DISK[("Attachments<br/>disk or S3")]
  end

  SPA --> NGINX --> API
  MOD --> MONGO
  MOD --> REDIS
  STORAGE --> DISK
  REDIS -.BullMQ worker.-> JOBS
```

The API is a **modular monolith**: one deployable, but each domain lives in its own module with a
route file (HTTP concerns), a service file (business rules) and shared models. This keeps boundaries
honest while avoiding distributed-system overhead before it is earned.

### 1.1 Production topology (`docker-compose.prod.yml`)

The dev compose above runs one of everything. Production runs the same image in **three roles**
(`PROCESS_ROLE`) behind a real edge:

```mermaid
flowchart LR
  LB["Traefik v3.6<br/>:80 (optional TLS)<br/>health-checked LB, retry, sticky cookie"]
  subgraph EDGE["edge network"]
    LB
  end
  subgraph INTERNAL["internal network (no host ports)"]
    API1["api replica 1<br/>PROCESS_ROLE=api"]
    API2["api replica 2..N<br/>PROCESS_ROLE=api"]
    WK["worker<br/>PROCESS_ROLE=worker<br/>BullMQ consumers + /metrics"]
    RS[("MongoDB rs0<br/>3 nodes")]
    RDS[("Redis<br/>cache · queues · rate limits · adapter")]
    S3[("SeaweedFS<br/>S3-compatible attachment store")]
  end
  LB --> API1
  LB --> API2
  API1 --> RS
  API2 --> RS
  API1 --> RDS
  API2 --> RDS
  API1 --> S3
  API2 --> S3
  WK --> RS
  WK --> RDS
```

- **API replicas are stateless** — JWT access tokens need no session lookup, caches/queues/rate
  limits live in Redis, attachments live in S3-compatible storage. Scale with
  `docker compose -f docker-compose.prod.yml up -d --scale api=N` (repeat `--scale` on every `up`).
- **Jobs only run in the worker tier** in production (`PROCESS_ROLE=api` keeps the queue handle for
  enqueueing but never consumes); the worker exposes health + queue gauges, no business routes.
- **Indexes are built by a one-shot** (`ensure-indexes`, `MONGODB_AUTO_INDEX=false`) so a large
  collection never triggers a surprise build at boot; `ensure-bucket` guarantees the attachment
  bucket exists.
- **Health**: `/api/v1/health` is liveness, `/api/v1/health/ready` (DB + Redis) is what Traefik and
  container healthchecks use — both are mounted ahead of the rate limiter so probes can never be
  throttled. Measured behaviour of this topology: Experiment 7/8 in
  [SCALABILITY_EXPERIMENTS.md](./SCALABILITY_EXPERIMENTS.md).

## 2. Request lifecycle

Every `/api/v1` request flows through the same chain:

1. **`requestIdMiddleware`** — attaches/propagates `x-request-id`.
2. **`pino-http`** — structured log line per request (secrets redacted).
3. **`metricsMiddleware`** — Prometheus histogram/counter with the matched route label.
4. **`helmet`, `cors`, `compression`, `express.json` (1 MB), `cookie-parser`**.
5. **Rate limiters** — global 600/min, auth 30/15 min, uploads 60/min (skipped in tests).
6. **`requireAuth`** — verifies the JWT access token, loads the user id.
7. **Tenancy loader** — `requireWorkspace | requireProject | requireTask | requireComment` resolves the
   resource, loads the caller's **membership**, and 404s when the caller is not a member.
8. **`requireRole(min)`** — server-side RBAC gate.
9. **`validate({ body, query, params })`** — zod parsing with defaults; handlers trust the result.
10. **Handler → service** — all queries filtered by `ctx.workspace._id`; writes record activity.
11. **Error middleware** — maps `AppError`, zod, mongoose and multer errors to
    `{ error: { code, message, details?, requestId } }`.

## 3. Data model (11 collections)

```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : has
  WORKSPACE ||--o{ MEMBERSHIP : has
  WORKSPACE ||--o{ INVITATION : issues
  WORKSPACE ||--o{ PROJECT : contains
  PROJECT ||--o{ TASK : contains
  TASK ||--o{ TASK : "parentTaskId (1 level)"
  TASK ||--o{ COMMENT : has
  TASK ||--o{ ATTACHMENT : has
  WORKSPACE ||--o{ ACTIVITYLOG : records
  USER ||--o{ NOTIFICATION : receives
  USER ||--o{ SESSION : opens

  USER { string name email passwordHash preferences }
  WORKSPACE { string name slug ownerId settings }
  MEMBERSHIP { ObjectId workspaceId ObjectId userId enum role }
  INVITATION { string email enum role string tokenHash date expiresAt }
  PROJECT { string name key description status int taskSeq }
  TASK { string key title status priority assigneeIds labels dueDate position version completedAt }
  COMMENT { ObjectId taskId ObjectId authorId content editedAt }
  ATTACHMENT { ObjectId taskId string storageKey filename mimeType size }
  ACTIVITYLOG { string action entityType entityId metadata }
  NOTIFICATION { enum type title body link readAt }
  SESSION { string familyId refreshTokenHash expiresAt revokedAt replacedBy }
```

Notable constraints and indexes (see `apps/api/src/models/`):

| Index | Purpose |
| --- | --- |
| `membership { workspaceId, userId } unique` | one membership per user per workspace |
| `workspace.slug unique`, `project { workspaceId, key } unique` | readable, tenant-scoped identifiers |
| `task { workspaceId, projectId, status, position }` | board reads (measured 10× p95 win, 500× fewer documents examined — `docs/benchmark-results.json`) |
| `task { workspaceId, assigneeIds, status, dueDate }` | "my tasks", workload, overdue |
| `task { workspaceId, parentTaskId }`, `{ workspaceId, createdAt, _id }`, text `{title, description}` | subtasks, cursor feeds, search |
| `activity { workspaceId, createdAt, _id }`, `{ workspaceId, taskId, createdAt }` | feeds |
| `invitation.expiresAt` TTL, `session.expiresAt` TTL | automatic cleanup |
| `session.refreshTokenHash unique`, `invitation.tokenHash unique` | hashed secrets only |

## 4. Authentication and session design

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant DB as Mongo

  B->>A: POST /auth/login (email, password)
  A->>DB: verify scrypt hash (timing-equalised on unknown email)
  A->>DB: create Session {familyId, sha256(refresh), expiry}
  A-->>B: { accessToken (15m) } + Set-Cookie ff_rt (httpOnly, path=/api/v1/auth)

  B->>A: POST /auth/refresh (cookie)
  A->>DB: atomic claim (revoke old, keep family)
  A->>DB: create successor session
  A-->>B: new accessToken + rotated cookie

  note over B,A: Replay of a rotated token outside the 15s grace window
  A->>DB: revoke entire family
  A-->>B: 401 REFRESH_REUSE_DETECTED
```

- Access tokens are stateless JWTs (`sub`, `sid`) — no DB hit per request.
- Refresh tokens never touch the database in plaintext.
- The web client performs **single-flight refresh**: concurrent 401s share one refresh call, which is
  what makes the grace window sufficient (see `apps/web/src/lib/api.ts`).

## 5. Realtime design

- Socket.IO authenticates with the access token during the handshake.
- `workspace:join` and `project:join` re-verify membership server-side; foreign rooms get
  `{ ok: false }` and never receive events.
- Rooms: `user:{id}` (notifications), `workspace:{id}` (task/comment/activity/member events),
  `project:{id}` (presence).
- **Events are emitted after the database write** — clients cannot observe unsaved state.
- Clients patch caches in place for `task:updated` (no refetch flicker) and invalidate for structural
  changes (`task:created`, `task:deleted`, comments, attachments).
- On reconnect the client re-joins rooms and invalidates all queries — the guaranteed resync path.
- Presence uses **`fetchSockets()`** (adapter-aware): with the Redis adapter, "N people online" and
  viewer sets are correct across every replica; without Redis it degrades to per-instance.

## 6. Attachments pipeline

```
upload → multer disk temp (10 MB, MIME allow-list) → StorageDriver.putStream(key, file stream) →
temp removed → Attachment document → activity + socket event
download → auth → load attachment → membership check on its workspace → stream (Content-Disposition) →
409/404 for non-members (never a redirect to a public URL)
```

Uploads never sit in the Node heap: the HTTP layer parks the file in `UPLOAD_TMP_DIR` and the driver
streams it (single signed `PutObject` for S3 with the content length). `LocalDiskDriver` (default)
mirrors the interface of `S3Driver`; multi-replica deployments must use S3-compatible storage
(SeaweedFS ships with the production compose) because replicas do not share local disks. The S3
driver is integration-tested against a live, SigV4-enforcing server in CI.

## 7. Caching, jobs and observability

| Concern | With Redis | Without Redis |
| --- | --- | --- |
| Analytics/dashboard snapshots | Redis keys with TTL (downward-jittered), prefix-busted on writes, negative results cached behind a sentinel | in-process Map with TTL (bounded, sweep-on-write; same semantics) |
| Workspace member "minis" | 30 s TTL, busted on membership writes | same |
| Email + notification delivery | BullMQ queue with retries/exponential backoff, consumed by the worker tier in production | inline `await` with identical outcomes |
| Rate limiting | counters shared across replicas in Redis (one budget per client) | per-process counters |
| Health/metrics | `/api/v1/health` (liveness) + `/api/v1/health/ready` (DB + Redis); `/metrics` exposes request histograms, counters, websocket gauge, cache counters, BullMQ queue depth and process metrics | same; readiness reports `redis: disabled` |

## 8. Security model (summary)

- Passwords: scrypt (N=16384, r=8, p=1), never returned by the API.
- Sessions: hashed refresh tokens, rotation, reuse detection, revocable per session.
- Authorization: every workspace-owned resource is reached through a tenancy loader; role checks are
  server-side, the UI merely mirrors them.
- Input validation: zod at the boundary, MIME allow-list for uploads, filename sanitisation,
  `Content-Disposition` + `nosniff` on downloads.
- Query safety: Mongoose casts/escapes values; regex escapes used where patterns are built.
- Secrets: env-driven; `.env` gitignored; logs redact auth headers, cookies and token fields; the
  documented production posture requires TLS with `COOKIE_SECURE=true` and a rotated JWT secret.
