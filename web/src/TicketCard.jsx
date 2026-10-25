import { useState } from 'react'
import { baseName, copyText, firstLine } from './util.js'

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
    <article
      className="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="row">
        <span className="agent">{ticket.agent || 'unknown'}</span>
        {ticket.issueNumber ? <span className="chip">issue #{ticket.issueNumber}</span> : null}
        {ticket.prNumber ? <span className="chip chip-pr">PR #{ticket.prNumber}</span> : null}
      </div>
      <h3>{title}</h3>
      <div className="row">
        {ticket.worktree ? (
          <span className="chip mono" title={ticket.worktree}>
            {baseName(ticket.worktree)}
          </span>
        ) : null}
        {ticket.sessionCode ? (
          <button
            type="button"
            className={'icon-btn' + (copied ? ' copied' : '')}
            title={`Copy session code — claude --resume ${ticket.sessionCode}`}
            onClick={copySession}
          >
            {copied ? 'copied ✓' : '⧉ session'}
          </button>
        ) : null}
      </div>
      {ticket.decisionsPending?.length > 0 && (
        <div className="decisions">
          ⚠ {ticket.decisionsPending.length} decision{ticket.decisionsPending.length > 1 ? 's' : ''} pending
        </div>
      )}
    </article>
  )
}
