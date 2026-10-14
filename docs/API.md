# FlowForge API Reference (v1)

Base URL: `http://localhost:4000/api/v1` (or `/api/v1` through the web proxy).
All requests are JSON unless noted. Authenticated requests send `Authorization: Bearer <accessToken>`.
The refresh token lives in the `ff_rt` httpOnly cookie (path-scoped to `/api/v1/auth`).

**Error envelope**

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "This task was changed by someone else …",
             "details": { "latestVersion": 5 }, "requestId": "…" } }
```

Common codes: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `REFRESH_REUSE_DETECTED`,
`INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `VALIDATION_FAILED`, `NOT_FOUND`, `WORKSPACE_NOT_FOUND`,
`FORBIDDEN`, `DUPLICATE`, `VERSION_CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`,
`UNSUPPORTED_FILE_TYPE`, `INVALID_CURSOR`, `LAST_OWNER`, `ALREADY_MEMBER`, `INVITATION_INVALID`,
`EMAIL_MISMATCH`, `INTERNAL_ERROR`.

**Permission legend**: `viewer` read · `member` write · `admin` manage · `owner` full.
Non-members always receive `404` for workspace-owned resources (existence is not leaked).

---

## Health & metrics

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | – | `{ status, uptimeSeconds, db, cache, queues, version }`; 503 when DB is down |
| GET | `/metrics` (root) | – | Prometheus exposition |

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | – | `{ name, email, password }` → 201 `{ user, accessToken }` + refresh cookie |
| POST | `/auth/login` | – | `{ email, password }` → `{ user, accessToken }` + cookie |
| POST | `/auth/refresh` | cookie/body | Rotates the refresh token; reuse outside a 15 s grace window revokes the session family |
| POST | `/auth/logout` | bearer | Revokes the current session, clears the cookie |
| POST | `/auth/logout-all` | bearer | Revokes every session |
| GET | `/auth/sessions` | bearer | Active sessions with `current` flag |
| DELETE | `/auth/sessions/:sessionId` | bearer | Revoke one session |
| DELETE | `/auth/sessions` | bearer | Revoke all *other* sessions |

## Users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users/me` | Current profile (preferences included) |
| PATCH | `/users/me` | `{ name?, avatarUrl? }` |
| PATCH | `/users/me/preferences` | `{ theme?, emailNotifications?, inAppNotifications? }` |

## Workspaces, members, invitations

| Method | Path | Min role | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces` | – | Workspaces the caller belongs to (with `role`, counts) |
| POST | `/workspaces` | – | `{ name, slug? }` → creator becomes owner |
| GET | `/workspaces/:workspaceId` | viewer | `:workspaceId` accepts **id or slug** |
| PATCH | `/workspaces/:workspaceId` | admin | `{ name?, slug?, settings.allowMemberInvites? }` |
| DELETE | `/workspaces/:workspaceId` | owner | Cascades everything incl. stored files |
| POST | `/workspaces/:workspaceId/leave` | member+ | Owner must transfer first (`LAST_OWNER`) |
| GET | `/workspaces/:workspaceId/members` | viewer | Owner first, then by role/name |
| PATCH | `/workspaces/:workspaceId/members/:userId` | admin | `{ role }`; `owner` = transfer (owner only) |
| DELETE | `/workspaces/:workspaceId/members/:userId` | admin | Unassigns the member from all tasks |
| GET | `/workspaces/:workspaceId/invitations` | admin | Pending invitations |
| POST | `/workspaces/:workspaceId/invitations` | member* | `{ email, role }`; *non-admins need `allowMemberInvites` and may only invite `member` |
| DELETE | `/workspaces/:workspaceId/invitations/:invitationId` | admin | Revoke |
| GET | `/invitations/:token` | – | Public preview `{ workspaceName, role, email, … }` |
| POST | `/invitations/:token/accept` | bearer | Email must match the invitation (`EMAIL_MISMATCH` otherwise) |

## Projects

| Method | Path | Min role | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces/:workspaceId/projects` | viewer | `?includeArchived=true`; includes per-status task counts |
| POST | `/workspaces/:workspaceId/projects` | member | `{ name, key, description? }` — key unique per workspace |
| GET | `/projects/:projectId` | viewer | |
| PATCH | `/projects/:projectId` | member | `status` changes require admin |
| DELETE | `/projects/:projectId` | admin | Cascades tasks/comments/attachments/files |

## Tasks

| Method | Path | Min role | Notes |
| --- | --- | --- | --- |
| GET | `/tasks` | member of scope | Cross-project list; requires `workspaceId` or `projectId` |
| GET | `/projects/:projectId/tasks` | viewer | Board read: `?sort=position` (bounded) |
| POST | `/projects/:projectId/tasks` | member | `{ title, description?, status?, priority?, assigneeIds?, labels?, dueDate?, parentTaskId? }` |
| GET | `/tasks/:taskId` | viewer | Includes counts (`subtaskCount`, `commentCount`, `attachmentCount`) |
| GET | `/tasks/:taskId/subtasks` | viewer | |
| PATCH | `/tasks/:taskId` | member | **Requires `version`**; stale writes → `409 VERSION_CONFLICT` with `details.latest` |
| DELETE | `/tasks/:taskId` | reporter/admin | Cascades subtasks, comments, attachments |

**List query parameters** (cursor pagination): `limit` (≤100), `cursor`, `status` (csv), `priority` (csv),
`assigneeId`, `parentTaskId`, `projectId`, `q` (full-text), `dueBefore`, `sort`
(`createdAt` default · `updatedAt` · `dueDate` · `position`). Responses: `{ data, nextCursor, hasMore }`.

Notes: assignees must be workspace members; subtasks are one level deep; `position` is fractional so a
drag sends a single `{ status, position, version }` patch.

## Comments

| Method | Path | Min role | Notes |
| --- | --- | --- | --- |
| GET | `/tasks/:taskId/comments` | viewer | Cursor-paginated |
| POST | `/tasks/:taskId/comments` | member | `{ content }` |
| PATCH | `/comments/:commentId` | author | Author-only (even admins cannot edit others' words) |
| DELETE | `/comments/:commentId` | author/admin | Moderation path |

## Attachments

| Method | Path | Min role | Notes |
| --- | --- | --- | --- |
| GET | `/tasks/:taskId/attachments` | viewer | |
| POST | `/tasks/:taskId/attachments` | member | `multipart/form-data`, field `file`; ≤10 MB; MIME allow-list |
| GET | `/attachments/:attachmentId/download` | member of its workspace | Streams bytes with `Content-Disposition` + `nosniff` |
| DELETE | `/attachments/:attachmentId` | uploader/admin | Removes the stored object and the document |

## Activity, notifications, analytics

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:workspaceId/activity` | Cursor feed; filters `taskId`, `projectId`, `actorId` |
| GET | `/notifications` | Cursor feed; `?unreadOnly=true&workspaceId=` |
| GET | `/notifications/unread-count` | `{ count }` |
| POST | `/notifications/:notificationId/read` | |
| POST | `/notifications/read-all` | `?workspaceId=` optional |
| GET | `/workspaces/:workspaceId/analytics` | `?range=7..90` (default 30) → overview, trend, workload, status mix, projects |
| GET | `/workspaces/:workspaceId/analytics/dashboard` | Personalised snapshot (assigned tasks, deadlines, activity, workload) |

## Realtime (Socket.IO, path `/socket.io`)

Handshake: `{ auth: { token: <accessToken> } }` — invalid tokens are rejected with `TOKEN_INVALID`.

**Client → server**: `workspace:join { workspaceId }`, `project:join { projectId }` (both verified
against membership; ack `{ ok: true }` or `{ ok: false, error }`).

**Server → client**:

| Event | Payload |
| --- | --- |
| `task:created` / `task:updated` | `{ task }` (full DTO) |
| `task:deleted` | `{ taskId, projectId, parentTaskId }` |
| `comment:created` / `comment:updated` / `comment:deleted` | `{ comment, taskId }` / `{ commentId, taskId }` |
| `attachment:created` / `attachment:deleted` | `{ attachment, taskId }` / `{ attachmentId, taskId }` |
| `notification:created` | `{ …NotificationDTO }` (user room) |
| `presence:update` | `{ workspaceId, online }` |
| `presence:project` | `{ projectId, viewers: userId[] }` |
| `activity:created` | `{ action, entityId }` (UI invalidates the feed) |

Events are emitted only after the corresponding database write succeeds.
