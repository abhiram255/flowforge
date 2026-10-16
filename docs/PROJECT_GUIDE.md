# FlowForge — Complete Project Guide

This is the single document that describes the whole project: what it is, every feature with
screenshots, how it is built, how it is verified, how it is deployed, and what it does not do yet.

It is written to be read start to finish. Where a topic deserves more depth, the deeper document is
linked instead of duplicated, so the numbers here stay honest.

| If you want… | Read |
| --- | --- |
| To run it in five minutes | [HOW_TO_RUN.md](../HOW_TO_RUN.md) |
| A 5–7 minute scripted demo | [docs/DEMO.md](./DEMO.md) |
| System design in depth | [docs/ARCHITECTURE.md](./ARCHITECTURE.md) |
| Every endpoint and error code | [docs/API.md](./API.md) |
| Measured performance and methodology | [docs/BENCHMARKS.md](./BENCHMARKS.md), [docs/SCALABILITY_EXPERIMENTS.md](./SCALABILITY_EXPERIMENTS.md) |
| Environment facts, conventions, open questions | [DECISIONS.md](../DECISIONS.md) |
| This document | you are here |

---

## 1. What FlowForge is

FlowForge is a **multi-tenant, real-time project management SaaS**: workspaces, projects with Kanban
boards, tasks with comments/subtasks/files/history, team roles, live collaboration, notifications and
delivery analytics.

It is built as a production-shaped MERN/TypeScript monorepo rather than a tutorial CRUD app. The
parts that are usually hand-waved are instead enforced by code and checked by tests:

| Claim | How it is enforced | Evidence |
| --- | --- | --- |
| Tenant isolation | Every workspace-owned query goes through a request-context loader; non-members get `404`, never `403` | `apps/api/src/tests/tenancy.test.ts` — 11 cross-tenant attack cases |
| Concurrency safety | Tasks carry a `version`; writes are compare-and-set and return `409` with the latest payload | OCC race test: two same-version writes, exactly one winner |
| Secure sessions | Refresh tokens are opaque, stored only as SHA-256 hashes, rotated on use, with family reuse detection | `auth.test.ts`: replaying a rotated token revokes the family |
| Server-side RBAC | Role hierarchy (`owner > admin > member > viewer`) enforced in middleware and services | `rbac.test.ts` — viewers, members and admins each constrained |
| Real-time correctness | Socket rooms are joined only after a membership check; events fire only after a successful write | `realtime.test.ts`, including foreign-room rejection |
| Measurable database work | Compound indexes sized to the board query, verified with `explain` | `docs/benchmark-results.json` — p95 17.6 ms → 1.8 ms, 20,000 → 40 documents examined |
| Scale-out without losing correctness | Two API instances behind a balancer with shared Redis rate limits and a Socket.IO Redis adapter | Experiment 4: 1.46–1.59× throughput, 0 errors, cross-instance event in 97 ms |

**Stack.** React 19 + Vite + Tailwind v4 + TanStack Query + Zustand on the client; Express +
Mongoose + Socket.IO + optional Redis on the server; MongoDB as the system of record; Docker, GitHub
Actions, Prometheus/Grafana and k6 around the edges.

**Scale of the codebase.** 3 workspaces (`apps/api`, `apps/web`, `packages/*`), 11 MongoDB
collections, 66 API integration tests, 16 web unit tests, 6 Playwright journeys.

---

## 2. Feature tour (with screenshots)

Every image below is a capture of the running application, not a mockup. All screenshots live in
[`docs/screenshots/`](./screenshots).

### 2.1 Sign in, sign up and sessions

![The sign-in screen: an instrument column with the product pitch and numbered capability list on the left, and the credential form on the right](screenshots/01-login.png)

The login screen doubles as the product statement. The left column lists what the product does; the
right column is the form. `Use demo credentials` fills the seeded owner account in one click.

![The registration screen with name, work email and password fields](screenshots/02-register.png)

Registration validates with the same zod schema the API uses (`packages/shared`), so client and
server can never disagree about what a valid password is. Sessions are JWT access tokens (15 minutes,
stateless) plus an opaque refresh token in an `httpOnly` cookie scoped to `/api/v1/auth`; refresh
tokens rotate on every use, and replaying a rotated token revokes the whole session family.

### 2.2 Workspaces and onboarding

![Onboarding: create your first workspace, in a bracketed panel](screenshots/03-onboarding.png)

A newly registered account has no workspace, so it lands on onboarding instead of a dashboard. The
workspace you create makes you its owner.

![The workspace switcher open, listing Acme Corp and Nebula Labs with member counts](screenshots/05-workspace-switcher.png)

The switcher at the top of the sidebar is how multi-tenancy becomes visible. Each workspace has its
own projects, members, activity and analytics, and every API query is scoped to one workspace — the
seeded `priya.sharma` account belongs to two workspaces so you can watch data stay separate.

### 2.3 The application shell

The shell is the same on every workspace route, and it carries two pieces of live telemetry:

- **The link indicator** (top right) reports the actual socket state: `Live`, `Linking` or `Offline`.
  It is driven by real Socket.IO connect/disconnect events, not a timer.
- **Presence** (sidebar footer) shows how many sockets are currently joined to this workspace.

![The notification bell open, showing live arrivals with unread markers](screenshots/06-notifications.png)

The bell is fed by `notification:created` socket events, so an assignment or comment appears without a
refresh. Each item deep-links to the task it is about; unread items carry a dot, and *Mark all read*
clears the count. Per-user delivery preferences live in Settings → Notifications.

### 2.4 Dashboard

![The dashboard: four readouts, assigned work, upcoming deadlines, recent activity and team workload](screenshots/04-dashboard.png)

The dashboard is a personal snapshot computed by a MongoDB aggregation pipeline:

- **Four readouts** — my open tasks, my overdue, completed this week, project count. Overdue is
  tinted by tone, so the number itself carries the signal.
- **Assigned to me** and **Upcoming deadlines** — the next seven days of work, with status and
  priority chips, each row linking straight to the task.
- **Recent activity** — the workspace audit trail (who created, moved, commented on what).
- **Team workload** — open tasks per member with the overdue portion called out.

### 2.5 Projects

![The projects page: each project is a module with its key, progress bar and per-status counts](screenshots/08-projects.png)

A project owns a board and a task-key prefix (`WEB`, `PLT`, `MOB`), which is how task identifiers
become readable and stable (`WEB-1`, `WEB-2`, …). Each card shows completion as a bar plus the
per-status counts, and archived projects can be listed on demand.

![The new project dialog: name, key and description](screenshots/09-new-project-dialog.png)

Keys are unique per workspace and validated as 2–6 letters; the dialog previews the task ids the key
will produce.

### 2.6 The Kanban board

![The board: five lanes with per-status rails, task cards showing key, priority, labels, counts and due dates](screenshots/10-board.png)

This is the centre of the product. Five lanes (Backlog, Todo, In Progress, In Review, Done) each
carry a top rail in their status colour, so the shape of the work is visible before you read a word.

Cards are draggable with `@dnd-kit`. A drag is applied optimistically, then confirmed by the server:
if someone else changed the same task first, the compare-and-set fails with `409 VERSION_CONFLICT`,
you get a toast, and the board refreshes with the latest state instead of silently overwriting their
work. Ordering uses a fractional `position`, so a move is a single-field update.

The right-hand `VIEWING` chip shows who else has this board open, verified server-side before the
socket joins the project room.

![The board filtered to High priority: the filter strip, and only High tasks remaining](screenshots/11-board-filters.png)

The filter strip combines full-text search with assignee and priority filters. Filters are applied by
the API, not in the browser — the query is indexed and the visible count reflects the result set.

![The task dialog: title, description, status, priority, assignees, due date and labels, with a sticky action bar](screenshots/12-new-task-dialog.png)

Task creation and editing use one dialog. Because board payloads omit long descriptions to keep the
board read small, the dialog hydrates the full task before saving so an edit can never wipe a
description the list never carried.

### 2.7 Task detail — the collaboration surface

![Task detail with the comments thread, and the meta panel for status, priority, assignees, due date and labels](screenshots/13-task-comments.png)

The task is where work is argued about. Four tabs sit over an inline-editable meta panel:

- **Comments** — cursor-paginated, author-only editing (even admins cannot rewrite someone else's
  words; they can moderate by deleting).
- **Subtasks** — one level deep, tickable, rolled up as a count on the parent card.
- **Files** — attachments through a pluggable storage driver.
- **History** — this task's slice of the activity log.

![The subtasks tab: one subtask, completed, with its own key](screenshots/14-task-subtasks.png)

![The files tab: an uploaded text file with size, uploader and time](screenshots/15-task-files.png)

Uploads are limited to 10 MB against an explicit MIME allow-list — images, PDF, office documents,
plain text, CSV and ZIP. SVG is deliberately excluded as a stored-XSS vector, and downloads stream
through the API behind a membership check rather than redirecting to a public URL. The row above
shows the result: filename, size, uploader and relative time.

![The history tab: a timeline of everything that happened to this task](screenshots/16-task-history.png)

### 2.8 Team, roles and invitations

![The team page: members with their roles, join dates, and pending invitations](screenshots/17-team.png)

Roles are enforced on the server; the UI only mirrors them:

| Role | Can do |
| --- | --- |
| `viewer` | Read everything in the workspace; every write returns `403` |
| `member` | Create and edit tasks, comment, upload files |
| `admin` | Everything a member can, plus invitations, role changes, project archive/delete, workspace settings |
| `owner` | Everything, including transferring ownership and deleting the workspace |

Guardrails: you cannot change your own role, admins cannot touch the owner, the last owner cannot
leave (`LAST_OWNER`), and removing a member unassigns them from every task.

![The invite dialog after sending: the shareable link, shown because no SMTP server is configured](screenshots/18-invite-dialog.png)

Invitations are hashed, single-use and expire. With no SMTP configured the API logs the email and
returns the link to the admin, so the flow is fully testable offline. Note the security shape of that
link: the token in the URL is stored only as a hash, and accepting it requires being signed in as the
invited address (`EMAIL_MISMATCH` otherwise).

![The invitation landing page: who invited you, to which workspace, in which role](screenshots/19-invitation.png)

### 2.9 Analytics

![Analytics: completion rate, overdue, cycle time, completion trend, status mix, workload and per-project progress](screenshots/20-analytics.png)

Everything here comes from real aggregation pipelines over live task data, cached for 60 seconds
(Redis when available) and invalidated by task writes. The range selector moves between 7, 30 and 90
days; the readouts, trend, status distribution, workload split and per-project progress all follow it.

### 2.10 Settings

![Workspace settings: name, workspace URL and the member-invite toggle](screenshots/21-settings-workspace.png)

Five tabs, each with a real job:

| Tab | Contents |
| --- | --- |
| Workspace | Name, slug, and whether members may invite teammates (admin+) |
| Profile | Name, avatar URL, theme (light/dark/system) |
| Notifications | In-app and email delivery preferences |
| Security | Every active session with device and IP, revoke one or all others |
| Danger zone | Leave the workspace (non-owners) or delete it (owner, cascading) |

![Profile settings: name, avatar URL and theme selector](screenshots/22-settings-profile.png)

![Notification preferences: in-app and email toggles](screenshots/23-settings-notifications.png)

![Security settings: active sessions with device, IP and start time, plus revoke actions](screenshots/24-settings-security.png)

The security tab is the visible half of the session model: refresh tokens rotate on every use, so
revoking a session here immediately stops that device from refreshing, while its 15-minute access
token expires on its own (a documented trade-off).

![Danger zone: deleting the workspace, with the cascade spelled out](screenshots/25-settings-danger.png)

### 2.11 Light theme

![The dashboard in light mode: warm off-white ground, the same ember accent](screenshots/07-dashboard-light.png)

The light theme is a tuned companion to the dark one, not an inversion: the ground is warm off-white,
the accent deepens for contrast on paper, and every semantic colour is re-derived for a light
background (`packages`-level tokens, described in section 4).

### 2.12 Responsive behaviour and edge states

![The board at 390px: the sidebar collapses to a drawer, filters stack, lanes scroll horizontally](screenshots/26-mobile-board.png)

At phone width the shell collapses to a drawer, the filter strip stacks, and the board keeps its
horizontal lane scroll rather than crushing five columns into 390 pixels.

![The navigation drawer open over the board on a phone](screenshots/27-mobile-nav.png)

![The 404 page](screenshots/28-not-found.png)

---

## 3. How the system is built

```
flowforge/
├── apps/
│   ├── api/                  # Express + Mongoose + Socket.IO (modular monolith)
│   │   ├── src/config/       # env validation, db, redis, logging, storage driver
│   │   ├── src/middleware/   # request-id, auth, tenancy loaders, RBAC, validation, errors, limits
│   │   ├── src/modules/      # auth · users · workspaces · projects · tasks · comments
│   │   │                     # attachments · activity · notifications · analytics
│   │   ├── src/realtime/     # Socket.IO gateway (rooms, presence)
│   │   ├── src/jobs/         # BullMQ queue with an inline fallback
│   │   ├── src/models/       # 11 collections with tenant-scoped indexes
│   │   ├── src/tests/        # 66 integration tests against a real MongoDB
│   │   └── scripts/          # seed, benchmark, load smoke, e2e bootstrap, experiments
│   └── web/                  # React 19 + Vite + Tailwind v4 + TanStack Query + Zustand
│       ├── src/features/     # auth, onboarding, dashboard, projects, board, task, team,
│       │                     # analytics, settings, notifications, invitations
│       ├── src/components/   # design system (Radix-based) + layout shell
│       ├── src/lib/          # api client with single-flight refresh, query keys, chart theme
│       └── e2e/              # Playwright journeys
├── packages/
│   ├── shared/               # zod schemas, constants, DTO contracts (API ⇄ web)
│   └── config/               # shared TypeScript base config
├── infra/                    # nginx, Prometheus, Grafana dashboard
├── load/k6/                  # k6 scenario with p95 thresholds
├── docs/                     # architecture, API, benchmarks, experiments, demo, this guide
└── docker-compose.yml        # mongo + redis + api + web
```

**The API is a modular monolith**: one deployable, but each domain owns a route file (HTTP) and a
service file (rules). Boundaries stay honest without paying for distributed systems before they earn
it.

### 3.1 Request lifecycle

Every `/api/v1` request flows through the same chain:

1. `requestIdMiddleware` — attaches and propagates `x-request-id`.
2. `pino-http` — one structured log line per request, secrets redacted.
3. `metricsMiddleware` — Prometheus histogram/counter labelled with the matched route.
4. `helmet`, `cors`, `compression`, `express.json` (1 MB), `cookie-parser`.
5. Rate limiters — global 600/min, auth 30/15 min, uploads 60/min (skipped in tests).
6. `requireAuth` — verifies the JWT access token.
7. **Tenancy loader** — `requireWorkspace | requireProject | requireTask | requireComment` resolves
   the resource, loads the caller's membership, and returns `404` when they are not a member.
8. `requireRole(min)` — the server-side RBAC gate.
9. `validate({ body, query, params })` — zod parsing with defaults; handlers trust the result.
10. Handler → service — every query filtered by `ctx.workspace._id`; writes record activity.
11. Error middleware — maps `AppError`, zod, mongoose and multer failures to
    `{ error: { code, message, details?, requestId } }`.

### 3.2 Data model

Eleven collections: `users`, `workspaces`, `memberships`, `invitations`, `projects`, `tasks`,
`comments`, `attachments`, `activitylogs`, `notifications`, `sessions`.

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
```

Indexes are chosen for the queries the product actually makes, and proven with `explain`:

| Index | Purpose |
| --- | --- |
| `membership { workspaceId, userId } unique` | one membership per user per workspace |
| `workspace.slug unique`, `project { workspaceId, key } unique` | readable, tenant-scoped identifiers |
| `task { workspaceId, projectId, status, position }` | board reads |
| `task { workspaceId, assigneeIds, status, dueDate }` | my tasks, workload, overdue |
| `task { workspaceId, parentTaskId }`, `{ workspaceId, createdAt, _id }`, text on `{title, description}` | subtasks, cursor feeds, search |
| `activity { workspaceId, createdAt, _id }`, `{ workspaceId, taskId, createdAt }` | feeds |
| `invitation.expiresAt`, `session.expiresAt` TTL | automatic cleanup |
| `session.refreshTokenHash unique`, `invitation.tokenHash unique` | only hashes are stored |

### 3.3 Real-time design

- Socket.IO authenticates with the access token during the handshake.
- `workspace:join` and `project:join` re-verify membership server-side; foreign rooms get
  `{ ok: false }` and never receive events.
- Rooms: `user:{id}` (notifications), `workspace:{id}` (task/comment/activity/member events),
  `project:{id}` (presence).
- **Events are emitted after the database write**, so clients can never observe unsaved state.
- Clients patch caches in place for `task:updated` (no refetch flicker) and invalidate for structural
  changes. On reconnect they re-join rooms and invalidate everything — the guaranteed resync path.

### 3.4 Security model

- **Passwords**: scrypt (N=16384, r=8, p=1), never returned by the API; unknown emails are
  timing-equalised so the endpoint cannot be used to enumerate accounts.
- **Sessions**: hashed refresh tokens, rotation, reuse detection, per-session revocation.
- **Authorization**: every workspace-owned resource is reached through a tenancy loader; role checks
  are server-side, and the UI merely mirrors them. Cross-tenant reads answer `404`, never `403`,
  because a `403` would confirm that another tenant's resource exists.
- **Input**: zod at the boundary, MIME allow-list for uploads, filename sanitisation,
  `Content-Disposition` + `nosniff` on downloads, regex escaping where patterns are built.
- **Secrets**: environment-driven, `.env` gitignored, logs redact auth headers, cookies and tokens.
  Production posture is enforced by env validation: `SEED_ON_START`, `RATE_LIMIT_DISABLED`, default
  JWT secrets and `COOKIE_SECURE=false` are all refused when `NODE_ENV=production`.

### 3.5 Graceful degradation

Redis, SMTP and S3 are optional, and the fallbacks are real implementations rather than stubs:

| Concern | With Redis | Without Redis |
| --- | --- | --- |
| Analytics/dashboard snapshots | Redis keys with TTL, prefix-busted on writes | in-process Map with the same semantics |
| Workspace member "minis" | 30 s TTL, busted on membership writes | same |
| Email + notification delivery | BullMQ queue with retries and backoff | inline `await` with identical outcomes |
| Rate-limit counters | in-process per instance | in-process per instance |

Reads of a cold cache key are **single-flight per process**: 50 parallel cold requests produce
exactly one database query and 49 coalesced waiters (measured in Experiment 3).

---

## 4. The frontend design system

The interface is a dark-first "forge console": a warm-void graphite ground, hairline instrument
panels, one ember-gold signal colour, and monospace telemetry for every identifier, count and label.

### 4.1 Why this direction

The palette is a deliberate rejection of the reflex that most generated SaaS interfaces share — a
blue-violet primary (`#7c5cff`-alike) on cold grey. Here the ground is a **warm** near-black (hue 70,
chroma ≤ 0.012) and the signal colour is **ember gold** (`oklch(0.75 0.155 57)`), which ties to the
product's own name: a forge is heat and metal.

Status colours are not a rainbow either. They form a **temperature ramp** used consistently everywhere
a status appears:

| Status | Colour | Meaning in the ramp |
| --- | --- | --- |
| Backlog | warm neutral | not started |
| Todo | steel blue | queued, cool |
| In Progress | ember gold | the hot middle — work in flight |
| In Review | chartreuse | caution, nearly resolved |
| Done | spring green | settled |

Priority and role chips draw from the same five hues, so the palette never grows.

### 4.2 Tokens

Everything is defined once in `apps/web/src/index.css`:

- **Surfaces** — `background`, `surface-1/2/3`, `card`, `sidebar`, each tinted toward the brand hue.
- **Edges** — hairline borders at 12% and 22% white, so panels read as edge-lit rather than outlined.
- **Depth** — `panel`, `lift`, `overlay` and `glow` shadow tokens. In dark mode depth comes from
  emitted light (an inset top highlight plus an accent glow), which is why cards do not carry
  drop shadows.
- **Motion** — `ease-quart`, `ease-expo`, `ease-snap`, three durations, plus `prefers-reduced-motion`
  as a global kill switch.
- **Utilities** — `.ff-panel`, `.ff-panel-hover`, `.ff-label`, `.ff-num`, `.ff-notch`, `.ff-brackets`,
  `.ff-hair`, `.ff-skeleton`, `.ff-dot-live`, `.ff-stagger`. They live in the *components* layer so any
  Tailwind utility can still override them.

Type: the system stack for UI text, and a real monospace stack for telemetry (task keys, counts,
section eyebrows, timestamps). No webfont is downloaded — the app has to work offline and inside
Docker without a font CDN, and the register is carried by geometry, colour and mono instead.

### 4.3 Accessibility

Treating access as the floor produced concrete fixes rather than intentions:

- A 2px accent focus ring with offset on **every** interactive element, including the ones that had
  hover styling but no focus indicator at all.
- Icon buttons expand to a 44px hit area on coarse pointers.
- Form controls render at 16px below 640px, so iOS Safari does not zoom the page on focus, and
  `maximum-scale` is left alone so pinch-zoom still works.
- Status is never carried by colour alone: every chip pairs its tint with a dot and a text label.
- The board's search field has a real accessible name, not just a placeholder.
- Contrast: destructive actions use dark text on bright red (6.7:1) instead of white on red (3.36:1,
  which fails AA); light-theme links were darkened to 4.7:1.

---

## 5. API surface

The exhaustive reference — every parameter, permission and error code — is [docs/API.md](./API.md).
It stays the single source of truth for request shapes; this is the map of it.

| Group | Base path | Highlights |
| --- | --- | --- |
| Health & metrics | `/api/v1/health`, `/metrics` | `{ status, uptimeSeconds, db, cache, queues, version }`; 503 when the database is down |
| Auth | `/api/v1/auth/*` | register, login, refresh (rotating), logout, logout-all, sessions list/revoke |
| Users | `/api/v1/users/*` | profile, preferences (theme, notification delivery) |
| Workspaces | `/api/v1/workspaces/*` | create, read by id **or slug**, update, delete, leave, members, invitations |
| Invitations | `/api/v1/invitations/*` | public preview by token, authenticated accept |
| Projects | `/api/v1/projects/*` | CRUD with per-status task counts; archive is a status change |
| Tasks | `/api/v1/tasks/*` | cross-project list, board read (`?sort=position`), subtasks, versioned PATCH |
| Comments | `/api/v1/comments/*` | cursor-paginated, author-only edit, author/admin delete |
| Attachments | `/api/v1/attachments/*` | multipart upload (10 MB, MIME allow-list), streamed download, delete |
| Activity | `/api/v1/workspaces/:id/activity` | cursor feed filterable by task, project or actor |
| Notifications | `/api/v1/notifications/*` | cursor feed, unread count, mark one/all read |
| Analytics | `/api/v1/workspaces/:id/analytics` | `?range=7..90`, dashboard snapshot |
| Realtime | `/socket.io` | workspace/project/user rooms, presence |

Two conventions are worth internalising before reading the code:

- **Writes are versioned.** `PATCH /tasks/:id` requires the `version` you last read. A stale version
  returns `409 VERSION_CONFLICT` with `details.latest` so the client can recover instead of guessing.
- **Cross-tenant access returns `404`.** A `403` would leak the existence of another tenant's data.

---

## 6. Performance and scalability

Every number below is from a committed artifact, not an estimate. Methodology and raw JSON:
[docs/BENCHMARKS.md](./BENCHMARKS.md), [docs/SCALABILITY_EXPERIMENTS.md](./SCALABILITY_EXPERIMENTS.md),
`docs/benchmark-results.json`, `docs/load-smoke-results.json`, `docs/experiments/*.json`.

**Index proof (`npm run bench`).** The board query was measured with and without its compound index:
p95 **17.6 ms → 1.8 ms**, documents examined **20,000 → 40**.

**Six scalability experiments (`npm run exp:1` … `exp:6`):**

| Experiment | What it proves | Measured |
| --- | --- | --- |
| Load at 10/50/100 connections | Where a single process saturates | Dashboard/board p97.5 ≈ 190–245 ms at 50 connections; analytics 413 rps warm |
| 400k-document database | Query shapes scale beyond the demo dataset | 88–229× p95 across the app's query shapes |
| Caching | Cache hit ratio, single-flight, freshness bounds | 100% hit ratio; 50 cold parallel requests → 1 database query |
| Horizontal scaling | Two instances behind a balancer | 1.46–1.59× throughput, 0 errors, cross-instance event in 97 ms |
| Concurrent writes | Optimistic concurrency under contention | 20 rounds, 0 lost updates, 0 duplicate events |
| Failure drills | Behaviour while things break | Rolling restart and dependency failures: 0 failed requests, 0 jobs lost |

**Honest reading.** At 100 concurrent connections a single process on one machine saturates at around
200 rps and latency queues, because the load generator, the API and MongoDB share one CPU. That is a
property of the topology, not a capacity claim. Two instances lift throughput 1.46–1.59× at equal or
better tail latency, and the failure drills show zero failed requests through a rolling restart.

The exercises also found four real defects, which is the point of running them: the board silently
truncating at 25 tasks, the Socket.IO Redis adapter never starting, websockets holding the graceful
drain to its timeout, and the cache having no stampede protection. All four are fixed.

---

## 7. Verification

```bash
npm run typecheck   # strict TypeScript across api, web and shared
npm test            # 66 API integration tests + 16 web unit tests (needs MongoDB)
npm run e2e         # 6 Playwright journeys against a seeded stack
npm run build       # tsup (API) + vite (web)
npm run bench       # writes docs/benchmark-results.json
npm run load        # writes docs/load-smoke-results.json
```

Current status, as last run on this machine:

| Check | Status | Detail |
| --- | --- | --- |
| API typecheck / build | passing | `tsc --noEmit`, `tsup` bundle |
| API integration tests | 66 passing | real MongoDB: tenancy, RBAC, OCC races, pagination, invitations, sockets |
| Web typecheck / build | passing | route-level code splitting; initial JS 196 kB gzip |
| Web unit tests | 16 passing | refresh single-flight, drag-drop math, task card |
| Playwright E2E | 6 passing | register → workspace → board → task → comment, plus filters |
| Query benchmark | measured | `docs/benchmark-results.json` |
| HTTP load smoke | measured | `docs/load-smoke-results.json` |
| Scalability experiments | 6 measured | `docs/experiments/*.json` |

The suites are not decorative. They are the reason the claims in section 1 can be made at all:

- `tenancy.test.ts` walks 11 cross-tenant attack paths and asserts `404` (never `403`).
- `auth.test.ts` replays a rotated refresh token and asserts the whole family is revoked.
- `tasks.test.ts` races two same-version writes and asserts exactly one winner plus a `409` carrying
  the latest payload.
- `rbac.test.ts` drives writes as viewer, member and admin.
- `realtime.test.ts` tries to join a foreign room and asserts it receives nothing.

---

## 8. Running and operating it

**Local development**

```bash
npm install --include=dev      # --include=dev matters if NODE_ENV=production is set globally
cp .env.example .env           # Windows: copy .env.example .env
npm run seed                   # demo dataset: 8 users, 2 workspaces, 4 projects, 56 tasks
npm run dev                    # API on :4000, web on :5173
```

Open **http://localhost:5173** and sign in as `aarav.mehta@flowforge.dev` / `Password123!`. The
password is shared by every seeded account; other accounts and their roles are listed in
[HOW_TO_RUN.md](../HOW_TO_RUN.md#demo-accounts-from-the-seed).

**Containers**

```bash
docker compose up --build      # → http://localhost:8080 (nginx front door)
```

The compose stack runs MongoDB, Redis, the API and an nginx-served web build, seeds the demo dataset
on first boot and wires `/api` and `/socket.io` through the proxy.

**Ports and services**

| Service | Local dev | Docker | Notes |
| --- | --- | --- | --- |
| Web | 5173 | 8080 | proxies `/api` and `/socket.io` |
| API | 4000 | 4000 | `/api/v1/health`, `/metrics` |
| MongoDB | 27017 | 27017 | `flowforge_dev`, `flowforge_test`, `flowforge_e2e` |
| Redis | 6379 | 6379 | optional; enables shared cache, queues and rate limits |

**Commands**

```bash
npm run dev         # API + web with watch mode
npm run seed        # idempotent; SEED_RESET=true wipes first
npm run test:api    # integration suite only
npm run test:web    # unit suite only
npm run e2e         # Playwright against a seeded stack
npm run exp:1 …6    # the scalability experiments
npm run format      # prettier
```

### 8.1 Delivery pipeline

**CI** (`.github/workflows/ci.yml`) runs on pushes to `main`/`develop` and on pull requests:

1. **verify** — install, typecheck all workspaces, API integration tests, web unit tests, both
   production builds, against a MongoDB service container.
2. **e2e** — installs Chromium and runs the Playwright suite against an API booted with a seeded
   disposable database; the report is uploaded as an artifact.
3. **docker** — validates `docker compose config` and builds both images (on `main`).

**CD** (`.github/workflows/deploy.yml`) publishes multi-tagged images to GHCR on every `main` push and
deploys over SSH **only when the `DEPLOY_*` secrets are configured**; without them it explains the
skip instead of failing.

**Observability.** The API exposes Prometheus metrics (request histograms and counters, a websocket
gauge, process metrics) with `infra/monitoring/prometheus.yml` and a
`infra/monitoring/grafana-dashboard.json` to light up. `load/k6/flowforge.js` runs a k6 scenario with
p95 thresholds for load testing outside the machine that serves the app.

---

## 9. Troubleshooting

**"A page crashes with `Cannot read properties of null` in dev."** This is a stale Vite dependency
cache, not an application bug: when Vite re-optimizes mid-session, modules can end up referencing two
different hashes of React. Stop the dev server, delete `apps/web/node_modules/.vite`, and start again.

**"`npm run e2e` behaved oddly / wrote to my dev database."** Playwright's config sets
`reuseExistingServer: !CI`, so if anything already answers on `http://localhost:4000` it is reused —
including its database. Stop `npm run dev` first if you want the run to use the disposable
`flowforge_e2e` database.

**"`npm install` skipped dev dependencies."** Your shell has `NODE_ENV=production` set. Re-run with
`npm install --include=dev`; every project script pins its own `NODE_ENV`, so nothing else is affected.

**"Vite is up but `127.0.0.1:5173` refuses the connection."** Vite binds to `localhost`, which resolves
to IPv6 `[::1]` on some Windows setups. Use `http://localhost:5173`, not the IPv4 literal.

**"Invitation emails never arrive."** Expected: without `SMTP_URL` the mailer logs to the console and
the admin is shown the shareable invite link instead, so the flow works fully offline.

---

## 10. Known limitations and future work

Documented honestly, because a project that claims none is not telling the truth:

- **Access token revocation window.** Access tokens stay valid for up to 15 minutes after a session is
  revoked; revocation is immediate for refresh. A revoked-session cache in `requireAuth` would close
  this, at the cost of one lookup per request.
- **Single-process fallbacks.** Without Redis, the cache, queues and rate-limit counters are
  per-instance. Correct on one machine, not shared across replicas.
- **Bounded caches.** Workspace documents (30 s), memberships (15 s) and user existence (30 s) are
  cached, so changes made *outside* the API propagate within those windows (API-driven changes
  invalidate immediately).
- **Attachment storage.** The S3 driver is implemented and type-checked but has not been exercised
  against a live bucket here; local disk is the default.
- **Float position exhaustion.** Fractional ordering runs out of precision after roughly 50
  consecutive same-gap inserts; column renormalisation is the documented fix.
- **Board size.** Boards are bounded snapshots (500 tasks); column-level pagination is future work.
- **Password reset and email verification** are not implemented, though the mailer and queue exist.
- **Repo formatting.** `npm run format:check` currently fails on files untouched by the front-end
  revamp (for example `apps/api/src/config/db.ts`); only files changed in a given commit are
  formatted, to avoid unrelated reformatting noise.

---

## 11. Documentation index

| Document | Covers |
| --- | --- |
| [README.md](../README.md) | Front door: what the project is, headline claims, quick start |
| [HOW_TO_RUN.md](../HOW_TO_RUN.md) | Setup, demo accounts, and how to exercise every feature by hand |
| [DECISIONS.md](../DECISIONS.md) | Environment facts, conventions, the reasoning behind each decision, open questions |
| [docs/ARCHITECTURE.md](./ARCHITECTURE.md) | Modules, data model, request lifecycle, realtime design, security model |
| [docs/API.md](./API.md) | Every endpoint with permissions and error codes |
| [docs/BENCHMARKS.md](./BENCHMARKS.md) | Benchmark methodology and measured results |
| [docs/SCALABILITY_EXPERIMENTS.md](./SCALABILITY_EXPERIMENTS.md) | The six experiments, raw numbers, reproduction commands |
| [docs/DEMO.md](./DEMO.md) | A 5–7 minute scripted demo of the whole product |
| [docs/PROJECT_GUIDE.md](./PROJECT_GUIDE.md) | This document: everything, including the screenshot tour |
| [docs/screenshots/](./screenshots) | The 28 screenshots used above |

---

*Screenshots were captured from the running application at 1440×900 (desktop) and 390×844 (mobile)
against the seeded demo dataset, in both themes.*
