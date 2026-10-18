# FlowForge — Run & Use Guide

Everything you need to get FlowForge running and to exercise **every** feature, including the demo
accounts, real-time behaviour, permissions and the security checks you can verify yourself.

---

## 1. Prerequisites

| Requirement | Version used here | Notes |
| --- | --- | --- |
| Node.js | 22.x | ≥ 20 works |
| npm | 10+ | workspaces support |
| MongoDB | 8.x | local service **or** Docker |
| Redis | 7.x | *optional* — cache/queues fall back in-process |
| Docker Desktop | 24+ | only for the container path |

Check what you have:

```bash
node -v && npm -v
mongod --version          # or: docker --version
```

## 2. Setup (local development)

```bash
cd flowforge

# 1) Install all workspaces (API, web, shared packages)
npm install --include=dev

# 2) Environment: the committed defaults target localhost MongoDB
cp .env.example .env       # Windows: copy .env.example .env

# 3) Load the demo dataset (8 users, 2 workspaces, 4 projects, 56 tasks)
npm run seed

# 4) Start API (:4000) and web (:5173) together
npm run dev
```

Open **http://localhost:5173**.

> **Troubleshooting:** if `npm install` skipped dev dependencies (or later commands fail with
> "tsc is not recognized"), your shell has `NODE_ENV=production` set — that makes npm omit dev
> dependencies. Re-run with `npm install --include=dev`; all project scripts already pin their own
> `NODE_ENV`, so nothing else is affected.

### Demo accounts (from the seed)

| Email | Workspace / role | Password |
| --- | --- | --- |
| `aarav.mehta@flowforge.dev` | Acme Corp — **owner** | `Password123!` |
| `priya.sharma@flowforge.dev` | Acme Corp — admin (also Nebula member) | `Password123!` |
| `rohan.gupta@flowforge.dev` | Acme Corp — member | `Password123!` |
| `arjun.rao@flowforge.dev` | Acme Corp — **viewer** (read-only) | `Password123!` |
| `sara.khan@flowforge.dev` | Nebula Labs — owner | `Password123!` |

`priya` belonging to **two** workspaces is intentional — it makes multi-tenancy observable.

### Container path (MongoDB + Redis + API + web)

```bash
docker compose up --build     # first build takes a few minutes
# web → http://localhost:8080  (nginx, proxies /api and /socket.io)
# api → http://localhost:4000  (direct, for curl/pgAdmin)
# API seeds the demo dataset on first boot (SEED_ON_START=true)
```

Use `SEED_RESET=true docker compose up -d api` to wipe and reseed.

### Production-shaped stack (Traefik + replicas + worker + replica set + SeaweedFS)

The real deployment topology is `docker-compose.prod.yml` — the same file CI validates and the deploy
workflow drives. It needs only Docker:

```bash
# 1) configuration: export the variables (shell env wins over the repo's dev .env).
#    .env.prod.example is the full reference/template; on a deploy host it becomes that host's .env.
export JWT_ACCESS_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
export APP_URL=http://localhost CORS_ORIGINS=http://localhost   # your public origin otherwise
# 2) build + start (Traefik publishes :80; every other service stays internal)
npm run stack:up
docker compose -f docker-compose.prod.yml up -d --scale api=3 --scale worker=1
# 3) demo data for a demo/staging stack (refused unless explicitly forced)
docker compose -f docker-compose.prod.yml run --rm --no-deps -e SEED_FORCE=true api \
  node apps/api/dist/scripts/seed.js
# 4) verify through the edge
curl http://localhost/api/v1/health/ready    # {"status":"ready","checks":{"db":"up","redis":"up"}}
curl http://localhost/api/v1/health          # liveness + cache/queue backends

# Optional observability: Prometheus scrapes every replica (per-replica /metrics are internal)
docker compose -f docker-compose.prod.yml --profile observability up -d
#   Prometheus → http://localhost:9090   Grafana → http://localhost:3000

# Teardown
npm run stack:down
```

Notes that save time:
- **Repeat `--scale` on every `up`** — omitting it silently drops back to one replica.
- The repo-root `.env` is the *development* file and would leak dev values into interpolation; the
  production stack must run with exported variables or from a deployment directory whose `.env` holds
  production values (env validation refuses the dev JWT secret and requires Redis).
- Open the app itself at **http://localhost** (Traefik routes `/` → web, `/api` + `/socket.io` → the
  api pool). Because `COOKIE_SECURE=true` is enforced in production, browser refresh-cookie flows need
  HTTPS at the edge; for API-level checks (curl, the experiments) access tokens work over HTTP.
- Secure the bundled SeaweedFS credentials (`infra/seaweedfs/s3.json`) like any other secret before
  exposing the stack.

---

## 3. Using the features

### 3.1 Accounts, sign-in and sessions

1. **Register** at `/register` (password needs 8+ chars with a letter and a number).
2. New accounts start at **onboarding** — create your first workspace (you become its owner).
3. **Sign out** from the avatar menu → *Log out*.
4. **Security settings** → Settings → *Security*: view every active session (device + IP), revoke a
   single one, or "Sign out other sessions". Refresh tokens rotate on every use; replaying an old one
   revokes the whole session family (that behaviour is asserted in `auth.test.ts`).

### 3.2 Workspaces and switching

- The **workspace switcher** sits at the top of the sidebar — jump between Acme Corp and Nebula Labs
  (sign in as `priya` to see both).
- Each workspace keeps separate projects, tasks, members, activity and analytics. Switching is
  instant because every query is workspace-scoped.

### 3.3 Projects and the Kanban board

1. **Projects** in the sidebar → *New project* (key like `WEB` becomes task ids `WEB-1`, `WEB-2`…).
2. Click a project to open its **board**: Backlog, Todo, In Progress, In Review, Done.
3. **Drag a card** between columns or reorder inside one. Updates are optimistic; if someone else
   changed the same task first you get a *version conflict* toast and the board refreshes with the
   latest state (server-side compare-and-set, not a silent overwrite).
4. **Filters**: search (full-text), assignee, priority. *Clear* restores the full board.
5. Click any card → the **task dialog** to edit title, description, status, priority, assignees
   (workspace members only), due date and labels.

### 3.4 Task detail — the collaboration surface

Open a card and use the tabs:

- **Comments** — post, edit your own (author-only), delete your own; admins can moderate others.
  Cursor-paginated ("Load older comments").
- **Subtasks** — one level deep; tick to complete. Cards show the subtask count.
- **Files** — upload images/PDF/office/text/CSV/ZIP up to 10 MB (an explicit MIME allow-list — SVG and
  executables are rejected). Download streams through the API behind a membership check. Uploader or
  an admin can delete.
- **History** — the task's slice of the workspace activity log.
- The right sidebar edits **status, priority, assignees, due date and labels inline**.

### 3.5 Real-time collaboration (the two-window demo)

1. Open a project board in one window; use a private/incognito window for the second account.
2. Drag a task in window A → it moves in window B **without a refresh**.
3. Comment on a task in A → B's comment list and notification bell update live.
4. Watch the topbar of the sidebar: **"N people online"**, and on the board: avatar chips of who is
   *viewing* it.
5. Kill the API for a moment (`Ctrl+C` in the `npm run dev` terminal is not needed — use
   `docker compose restart api`, or just close a laptop lid) → the client automatically reconnects
   and **resyncs everything** it may have missed.

### 3.6 Team, invitations and roles

1. **Team** → *Invite member*: pick email + role.
   - No SMTP configured? The dialog shows a **shareable invite link** (and the API also logs the email).
   - Open the link in another browser profile → sign in/register with the invited email → *Accept*.
2. A **pending invitations** list (admins) shows expiry and lets you revoke.
3. **Role matrix** (server-enforced):
   - `viewer` — read-only; every write returns `403`.
   - `member` — create/edit tasks, comment, upload; cannot manage people/settings.
   - `admin` — invite, change roles, archive/delete projects, workspace settings.
   - `owner` — everything, incl. transferring ownership and deleting the workspace.
   - Guardrails: you cannot change your own role, admins cannot touch the owner, the last owner
     cannot leave (`LAST_OWNER`), and removing a member unassigns them from all tasks.
4. Try it: promote `rohan` using the role dropdown, then sign in as `arjun` (viewer) and confirm the
   "New task" button is gone **and** that a direct `PATCH` with his token is rejected.

### 3.7 Analytics and the dashboard

- **Dashboard**: your open tasks, overdue count, completed this week, upcoming deadlines, recent
  activity, team workload bars.
- **Analytics**: range selector (7/30/90 days), completion vs creation trend, status distribution,
  workload by member (with overdue split), per-project progress, average cycle time.
- Data comes from real MongoDB aggregation pipelines, cached for 60 s (Redis when available) and
  invalidated by task writes — add a task and refresh to see the numbers move.

### 3.8 Notifications

The bell shows unread counts and live arrivals (assignments, comments, status changes, invitations
accepted). Click to jump to the task; *Mark all read*; per-user preferences live in Settings →
*Notifications*.

### 3.9 Settings

- **Workspace** (admin+): name, "members can invite" toggle.
- **Profile**: name, avatar URL, theme (light/dark/system).
- **Security**: sessions (above).
- **Danger zone**: leave workspace (non-owners) or delete it (owner — cascades projects, tasks,
  comments, files, members).

---

## 4. Verifying the engineering claims yourself

```bash
npm run typecheck            # all workspaces
npm test                     # 85 API + 16 web tests (needs local MongoDB)
npm run build                # tsup (API) + vite (web)

npm run bench                # MongoDB indexed vs unindexed benchmark → docs/benchmark-results.json
npm run load                 # autocannon scenarios → docs/load-smoke-results.json
npm run exp:1 … exp:6        # scalability experiments against local infra → docs/experiments/
npm run exp:7                # production topology under load (needs Docker Desktop; leaves the stack up)
npm run exp:8                # replica-set index build + failover + read-preference A/B
npx playwright install chromium
npm run e2e                  # Playwright boots a seeded API + web and walks auth & board journeys
                             # stop `npm run dev` first: Playwright reuses anything already on :4000,
                             # including its database, so you would run against flowforge_dev
                             # instead of the disposable flowforge_e2e

# Compose validation (what CI runs)
docker compose config -q
docker compose -f docker-compose.prod.yml config -q

# Redis-enabled cache/queue path: docker compose up -d mongo redis api
curl http://localhost:4000/api/v1/health   # → { db: connected, cache: redis, queues: redis, ... }
curl http://localhost:4000/metrics         # Prometheus exposition
```

**Tenant-isolation spot-check with curl** (proves 404-not-403 across tenants):

```bash
# login as aarav (Acme owner)
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"aarav.mehta@flowforge.dev","password":"Password123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# Nebula's workspace id (the one aarav only *views*): fetch your list and inspect roles
curl -s http://localhost:4000/api/v1/workspaces -H "Authorization: Bearer $TOKEN"
```

## 5. Ports and services

| Service | Local dev | Docker | Notes |
| --- | --- | --- | --- |
| Web (Vite) | 5173 | 8080 (nginx) | proxies `/api` + `/socket.io` |
| API | 4000 | 4000 | `/api/v1/health`, `/api/v1/health/ready`, `/metrics` |
| MongoDB | 27017 | 27017 | databases: `flowforge_dev`, `flowforge_test`, `flowforge_e2e` |
| Redis | 6379 | 6379 | optional; enables shared cache + BullMQ |
| Production stack (`docker-compose.prod.yml`) | — | 80 (Traefik) | everything else internal; optional observability profile exposes 9090/3000 |

## 6. Common tasks cheat-sheet

```bash
npm run dev                 # API + web with watch mode
npm run seed                # idempotent demo data; SEED_RESET=true to wipe first
npm run test:api            # integration suite only
npm run test:web            # unit suite only
npm run typecheck           # strict TS across the monorepo
npm run bench               # query benchmark (writes docs/benchmark-results.json)
npm run load                # HTTP load smoke (rate limiting disabled for the run)
npm run e2e                 # Playwright journeys against a seeded stack
npm run stack:up            # build + start the production topology (Traefik on :80)
npm run stack:down          # stop it
npm run exp:7 && npm run exp:8   # production-topology + replica-set experiments
npm run format              # prettier
```

Stuck? Check [DECISIONS.md](./DECISIONS.md#verification-status-and-open-questions) for environment
quirks and known limitations.
