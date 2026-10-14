/**
 * k6 load test for the FlowForge read paths.
 *
 *   k6 run load/k6/flowforge.js
 *   BASE_URL=http://localhost:8080 k6 run load/k6/flowforge.js   # docker stack
 *
 * Thresholds encode the engineering targets from the plan (p95 < 300 ms on
 * workspace reads). Run against the seeded demo workspace. Measured results are
 * recorded in docs/BENCHMARKS.md — this script defines the method, not a claim.
 */
import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000'
const API = `${BASE_URL}/api/v1`
const EMAIL = __ENV.DEMO_EMAIL || 'aarav.mehta@flowforge.dev'
const PASSWORD = __ENV.DEMO_PASSWORD || 'Password123!'

const conflictRate = new Rate('flowforge_version_conflicts')

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Reads should stay responsive for browsing users.
    'http_req_duration{kind:read}': ['p(95)<300'],
    // Writes are version-checked; measure them separately.
    'http_req_duration{kind:write}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

export function setup() {
  const login = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${login.body}`)
  }
  const token = login.json('accessToken')

  const headers = { Authorization: `Bearer ${token}` }
  const workspaces = http.get(`${API}/workspaces`, { headers }).json('data')
  const workspace = workspaces[0]
  const projects = http.get(`${API}/workspaces/${workspace.id}/projects`, { headers }).json('data')
  const project = projects[0]
  const tasks = http
    .get(`${API}/projects/${project.id}/tasks?sort=position`, { headers })
    .json('data')

  return { token, workspaceId: workspace.id, projectId: project.id, taskId: tasks[0].id }
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` }

  group('workspace reads', () => {
    const dashboard = http.get(`${API}/workspaces/${data.workspaceId}/analytics/dashboard`, {
      headers,
      tags: { kind: 'read' },
    })
    check(dashboard, { 'dashboard 200': (r) => r.status === 200 })

    const analytics = http.get(`${API}/workspaces/${data.workspaceId}/analytics?range=30`, {
      headers,
      tags: { kind: 'read' },
    })
    check(analytics, { 'analytics 200': (r) => r.status === 200 })

    const activity = http.get(`${API}/workspaces/${data.workspaceId}/activity?limit=25`, {
      headers,
      tags: { kind: 'read' },
    })
    check(activity, { 'activity 200': (r) => r.status === 200 })
  })

  group('board reads', () => {
    const board = http.get(`${API}/projects/${data.projectId}/tasks?sort=position`, {
      headers,
      tags: { kind: 'read' },
    })
    check(board, { 'board 200': (r) => r.status === 200 })

    const detail = http.get(`${API}/tasks/${data.taskId}`, {
      headers,
      tags: { kind: 'read' },
    })
    check(detail, { 'task detail 200': (r) => r.status === 200 })
  })

  group('write path (optimistic concurrency)', () => {
    const detail = http.get(`${API}/tasks/${data.taskId}`, { headers }).json('task')
    const response = http.patch(
      `${API}/tasks/${data.taskId}`,
      JSON.stringify({ description: `load test ${Date.now()}`, version: detail.version }),
      { headers: { ...headers, 'Content-Type': 'application/json' }, tags: { kind: 'write' } },
    )
    const conflicted = response.status === 409
    conflictRate.add(conflicted)
    check(response, { 'write accepted or version-checked': (r) => r.status === 200 || r.status === 409 })
  })

  sleep(1)
}
