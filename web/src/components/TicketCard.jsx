import { useState } from 'react'
import { AlertTriangle, Check, Copy, GitBranch, GitPullRequest, CircleDot } from 'lucide-react'
import { baseName, copyText, firstLine, timeAgo } from '@/util'
import { statusDot } from '@/lib/statuses'
import { cn } from '@/lib/utils'

const agentHue = {
  claude: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 ring-orange-500/30',
  codex: 'bg-teal-500/15 text-teal-600 dark:text-teal-300 ring-teal-500/30',
}

export default function TicketCard({ ticket, isDragging, onOpen, onCopy, onDragStart, onDragEnd }) {
  const [copied, setCopied] = useState(false)

  async function copySession(e) {
    e.stopPropagation()
    if (!ticket.sessionCode) return
    try {
      await copyText(ticket.sessionCode)
      setCopied(true)
      onCopy?.()
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked
    }
  }

  const title = ticket.tldr || firstLine(ticket.content) || `Ticket #${ticket.id}`
  const agent = ticket.agent || 'unknown'
  const pending = ticket.decisionsPending?.length ?? 0

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'group relative cursor-grab rounded-md glass p-3 transition-all',
        'hover:border-foreground/20 active:cursor-grabbing',
        isDragging && 'rotate-1 opacity-50',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded text-[11px] font-bold uppercase ring-1 ring-inset',
            agentHue[agent] ?? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-sky-500/30',
          )}
          title={agent}
        >
          {agent[0]}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">#{ticket.id}</span>
        {ticket.status === 'started' && (
          <span className="relative flex size-2">
            <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', statusDot.started)} />
            <span className={cn('relative inline-flex size-2 rounded-full', statusDot.started)} />
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground" title={`Updated ${ticket.updatedAt}`}>
          {timeAgo(ticket.updatedAt)}
        </span>
      </div>

      <h3 className="mt-2 line-clamp-3 text-[13.5px] leading-snug font-medium text-card-foreground">{title}</h3>

      {(ticket.issueNumber || ticket.prNumber || ticket.worktree) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {ticket.issueNumber ? (
            <span className="inline-flex items-center gap-1 rounded bg-foreground/5 px-1.5 py-0.5 text-muted-foreground">
              <CircleDot className="size-3" />#{ticket.issueNumber}
            </span>
          ) : null}
          {ticket.prNumber ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-status-finished/10 px-1.5 py-0.5 text-status-finished">
              <GitPullRequest className="size-3" />#{ticket.prNumber}
            </span>
          ) : null}
          {ticket.worktree ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-muted-foreground"
              title={ticket.worktree}
            >
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{baseName(ticket.worktree)}</span>
            </span>
          ) : null}
        </div>
      )}

      {(pending > 0 || ticket.sessionCode) && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-foreground/10 pt-2">
          {pending > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-attention/12 px-1.5 py-0.5 text-[11px] font-medium text-attention">
              <AlertTriangle className="size-3" />
              {pending} decision{pending > 1 ? 's' : ''}
            </span>
          )}
          {ticket.sessionCode ? (
            <button
              type="button"
              onClick={copySession}
              title={`Copy session code — claude --resume ${ticket.sessionCode}`}
              className={cn(
                'ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-70 transition hover:bg-muted hover:opacity-100',
                copied && 'text-status-completed opacity-100',
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'copied' : 'resume'}
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}
