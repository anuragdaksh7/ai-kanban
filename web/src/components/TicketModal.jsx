import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import { STATUSES } from '@/lib/statuses'
import { copyText } from '@/util'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { statusBadge } from '@/lib/statuses'
import { cn } from '@/lib/utils'

function formFrom(ticket) {
  return {
    content: ticket?.content ?? '',
    agent: ticket?.agent ?? '',
    worktree: ticket?.worktree ?? '',
    issueNumber: ticket?.issueNumber ?? '',
    prNumber: ticket?.prNumber ?? '',
    tldr: ticket?.tldr ?? '',
    sessionCode: ticket?.sessionCode ?? '',
    decisionsText: (ticket?.decisionsPending ?? []).join('\n'),
    metadataText:
      ticket?.metadata && Object.keys(ticket.metadata).length
        ? JSON.stringify(ticket.metadata, null, 2)
        : '',
    status: ticket?.status ?? 'unstarted',
  }
}

export default function TicketModal({ isNew, ticket, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFrom(ticket))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  async function copySession() {
    if (!form.sessionCode) return
    try {
      await copyText(form.sessionCode)
      setCopied(true)
      toast.success('Session code copied', {
        description: `claude --resume ${form.sessionCode}`,
      })
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked
    }
  }

  async function finish() {
    setBusy(true)
    setFormError('')
    try {
      await api.finishTicket(ticket.id)
      toast.success('Ticket moved to finished')
      onSaved()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setFormError('')
    try {
      const body = {
        content: form.content,
        agent: form.agent,
        worktree: form.worktree,
        tldr: form.tldr,
        sessionCode: form.sessionCode,
        decisionsPending: form.decisionsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        metadata: form.metadataText.trim() ? JSON.parse(form.metadataText) : {},
      }
      if (form.issueNumber !== '') {
        body.issueNumber = Number(form.issueNumber)
        if (!Number.isInteger(body.issueNumber) || body.issueNumber <= 0) {
          throw new Error('issue number must be a positive integer')
        }
      }
      if (form.prNumber !== '') {
        body.prNumber = Number(form.prNumber)
        if (!Number.isInteger(body.prNumber) || body.prNumber <= 0) {
          throw new Error('PR number must be a positive integer')
        }
      }
      if (body.metadata && (typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
        throw new Error('metadata must be a JSON object')
      }

      if (isNew) {
        await api.createTicket({ ...body, status: form.status })
        toast.success('Ticket created')
      } else {
        // The API rejects status=finished on updates; go through the finish
        // endpoint instead. All other statuses ride along in the PATCH.
        if (form.status === 'finished') {
          await api.updateTicket(ticket.id, { ...body, status: undefined })
          await api.finishTicket(ticket.id)
          toast.success('Ticket moved to finished')
        } else {
          await api.updateTicket(ticket.id, { ...body, status: form.status })
          toast.success('Ticket saved')
        }
      }
      onSaved()
    } catch (err) {
      setFormError(
        err instanceof SyntaxError
          ? 'Metadata is not valid JSON: ' + err.message
          : err.message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {isNew ? 'New ticket' : `Ticket #${ticket.id}`}
            {!isNew && (
              <Badge variant="outline" className={cn('text-[11px]', statusBadge[form.status])}>
                {form.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isNew ? 'Create a kanban ticket' : 'Edit this kanban ticket'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tldr">TLDR</Label>
            <Input
              id="tldr"
              value={form.tldr}
              onChange={(e) => set('tldr', e.target.value)}
              placeholder="One-line summary shown on the card"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="content">Content (agent report)</Label>
            <Textarea
              id="content"
              rows={5}
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              placeholder="What this session is / was about, any report the agent leaves"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="agent">Agent</Label>
              <Input
                id="agent"
                value={form.agent}
                onChange={(e) => set('agent', e.target.value)}
                placeholder="claude"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="worktree">Worktree</Label>
              <Input
                id="worktree"
                className="font-mono text-xs"
                value={form.worktree}
                onChange={(e) => set('worktree', e.target.value)}
                placeholder="X:/code/project/wt-42"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="issueNumber">Issue number</Label>
              <Input
                id="issueNumber"
                type="number"
                min={1}
                value={form.issueNumber}
                onChange={(e) => set('issueNumber', e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prNumber">PR number</Label>
              <Input
                id="prNumber"
                type="number"
                min={1}
                value={form.prNumber}
                onChange={(e) => set('prNumber', e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sessionCode">Session code</Label>
            <div className="flex gap-2">
              <Input
                id="sessionCode"
                className="font-mono text-xs"
                value={form.sessionCode}
                onChange={(e) => set('sessionCode', e.target.value)}
                placeholder="claude session id for --resume"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copySession}
                disabled={!form.sessionCode}
                title={form.sessionCode ? `claude --resume ${form.sessionCode}` : 'No session code yet'}
              >
                {copied ? <Check className="text-green-400" /> : <Copy />}
                copy
              </Button>
            </div>
            {form.sessionCode && (
              <span className="font-mono text-[11px] break-all text-muted-foreground">
                claude --resume {form.sessionCode}
              </span>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="decisions">Decisions pending (one per line)</Label>
            <Textarea
              id="decisions"
              rows={3}
              value={form.decisionsText}
              onChange={(e) => set('decisionsText', e.target.value)}
              placeholder="Questions awaiting the user's call"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="metadata">Metadata (JSON object)</Label>
            <Textarea
              id="metadata"
              rows={3}
              className="font-mono text-xs"
              value={form.metadataText}
              onChange={(e) => set('metadataText', e.target.value)}
              placeholder='{"branch": "fix/login"}'
            />
          </div>

          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.filter((s) => (isNew ? s !== 'finished' : true)).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              Finished is user-only — pick it here (uses the finish endpoint) or drag the card.
            </span>
          </div>

          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {formError}
            </div>
          )}

          <DialogFooter className="mt-1 gap-2">
            {ticket && ticket.status !== 'finished' && (
              <Button
                type="button"
                variant="outline"
                onClick={finish}
                disabled={busy}
                title="User-only action: move this ticket to finished"
                className="mr-auto text-purple-400"
              >
                Move to Finished
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
