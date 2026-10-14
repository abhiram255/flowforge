# FlowForge — 7-Scenario Demo Script (5–7 minutes)

Prerequisites: `npm run seed && npm run dev` (or `docker compose up --build`), two browser profiles
available (normal + private window) for the realtime scenes.

Demo credentials — password for everyone: `Password123!`

| Who | Email | Role |
| --- | --- | --- |
| Owner | `aarav.mehta@flowforge.dev` | Acme Corp owner |
| Admin | `priya.sharma@flowforge.dev` | Acme admin (also Nebula member) |
| Member | `rohan.gupta@flowforge.dev` | Acme member |
| Viewer | `arjun.rao@flowforge.dev` | Acme viewer (read-only) |
| Other tenant | `sara.khan@flowforge.dev` | Nebula Labs owner |

---

### 1. Create an account and a new workspace (~60 s)

1. Open `/register`, sign up with a fresh email → you land on **onboarding**.
2. Create a workspace named e.g. `Demo Studio` → you arrive at the dashboard as **owner**.
3. Point at the sidebar: your new workspace appears in the switcher next to the seeded ones
   (switch with the switcher — data never mixes: each workspace has its own projects, people, activity).

### 2. Invite a second user and assign a role (~60 s)

1. **Team → Invite member**: invite `rohan.gupta@flowforge.dev` as **member**.
2. No SMTP here, so FlowForge shows the **shareable invite link** (the API also logs the email).
3. Copy the link, open it in the private window, sign in as Rohan, **Accept invitation** — he joins.
4. Back in the Team tab: change Rohan's role with the dropdown (member → admin → member) and note
   that the last owner cannot leave, admins cannot touch the owner, and you cannot change your own role.

### 3. Create a project and populate its board (~90 s)

1. **Projects → New project**: name `Apollo Launch`, key `APL` → tasks will be numbered `APL-1`, `APL-2`…
2. Open the board: five columns. Create three tasks in different columns (title + priority + due date).
3. Add Rohan as an assignee on one, add labels, drag a card to reorder inside a column.
4. Switch to Rohan's window and show the **bell**: he received a "You were assigned APL-x"
   notification without any refresh.

### 4. Real-time across two windows (~60 s)

1. Keep the board open in both windows.
2. In window A drag a card from **Todo → In Progress**. Watch it move in window B instantly.
3. In B open the task and post a comment; A's comment thread updates live.
4. Note the header: presence chips show **who is viewing this board**, and the sidebar shows
   "N people online".

### 5. Attempt unauthorised access from another workspace (~60 s)

1. In window A sign in as `arjun.rao@flowforge.dev` (**viewer**): the New task button is gone — the UI
   mirrors the policy, but the policy is not the UI.
2. With the browser devtools console, replay a write as the viewer:

   ```js
   await fetch('/api/v1/projects/<APL project id>/tasks', {
     method: 'POST',
     headers: {
       'content-type': 'application/json',
       authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
     },
     body: JSON.stringify({ title: 'viewer write attempt' }),
   })
   ```

   → `403` from the server (use the *Network* tab to show the response body: `{"error":{"code":"FORBIDDEN"}}`).
3. Now cross tenants: as `sara.khan` (Nebula owner) request an Acme task id directly
   (`GET /api/v1/tasks/<acme task id>`) → **404, not 403**: the API never confirms that another
   tenant's resource exists.
4. Attachment check: `GET /api/v1/attachments/<acme attachment id>/download` as Sara → `404`.

### 6. Analytics and activity (~45 s)

1. **Analytics**: switch the range 7/30/90 days — completion trend, status mix, workload, cycle time.
2. Complete a task in another tab, refresh analytics: the numbers move (cache is invalidated by writes).
3. **Dashboard → Recent activity** shows the full audit trail of what you just did — including the
   invitation, the role change and the task moves.

### 7. Engineering evidence (~60 s)

1. `npm test` → **66 API integration tests + 16 web tests** green, including the cross-tenant attack
   suite and the OCC race ("exactly one winner of two same-version writes").
2. `npm run bench` → MongoDB explain artifact: unindexed full scan (20,000 docs examined, p95 17.6 ms)
   vs compound index (40 docs, p95 1.76 ms).
3. `docs/BENCHMARKS.md` → autocannon numbers with the honest saturation story; `docker compose config`
   + the GitHub Actions pipeline (verify → e2e → images) in `.github/workflows/`.

---

## Bonus lines if time allows

- **Version conflict**: open the same task in both windows, edit and save in A, then edit and save in
  B → B gets a clear "changed by someone else" 409 with the latest payload instead of silently
  overwriting A's work.
- **Session security**: Settings → Security shows both devices; revoke Rohan's session and show that
  his refresh immediately fails while the short-lived access token expires within 15 minutes.
- **Degradation**: stop Redis (if using compose) — the API keeps working: `/api/v1/health` reports
  `cache: memory, queues: inline`.
