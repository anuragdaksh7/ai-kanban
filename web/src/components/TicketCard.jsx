import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { api } from '@/api'
import { baseName, copyText, firstLine } from '@/util'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export default function TicketCard({ ticket, onOpen, onCopy, onDragStart, onDragEnd }) {
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

  return (
    <Card
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="cursor-grab gap-0 rounded-lg px-3 py-3 shadow-none transition-colors hover:border-ring/50 hover:bg-accent/30 active:cursor-grabbing"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-sky-400">{ticket.agent || 'unknown'}</span>
        {ticket.issueNumber ? (
          <Badge variant="outline" className="px-1.5 text-[11px]">
            issue #{ticket.issueNumber}
          </Badge>
        ) : null}
        {ticket.prNumber ? (
          <Badge variant="outline" className="border-purple-400/40 px-1.5 text-[11px] text-purple-400">
            PR #{ticket.prNumber}
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-2 mb-2.5 line-clamp-3 text-[13px] leading-snug font-semibold">{title}</h3>

      <div className="flex items-center gap-1.5">
        {ticket.worktree ? (
          <Badge
            variant="secondary"
            className="min-w-0 max-w-full font-mono text-[11px] font-normal"
            title={ticket.worktree}
          >
            <span className="truncate">{baseName(ticket.worktree)}</span>
          </Badge>
        ) : null}
        {ticket.sessionCode ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={copySession}
            title={`Copy session code — claude --resume ${ticket.sessionCode}`}
            className={cn('text-muted-foreground font-mono text-[11px]', copied && 'text-green-400')}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'copied' : 'session'}
          </Button>
        ) : null}
      </div>

      {ticket.decisionsPending?.length > 0 && (
        <div className="mt-2 text-[11px] text-yellow-400">
          ⚠ {ticket.decisionsPending.length} decision
          {ticket.decisionsPending.length > 1 ? 's' : ''} pending
        </div>
      )}
    </Card>
  )
}
