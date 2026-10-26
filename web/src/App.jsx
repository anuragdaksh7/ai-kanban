import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, MessageSquare, Moon, Plus, RefreshCw, Search, Sparkles, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import TicketCard from '@/components/TicketCard'
import TicketDrawer from '@/components/TicketDrawer'
import TicketModal from '@/components/TicketModal'
import FeedbackView from '@/components/FeedbackView'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { COLUMNS, statusDot, statusPill } from '@/lib/statuses'
import { cn } from '@/lib/utils'

export default function App() {
  const [view, setView] = useState('board') // 'board' | 'feedback'
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [isNewOpen, setIsNewOpen] = useState(false) // create-ticket dialog
  const [detailID, setDetailID] = useState(null) // ticket detail drawer
  const [dragID, setDragID] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')

  useEffect(() => {
    document.body.classList.toggle('dark', dark)
  }, [dark])

  function toggleTheme() {
    setDark((d) => {
      localStorage.setItem('theme', d ? 'light' : 'dark')
      return !d
    })
  }

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

  async function handleNewSaved() {
    setIsNewOpen(false)
    await load()
  }

  async function handleDrawerSaved() {
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

  const detailTicket = useMemo(
    () => (detailID == null ? null : tickets.find((t) => t.id === detailID) ?? null),
    [tickets, detailID],
  )

  const activeCount = tickets.filter((t) => t.status === 'started').length
  const pendingCount = tickets.filter((t) => t.status !== 'finished' && t.decisionsPending?.length).length

  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="hidden w-60 shrink-0 flex-col rounded-lg glass px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">AI Kanban</div>
            <div className="text-[11px] text-muted-foreground">Agent sessions</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          <NavItem icon={LayoutGrid} active={view === 'board'} onClick={() => setView('board')} count={tickets.length}>
            Board
          </NavItem>
          <NavItem icon={MessageSquare} active={view === 'feedback'} onClick={() => setView('feedback')}>
            Feedback
          </NavItem>
        </nav>

        <div className="mt-6 px-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Overview</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Active" value={activeCount} dot={statusDot.started} />
          <Stat label="Needs you" value={pendingCount} dot="bg-attention" />
        </div>

        <div className="mt-auto space-y-2">
          <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
            {view === 'feedback'
              ? 'Agents submit feedback via POST /api/v1/feedback after creating or completing a ticket.'
              : 'Drag cards between lanes · click for details · finishing is user-only.'}
          </p>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex shrink-0 items-center gap-3 rounded-lg glass px-4 py-2.5">
          <h1 className="text-lg font-semibold tracking-tight">{view === 'board' ? 'Board' : 'Feedback'}</h1>
          <div className="ml-auto flex gap-1 md:hidden">
            <Button variant={view === 'board' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('board')}>
              Board
            </Button>
            <Button variant={view === 'feedback' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('feedback')}>
              Feedback
            </Button>
          </div>
          {view === 'board' && (
            <>
              <div className="relative md:ml-auto">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search tickets, agents, worktrees…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 w-72 rounded-md bg-background/40 pl-8"
                />
              </div>
              <Button variant="ghost" size="icon" onClick={load} title="Refresh now (auto every 15s)">
                <RefreshCw />
              </Button>
              <Button size="sm" onClick={() => setIsNewOpen(true)} className="rounded-md">
                <Plus />
                New ticket
              </Button>
            </>
          )}
        </header>

        {view === 'feedback' ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg glass-thin px-6 py-4">
            <FeedbackView tickets={tickets} />
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 size-4 animate-spin" />
            Loading board…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto pb-1">
            {COLUMNS.map((col) => (
              <section
                key={col.status}
                className={cn(
                  'flex w-72 min-w-72 flex-col overflow-hidden rounded-lg glass-thin transition',
                  overCol === col.status && dragID !== null && 'ring-1 ring-primary/50 bg-primary/5',
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
                                <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
                  <span className={cn('size-2 shrink-0 rounded-full', statusDot[col.status])} />
                  <h2 className="flex-1 text-[13px] font-semibold">{col.label}</h2>
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums', statusPill[col.status])}>
                    {byStatus[col.status].length}
                  </span>
                </header>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-2 px-2.5 pb-3">
                    {byStatus[col.status].map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={t}
                        isDragging={dragID === t.id}
                        onOpen={() => setDetailID(t.id)}
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
                      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-foreground/15 text-xs text-muted-foreground">
                        {q ? 'No matches' : 'Drop tickets here'}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </section>
            ))}
          </div>
        )}
      </main>

      {isNewOpen && (
        <TicketModal
          isNew
          ticket={null}
          onClose={() => setIsNewOpen(false)}
          onSaved={handleNewSaved}
        />
      )}

      {detailID != null && detailTicket && (
        <TicketDrawer
          ticket={detailTicket}
          onClose={() => setDetailID(null)}
          onSaved={handleDrawerSaved}
          onMove={moveTicket}
        />
      )}
    </div>
  )
}

function NavItem({ icon: Icon, active, onClick, count, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition',
        active ? 'bg-white/40 dark:bg-white/10 font-medium shadow-sm text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1 text-left">{children}</span>
      {count != null && <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>}
    </button>
  )
}

function Stat({ label, value, dot }) {
  return (
    <div className="rounded-md glass-thin px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn('size-1.5 rounded-full', dot)} />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
