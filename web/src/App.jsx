import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import TicketCard from '@/components/TicketCard'
import TicketModal from '@/components/TicketModal'
import FeedbackView from '@/components/FeedbackView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { COLUMNS, statusBadge, statusDot } from '@/lib/statuses'
import { cn } from '@/lib/utils'

export default function App() {
  const [view, setView] = useState('board') // 'board' | 'feedback'
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | ticket object
  const [dragID, setDragID] = useState(null)
  const [overCol, setOverCol] = useState(null)

  const load = useCallback(async () => {
    try {
      setTickets(await api.listTickets())
    } catch (err) {
      toast.error('Failed to load tickets', { description: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Agents update tickets independently of this UI; poll so the board
    // stays live, and refresh when the tab regains focus.
    const timer = window.setInterval(load, 15000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  async function moveTicket(ticket, status) {
    if (ticket.status === status) return
    try {
      const updated =
        status === 'finished'
          ? await api.finishTicket(ticket.id)
          : await api.updateTicket(ticket.id, { status })
      setTickets((all) => all.map((t) => (t.id === updated.id ? updated : t)))
    } catch (err) {
      toast.error('Failed to move ticket', { description: err.message })
    }
  }

  async function handleSaved() {
    setEditing(null)
    await load()
  }

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!q) return tickets
    return tickets.filter((t) =>
      [
        t.tldr,
        t.content,
        t.agent,
        t.worktree,
        t.sessionCode,
        t.issueNumber ? `#${t.issueNumber}` : '',
        t.prNumber ? `pr ${t.prNumber}` : '',
        JSON.stringify(t.metadata ?? {}),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [tickets, q])

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.status, []]))
    for (const t of visible) (map[t.status] ?? map.unstarted).push(t)
    return map
  }, [visible])

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex shrink-0 items-center gap-2.5">
        <h1 className="mr-1 text-[15px] font-semibold tracking-wide">AI Kanban</h1>
        <Button variant="ghost" size="sm" onClick={() => setView('board')} className={cn('rounded-md', view === 'board' && 'bg-secondary text-secondary-foreground')}>
          Board
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setView('feedback')} className={cn('rounded-md', view === 'feedback' && 'bg-secondary text-secondary-foreground')}>
          Feedback
        </Button>
        {view === 'board' && (
          <>
            <Input
              type="search"
              placeholder="Search tickets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-64"
            />
            <Button variant="outline" size="sm" onClick={load} title="Refresh now (auto every 15s)">
              <RefreshCw />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus />
              New ticket
            </Button>
          </>
        )}
      </div>

      {view === 'feedback' ? (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <FeedbackView tickets={tickets} />
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading board…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <section
              key={col.status}
              className={cn(
                'flex min-w-60 flex-1 flex-col rounded-xl border bg-card/30 max-w-80',
                overCol === col.status && dragID !== null && 'border-ring/60 bg-accent/40 outline-dashed outline-ring/40 -outline-offset-2',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setOverCol(col.status)
              }}
              onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setOverCol(null)
                const ticket = tickets.find((t) => t.id === dragID)
                if (ticket) moveTicket(ticket, col.status).finally(() => setDragID(null))
              }}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2.5">
                <span className={cn('size-2 shrink-0 rounded-full', statusDot[col.status])} />
                <h2 className="flex-1 text-[11.5px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {col.label}
                </h2>
                <Badge variant="secondary" className="text-[10.5px] font-medium">
                  {byStatus[col.status].length}
                </Badge>
              </header>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-2.5">
                  {byStatus[col.status].map((t) => (
                    <TicketCard
                      key={t.id}
                      ticket={t}
                      onOpen={() => setEditing(t)}
                      onCopy={() =>
                        toast.success('Session code copied', {
                          description: `claude --resume ${t.sessionCode}`,
                        })
                      }
                      onDragStart={() => setDragID(t.id)}
                      onDragEnd={() => setDragID(null)}
                    />
                  ))}
                  {byStatus[col.status].length === 0 && (
                    <div className="py-3 text-center text-xs text-muted-foreground">No tickets</div>
                  )}
                </div>
              </ScrollArea>
            </section>
          ))}
        </div>
      )}

      <footer className="shrink-0 pt-1.5 text-[11.5px] text-muted-foreground">
        {view === 'feedback'
          ? 'Agents submit feedback via POST /api/v1/feedback — usually right after they create a ticket or complete their work.'
          : 'Drag cards between columns · finished is user-only (agents update via API)'}
      </footer>

      {editing && (
        <TicketModal
          isNew={editing === 'new'}
          ticket={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
