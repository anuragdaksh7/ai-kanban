import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Star } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export default function FeedbackView({ tickets }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    try {
      setEntries(await api.listFeedback())
    } catch (err) {
      toast.error('Failed to load feedback', { description: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 20000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const ticketLookup = new Map(tickets.map((t) => [t.id, t]))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-xs text-muted-foreground">
          Feedback from agent sessions — what could make this platform better.
          Agents are nudged to submit it when they create a ticket or complete their work.
        </span>
        <Button variant="outline" size="sm" onClick={load} title="Refresh now (auto every 20s)">
          <RefreshCw />
          Refresh
        </Button>
        <Button size="sm" onClick={() => setComposing(true)}>
          <Plus />
          Submit feedback
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading feedback…</div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No feedback yet. Agents will be asked for it when their sessions start or complete —
          or submit some yourself.
        </div>
      ) : (
        entries.map((f) => (
          <Card key={f.id} className="gap-0 px-4 py-3.5 shadow-none">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-sky-400">{f.agent || 'unknown'}</span>
              {f.rating ? <RatingStars rating={f.rating} /> : null}
              {f.ticketId ? (
                <Badge variant="outline" className="px-1.5 font-normal text-[11px]">
                  Ticket #{f.ticketId}
                  {ticketLookup.has(f.ticketId) && ticketLookup.get(f.ticketId).tldr
                    ? ` — ${ticketLookup.get(f.ticketId).tldr}`
                    : ''}
                </Badge>
              ) : null}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {new Date(f.createdAt).toLocaleString()}
              </span>
            </div>
            {f.summary && <h3 className="mt-2 text-[13.5px] font-semibold">{f.summary}</h3>}
            <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {f.content}
            </p>
          </Card>
        ))
      )}

      {composing && (
        <FeedbackComposer
          onClose={() => setComposing(false)}
          onSaved={() => {
            setComposing(false)
            load()
          }}
        />
      )}
    </div>
  )
}

export function RatingStars({ rating }) {
  return (
    <span className="flex items-center gap-0.5 text-[11px] text-yellow-400" title={`Rated ${rating}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('size-3.5', n <= rating ? 'fill-yellow-400' : 'text-muted-foreground/40')}
        />
      ))}
    </span>
  )
}

function FeedbackComposer({ onClose, onSaved }) {
  const [form, setForm] = useState({ agent: '', summary: '', content: '', rating: '', ticketId: '' })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setFormError('')
    try {
      const body = {
        agent: form.agent,
        summary: form.summary,
        content: form.content,
      }
      if (form.rating !== '') {
        body.rating = Number(form.rating)
        if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
          throw new Error('rating must be an integer between 1 and 5')
        }
      }
      if (form.ticketId !== '') {
        body.ticketId = Number(form.ticketId)
        if (!Number.isInteger(body.ticketId) || body.ticketId <= 0) {
          throw new Error('ticket id must be a positive integer')
        }
      }
      await api.createFeedback(body)
      toast.success('Feedback submitted — thank you')
      onSaved()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit feedback</DialogTitle>
          <DialogDescription>Feedback about this platform, from the user or an agent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fb-agent">Agent</Label>
              <Input id="fb-agent" value={form.agent} onChange={(e) => set('agent', e.target.value)} placeholder="opencode / claude / you" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fb-ticket">Ticket # (optional)</Label>
              <Input id="fb-ticket" type="number" min={1} value={form.ticketId} onChange={(e) => set('ticketId', e.target.value)} placeholder="—" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-summary">Summary</Label>
            <Input id="fb-summary" value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="What would make it better" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-content">Details</Label>
            <Textarea id="fb-content" rows={4} value={form.content} onChange={(e) => set('content', e.target.value)} placeholder="Concrete suggestions, missing fields, workflow friction…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-rating">Rating (1–5, optional)</Label>
            <Input id="fb-rating" type="number" min={1} max={5} value={form.rating} onChange={(e) => set('rating', e.target.value)} placeholder="—" className="w-32" />
          </div>
          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
