# AI Kanban

A small, self-hosted Kanban board for tracking **AI agent sessions**. Agents
create/pick up tickets, leave their reports, pending decisions and statuses on
them, and every ticket carries the agent's session code so you can resume it:

```
claude --resume <sessionCode>
```

- **Backend:** Go + SQLite (pure-Go driver, no CGO needed), std `net/http` only.
- **Frontend:** Vite + React with **shadcn/ui** primitives (Tailwind CSS v4,
  Radix, lucide icons, sonner toasts), pinned to a dark theme.
- No authentication (local tool). All data lives in `data/kanban.db`.

## Quick start

```pwsh
# backend
go run .                    # or: go build -o bin/aikanban.exe .
                            # serves http://localhost:8787

# frontend (dev, hot reload)
cd web && npm install && npm run dev     # http://localhost:5173, proxies /api to :8787

# frontend (production — served by the Go server at /)
cd web && npm run build && go run .
```

Flags: `--port` (8787), `--host` (127.0.0.1), `--db` (`data/kanban.db`),
`--web` (`web/dist`, `""` disables static serving).

## Ticket fields

| Field | Type | Notes |
|---|---|---|
| `id` | int | assigned by server |
| `content` | string | the agent's report / notes for the session |
| `agent` | string | e.g. `claude`, `codex`, `goose` |
| `worktree` | string | path of the worktree the agent worked in |
| `issueNumber` | int, nullable | GitHub/git issue, if any |
| `prNumber` | int, nullable | PR, if any |
| `status` | enum | `unstarted`, `started`, `stopped`, `completed`, `finished` |
| `decisionsPending` | string[] | decisions awaiting the user |
| `tldr` | string | one-liner shown as the card title |
| `metadata` | JSON object | arbitrary, agent-dictated (branch, commits, …) |
| `sessionCode` | string | the agent session id — copy button resumes it |
| `createdAt` / `updatedAt` | string | RFC3339 |

### Status rules

- Agents may set any status via updates. `finished` is **user-only**: the API
  rejects `status: "finished"` on updates; it is set exclusively through
  `POST /api/v1/tickets/{id}/finish` (the board's drag-to-Finished and the
  "Move to Finished" button both call it).

### Update semantics (`PATCH`)

- Absent fields stay unchanged; fields present in the body are replaced.
- An explicit `null` clears a field (`issueNumber: null` → NULL,
  `metadata: null` → `{}`, `decisionsPending: null` → `[]`).
- `metadata` is **shallow-merged**: keys you send override existing ones, a
  `null` value inside metadata deletes that key. Handy for agents who only
  want to add `{"pr": 900}` without knowing existing keys.
- Unknown top-level fields are rejected with a list of valid fields (typo,
  snake_case, etc. get a clear error).

## API

Base: `http://localhost:8787/api/v1`. All bodies are JSON.

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness + DB check |
| `GET /tickets` | list (`?status=a,b&agent=&worktree=&issue=&pr=&session=&q=`) |
| `POST /tickets` | create a ticket (201) |
| `POST /tickets/ensure` | **pick-or-create**: find an open (not finished) ticket by issue, else by worktree; create if none. 200 = found, 201 = created |
| `GET /tickets/{id}` | fetch one (404 if unknown) |
| `PATCH /tickets/{id}` | partial update (also accepted as `PUT`) |
| `POST /tickets/{id}/finish` | user-only: move to `finished` (idempotent) |
| `POST /feedback` | agent feedback about the platform (`agent, summary, content, rating 1-5, ticketId`) |
| `GET /feedback` | list feedback (`?agent=&ticket=&limit=`) |

**Agent feedback nudges**: the response to ticket creation and to a
transition into `completed` carries a `requestFeedback` string — agents are
expected to `POST /feedback` in response. Humans read it on the **Feedback**
page of the UI (and can submit there too).

### Agent workflow (put this in your agent harness)

Every session, at start:

```sh
# pick up my ticket or create it — one call, no guessing IDs
curl -s -X POST http://localhost:8787/api/v1/tickets/ensure \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "worktree": "X:/code/projexts/myproject/wt-42",
    "issueNumber": 42,
    "sessionCode": "a1f0c9d2-1f7a-4a01-b421-0e2b8a90cd29",
    "content": "Working on the OAuth redirect bug"
  }'
```

While working / when reporting:

```sh
curl -s -X PATCH http://localhost:8787/api/v1/tickets/1 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "tldr": "OAuth redirect fixed, needs user review",
    "content": "State was signed with the stale secret after key rotation. Fixed with grace window.",
    "decisionsPending": ["Keep the 10-min grace window hardcoded?"],
    "metadata": {"commits": 3, "branch": "fix/login-42"}
  }'
```

Never: `POST /api/v1/tickets/{id}/finish` (that is the user's job).

### UI

- **Board** and **Feedback** pages (switch via the toolbar buttons).
- Drag cards between columns (dragging to Finished calls the finish endpoint).
- Click a card to open it and edit every field, including metadata JSON.
- `⧉ session` copies the session code so you can run `claude --resume <code>`.
- The Feedback page lists agent feedback (auto-refreshes) and has a
  "Submit feedback" form for anything you want to note yourself.
- The board polls every 15 s (and on focus) so agent changes show up live.

## Hooking up Claude Code

**Everywhere (on-demand)** — installed globally, so this works in ANY repo/worktree:

- `~/.claude/commands/kanban.md` adds a `/kanban` slash command (it carries the
  same protocol as `AGENTS.md`). Typing **"log this session to my kanban board"** in any
  session triggers it too (via the `~/.claude/CLAUDE.md` note): the agent checks
  the board, registers/finds this worktree's ticket, keeps it updated, and
  submits feedback.
- `~/.claude/hooks/kanban-session-id.ps1` is wired via `~/.claude/settings.json`
  as a silent `SessionStart` hook that stashes the session **id** per directory,
  so the `/kanban` flow can set `sessionCode` even mid-session — that is what
  makes `claude --resume <id>` (copied from the card) work everywhere.
- The board server must be running (`go run .` in this repo or `bin\aikanban.exe`);
  the hook/script fail silently otherwise and never block the session.

**This repo only (automatic)** — `.claude/settings.json` runs the ensure-hook at
session start, so a session opened in the ai-kanban repo is registered on the
board the moment it starts, with its real session id, no commands needed.

Result: in the ai-kanban repo you just run `claude` — no prompt needed; the
agent registers itself, updates statuses as it works, posts its report +
pending decisions, and submits feedback when it completes. In any other
worktree, just type "log this session to my kanban board" (or `/kanban`).
Watch it all on the board and resume any session with

```
claude --resume <sessionCode>
```

(copied from the card's ⧉ session button).

For other agents (Codex, goose, …): they read `AGENTS.md` natively — or paste
the protocol block from `AGENTS.md` into their system prompt / runbook.

## Layout

```
main.go          entrypoint, flags, graceful shutdown
handlers.go      HTTP API
ticket.go        model, status constants, PATCH validation/merge rules
store.go         SQLite queries
db.go            open + migrations
middleware.go    CORS, request logging
web.go           serves web/dist with SPA fallback
web/             Vite React frontend (shadcn/ui components in web/src/components/ui)
data/            SQLite database (created at runtime)
```

### Re-adding shadcn components

Components were pulled with `npx shadcn@latest add <name>` (config in
`web/components.json`, theme in `web/src/index.css`, `@` alias in
`web/vite.config.js` + `web/jsconfig.json`). Note: the CLI generated
`from "cn"` imports in the ui components; they were fixed to
`@/lib/utils` (where the `cn` helper lives) — re-run that fix if you add more.
