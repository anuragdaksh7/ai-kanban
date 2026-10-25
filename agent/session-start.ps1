# Claude Code SessionStart hook: registers this session on the AI Kanban
# board (pick-or-create) and injects a context message telling the agent
# which ticket to use. Also captures the session id so the user can
# `claude --resume <sessionCode>` later from the card's copy button.
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
$data = $null
try { $data = $raw | ConvertFrom-Json -AsHashtable } catch { }

$session = $null
if ($data) { $session = $data['session_id'] }
if (-not $session) { $session = $env:CLAUDE_SESSION_ID }
if (-not $session) { $session = "claude-" + [guid]::NewGuid().ToString("N").Substring(0, 8) }

$cwd = $null
if ($data) { $cwd = $data['cwd'] }
if (-not $cwd) { $cwd = $env:CLAUDE_PROJECT_DIR }
if (-not $cwd) { $cwd = (Get-Location).Path }
$worktree = ($cwd -replace '\\', '/')

$body = @{
    agent       = 'claude'
    worktree    = $worktree
    sessionCode = $session
} | ConvertTo-Json -Compress

try {
    $t = Invoke-RestMethod -Method Post -Uri 'http://localhost:8787/api/v1/tickets/ensure' `
        -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 5
    Write-Output (
        '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":' +
        '["You are tracked on the AI Kanban board as ticket ' + $t.id +
        ' (status ' + $t.status + '). API base: http://localhost:8787/api/v1.' +
        ' Follow AGENTS.md: PATCH /api/v1/tickets/' + $t.id + ' to keep status/tldr/content/' +
        'decisionsPending/metadata current; never set status finished.' +
        ' When you transition the ticket to completed, the response will carry a requestFeedback hint - ' +
        'then POST /api/v1/feedback describing anything that could improve this platform."]}}'
    )
} catch {
    # Board down - silently do nothing, never block the session.
}
