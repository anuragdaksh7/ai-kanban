# Agent session protocol

Every agent session interacting with this repo/board MUST follow this protocol.

1. **Pick your ticket** at session start with find-or-create — never create
   duplicates for the same issue/worktree that is already open:

   ```
   POST /api/v1/tickets/ensure
   {"agent": "claude", "worktree": "<abs path>", "issueNumber": 42, "sessionCode": "<your session id>"}
   ```
   - 200 → existing ticket returned; use its `id`.
   - 201 → newly created; use the `id` in the response.

2. **Keep your ticket honest.** Update it whenever something meaningful
   changes:

   ```
   PATCH /api/v1/tickets/{id}
   ```
   - `"status": "started"` when you begin real work, `"stopped"` when you are
     paused/waiting, `"completed"` when your work needs only user review.
   - `"tldr"` — one line, keep it current.
   - `"content"` — your module report at the end of the session.
   - `"decisionsPending"` — replace with the current list of open questions
     for the user.
   - `"metadata"` — shallow-merged (delete a key by sending `{"key": null}`).
     Use the blessed vocabulary below and put identifiers/links in metadata,
     keeping your report body as prose — the board UI turns these into
     structured detail rows (branch chips, commit hashes, PR/issue links,
     review verdicts):

     | key           | type             | meaning |
     |---------------|------------------|---------|
     | `branch`      | string           | branch name this session works on |
     | `commits`     | array of strings | commit hashes, ONE PER STRING (do not send a count) |
     | `pr`          | string (URL)     | the PR opened for this work |
     | `githubIssue` | string (URL)     | the issue driving this work |
     | `relatedPr`   | number           | another PR relevant to it (dependency, fix) |
     | `reviewedBy`  | string           | review verdict, e.g. `review-code 0d4cbb70c round=2 verdict=PASS` |
     | `followups`   | array of strings | issue/PR references left for later, e.g. `#2438` |

     Extra keys beyond the table are fine (free-form); string values that look like URLs render as links everywhere.
   - `"sessionCode"` — always set to YOUR current session id so the user can
     `claude --resume <sessionCode>`.

3. **Submit platform feedback.** The server tells you when it is a natural
   feedback moment: the response to `POST /api/v1/tickets` (fresh ticket) and
   to a `PATCH` that transitions your ticket to `completed` carries a
   `requestFeedback` hint. When you see it, submit:

   ```
   POST /api/v1/feedback
   {"ticketId": 12, "agent": "claude", "audience": "agent", "rating": 4,
    "summary": "API ergonomics", "content": "What could be improved and why —
   missing fields that would have helped, UI or workflow friction."}
   ```
   - `audience` is **required** and states who the feedback tries to help:
     - `"agent"` — ergonomics for agent sessions: missing API fields,
       confusing validation, ensure/resume behavior, hint wording.
     - `"user"` — the human side: UI layout, readability, board workflow.
       Pick this only when a person's experience is the actual subject.
   - Optional fields: `rating` (1–5), `ticketId` (link to your ticket).
   - The user reads feedback on the board's **Feedback** page, filterable by
     audience.

4. **Never move a ticket to `finished`.** The server rejects
   `status: "finished"` on updates; finishing is a user-only action
   (`POST /api/v1/tickets/{id}/finish`, called from the board UI).

Only statuses you may set: `unstarted`, `started`, `stopped`, `completed`.
