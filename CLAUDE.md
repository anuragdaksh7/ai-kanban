@AGENTS.md

# Kanban app (this repo)

- The board is auto-served at http://localhost:8787 (Go server; API base http://localhost:8787/api/v1).
- A SessionStart hook (see .claude/settings.json → agent/session-start.ps1) registers this
  session on the board and injects your ticket number as additional context. If you don't see
  that message (e.g. the hook isn't installed or the server is down), follow the
  find-or-create flow in AGENTS.md yourself using POST /api/v1/tickets/ensure.
