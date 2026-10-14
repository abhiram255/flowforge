# FlowForge Benchmarks — Methodology and Measured Results

Two independent artifacts back the performance claims:

| Artifact | What it measures | File |
| --- | --- | --- |
| Query benchmark | MongoDB latency + work done, indexed vs unindexed | `docs/benchmark-results.json` |
| HTTP load smoke | End-to-end API latency under concurrency (autocannon) | `docs/load-smoke-results.json` |

Both are reproducible: `npm run bench` and `npm run load` re-generate the JSON files from scratch.
Numbers below were measured on this machine (Node v22.17.1, Windows 11 x64, local MongoDB 8.2.4) —
they describe this hardware and topology, not production capacity.

---

## 1. Database benchmark — indexed vs unindexed

**Question.** The board renders `find({workspaceId, projectId, status}).sort({position}).limit(...)`
against a workspace-scoped task collection. What does the compound index actually buy?

**Method.** Generate 20,000 task-shaped documents across 20 workspaces / 100 projects. Run the query
25× to warm up, then 200× and record p50/p95/p99 of the driver call. Capture the winning plan and
execution counters via an `executionStats` explain. Create the compound index and repeat identically.
The script aborts if the query matches nothing, so the artifact cannot silently record an empty query.

**Result (2026-10-14, `docs/benchmark-results.json`):**

| Metric | Without index | With `{workspaceId, projectId, status, position}` |
| --- | --- | --- |
| p50 | 15.54 ms | **1.30 ms** |
| p95 | 17.60 ms | **1.76 ms** |
| p99 | 20.86 ms | **2.29 ms** |
| Documents examined | **20,000** (full collection scan) | **40** (= exactly the matching rows) |
| Index keys examined | 0 | 40 |
| Plan | COLLSCAN + blocking SORT | IXSCAN on `workspaceId_1_projectId_1_status_1_position_1` |

**Takeaways.** p95 improved **10×** and the work done dropped from a full 20,000-document scan to the
40 documents that actually match — a 500× reduction in documents examined. The index also supplies the
sort order, which is why the unindexed plan needed an in-memory `SORT` stage and the indexed plan does
not. This is the justification for the index set in `apps/api/src/models/Task.ts`.

---

## 2. HTTP load smoke (autocannon)

**Method.** Boot the API in-process against a freshly seeded demo dataset (scale 4 ≈ 190 tasks,
8 users, 4 projects), log in as the workspace owner, then run six autocannon scenarios at 10 s each:
board list at 10 / 50 / 100 connections, task detail at 50, cached dashboard at 50, and a write path
(POST task) at 20. Rate limiting is disabled for the run via `RATE_LIMIT_DISABLED=true` — a flag that
is **refused when `NODE_ENV=production`**.

**Result (2026-10-14, `docs/load-smoke-results.json`):**

| Scenario | Conn. | Throughput | p50 | p97.5 | p99 | non-2xx |
| --- | --- | --- | --- | --- | --- | --- |
| Board list (service-time signal) | 10 | 156 rps | 60 ms | **104 ms** | 118 ms | 0 |
| Board list | 50 | 167 rps | 298 ms | 362 ms | 392 ms | 0 |
| Board list (saturation view) | 100 | 159 rps | 646 ms | 867 ms | 925 ms | 0 |
| Task detail (counts + aggregations) | 50 | 170 rps | 284 ms | 483 ms | 507 ms | 0 |
| Dashboard snapshot (20 s cache) | 50 | 260 rps | 179 ms | 247 ms | 672 ms | 0 |
| Task creation (write + OCC) | 20 | 98 rps | 202 ms | 278 ms | 280 ms | 0 |

> **Update — scalability pass (2026-10-14).** The table above is the original single-process smoke
> test, kept as the historical record. The follow-up work in
> [SCALABILITY_EXPERIMENTS.md](./SCALABILITY_EXPERIMENTS.md) re-ran these paths and improved them
> substantially — analytics @ 50 conns **100 → 413 rps** (p97.5 1576 → 173 ms), dashboard @ 50
> **175 → 355 rps**, task creation @ 20 **62 → 112 rps**, board @ 100 **139 → 190 rps** (and the board
> now returns *all* the project's tasks instead of the first 25) — through cache single-flight, a
> trimmed board payload, access caching, extra indexes, a shared rate-limit store and a Socket.IO
> Redis adapter. Raw artifacts: `docs/experiments/`.

### How to read this honestly

- **Service time at low concurrency** (10 conns) was p97.5 ≈ 104 ms — inside the 300 ms engineering
  target. This is the number that best reflects what a single user experiences.
- **At 50–100 connections the single process saturates at ~160 rps.** Latency then grows linearly
  with queue depth (Little's law: 100 concurrent ÷ 160 rps ≈ 0.6 s) — the measured p50 at 100
  connections (646 ms) matches that prediction almost exactly. The target of p95 < 300 ms at 100
  concurrent users is **not met** on this configuration, and the artifact says so rather than hiding it.
- **Why the ceiling is where it is:** the load generator, the API process and MongoDB all share one
  CPU; per-request CPU (JSON serialisation, compression, three driver round-trips) is the bottleneck,
  not the database (indexed reads complete in ~1 ms).
- **What was already improved and measured:** the workspace-member "minis" cache and passing the
  already-loaded project into the DTO layer removed one Mongo query per board request, and lowering
  gzip effort from level 6 → 1 cut compression CPU. Measured effect on the 10-connection scenario:
  136 → 156 rps (+15%) and p97.5 119 ms → 104 ms.

### Documented remediation path (partially implemented in the scalability pass)

1. Run the load generator on a separate machine (removes CPU contention from the numbers).
   — *partially done: the generator now runs as its own process, but the machine is still shared.*
2. Horizontal scale behind a load balancer — **implemented and measured** (two instances → 1.46–1.59×
   throughput at equal or better tail latency, shared Redis rate-limit store, Socket.IO Redis adapter
   so rooms and events span replicas; presence counts via `fetchSockets()`). See Experiment 4.
3. Trim the board payload (omit `description` from list views) — **implemented**; the edit dialog
   hydrates the full task before saving so long descriptions are never overwritten. See Experiment 1.
4. Read analytics from a MongoDB secondary; keep writes on the primary. — still open.

---

## 3. k6 scenario (browser-like mix)

`load/k6/flowforge.js` models a browsing user: workspace reads, board reads, plus a versioned write
every second of the loop. It encodes the same targets as thresholds, so a regression fails the run:

```bash
k6 run load/k6/flowforge.js                                   # against local API :4000
BASE_URL=http://localhost:8080 k6 run load/k6/flowforge.js    # against the docker stack
```

```
http_req_duration{kind:read}   p(95)<300
http_req_duration{kind:write}  p(95)<500
http_req_failed                rate<0.01
```

The ramp 5 → 50 → 100 VUs over two minutes is intentionally above the saturation point measured in
section 2, so the run reports where the single instance breaks rather than flattering it.

---

## 4. Targets vs results (summary)

| Plan target | Status | Evidence |
| --- | --- | --- |
| p95 < 300 ms on workspace reads | ✅ at 10 conns (all paths) and 50 conns (projects 245 ms, dashboard 214 ms) · ⚠️ board single-instance 489/667 ms at 50/100 conns (saturation documented) · ✅ 2.6× p97.5 improvement at 100 conns vs baseline | `load-smoke-results.json`, `docs/experiments/exp1-*.json` |
| Test at 100 / 500 / 1000 concurrent users | ⚠️ 10 / 50 / 100 tested locally; higher tiers require the remediation path above | `load-smoke-results.json`, k6 script |
| Tenant isolation: zero unauthorised accesses | ✅ 11 attack cases in the test suite, all rejected (404/403 as designed) | `tenancy.test.ts` |
| 100% of critical E2E workflows passing | ✅ in CI (`playwright` job); runnable locally with `npm run e2e` | `.github/workflows/ci.yml` |
| Indexed vs unindexed query performance documented | ✅ 10× p95, 20,000 → 40 docs examined; at 400k documents 88–229× p95 across query shapes | `benchmark-results.json`, `docs/experiments/exp2-database.json` |
| No lost committed updates under tested concurrency | ✅ OCC race test, plus 20 same-version flights and 15 retried updates with zero lost writes or duplicate events | `tasks.test.ts`, `docs/experiments/exp5-concurrency.json` |
| Zero failed requests through a rolling restart | ✅ graceful restart mid-load: 0 errors / 0 non-2xx; hard crash: 0 client-visible errors | `docs/experiments/exp6-resilience.json` |
| No jobs lost when a worker dies | ✅ 20/20 jobs completed after the worker was killed mid-flight | `docs/experiments/exp6-resilience.json` |
| Shared state across replicas | ✅ 30/60 logins throttled under one shared budget; cross-instance realtime event in 97 ms | `docs/experiments/exp4-horizontal.json` |
