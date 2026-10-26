import { Fragment, useEffect, useState } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api'
import Content from '@/lib/Content'
import { buildTicketBody } from '@/lib/ticket-body'
import { STATUSES, statusBadge, statusDot } from '@/lib/statuses'
import {
  copyText,
  displayUrl,
  firstLine,
  humanizeKey,
  isRedundantMetaKey,
  metaValue,
  repoBaseFromMetadata,
  timeAgo,
} from '@/util'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

function formFrom(t) {
  return {
    content: t?.content ?? '',
    agent: t?.agent ?? '',
    worktree: t?.worktree ?? '',
    issueNumber: t?.issueNumber ?? '',
    prNumber: t?.prNumber ?? '',
    tldr: t?.tldr ?? '',
    sessionCode: t?.sessionCode ?? '',
    decisionsText: (t?.decisionsPending ?? []).join('\n'),
    metadataText:
      t?.metadata && Object.keys(t.metadata).length
        ? JSON.stringify(t.metadata, null, 2)
        : '',
    status: t?.status ?? 'unstarted',
  }
}

function CopyBtn({ text, label, title, className }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={title ?? `Copy ${label ?? 'value'}`}
      className={cn('text-muted-foreground shrink-0', copied && 'text-green-400', className)}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await copyText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard blocked
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

function Section({ title, right, children }) {
  return (
    <section className="px-5 py-4 border-b">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[10.5px] font-semibold tracking-widest text-muted-foreground uppercase">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  )
}

const chipClass =
  'rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-foreground/90'

// Copyable mono chip for small identifiers (commit hashes, branch names).
function MonoCopy({ value, display, muted, title }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={title ?? value}
      onClick={async () => {
        try {
          await copyText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard blocked
        }
      }}
      className={cn(
        chipClass,
        'font-mono hover:border-ring/50',
        muted && 'text-muted-foreground',
        copied && 'border-green-400/60 text-green-400',
      )}
    >
      {display ?? value}
      {copied ? ' ✓' : ''}
    </button>
  )
}

function HashChip({ hash }) {
  return <MonoCopy value={hash} display={hash.slice(0, Math.min(9, hash.length))} title={hash} />
}

function FollowupChip({ value, repoBase }) {
  const num = value.replace(/^\D*(\d+)\D*$/, '$1')
  if (/^\d+$/.test(num) && repoBase) {
    return (
      <a
        href={`${repoBase}/issues/${num}`}
        target="_blank"
        rel="noreferrer"
        className={cn(chipClass, 'font-mono text-sky-400 hover:border-ring/50')}
        title={`Issue #${num}`}
      >
        #{num} ↗
      </a>
    )
  }
  return <span className={cn(chipClass, 'font-mono')}>{value}</span>
}

// Review verdict strings ("review-code 0d4cbb70c round=5 verdict=PASS") with
// PASS/FAIL tokens picked out in color.
function VerdictText({ text }) {
  const parts = String(text).split(/\b(PASS|FAIL)\b/g)
  return (
    <span className="break-all font-mono text-[11.5px] text-muted-foreground">
      {parts.map((p, i) =>
        p === 'PASS' ? (
          <span key={i} className="font-semibold text-green-400">
            {p}
          </span>
        ) : p === 'FAIL' ? (
          <span key={i} className="font-semibold text-red-400">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  )
}

export default function TicketDrawer({ ticket, onClose, onSaved, onMove, onNotify }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => formFrom(ticket))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (editing) {
      setForm(formFrom(ticket))
      setFormError('')
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const repoBase = repoBaseFromMetadata(ticket?.metadata)
  const issueLink = ticket?.issueNumber && repoBase ? `${repoBase}/issues/${ticket.issueNumber}` : null
  const prLink = ticket?.prNumber && repoBase ? `${repoBase}/pull/${ticket.prNumber}` : null
  const title =
    ticket?.tldr || firstLine(ticket?.content) || `Ticket #${ticket?.id}`

  // Curated "key details" built from the metadata vocabulary agents actually
  // use (branch, commits, pr/githubIssue URLs, relatedPr numbers, review
  // verdicts, followups). Rendered keys are hidden from the generic list.
  const md = ticket?.metadata ?? {}
  const facts = []
  const hiddenCurated = new Set()

  if (typeof md.branch === 'string' && md.branch) {
    facts.push({ label: 'Branch', node: <MonoCopy value={md.branch} muted title={md.branch} /> })
    hiddenCurated.add('branch')
  }

  if (Array.isArray(md.commits) ? md.commits.length > 0 : typeof md.commits === 'number') {
    if (Array.isArray(md.commits)) {
      facts.push({
        label: 'Commits',
        node: (
          <div className="flex flex-wrap gap-1">
            {md.commits.map((c) => (
              <HashChip key={c} hash={String(c)} />
            ))}
          </div>
        ),
      })
    } else {
      facts.push({ label: 'Commits', node: `${md.commits} commits` })
    }
    hiddenCurated.add('commits')
  }

  const reviewParts = Object.entries(md)
    .filter(([k, v]) => /^review/i.test(k) && typeof v === 'string' && v.trim())
    .map(([, v]) => v)
  if (reviewParts.length > 0) {
    facts.push({ label: 'Review', node: <VerdictText text={reviewParts.join(' · ')} /> })
    for (const k of Object.keys(md)) {
      if (/^review/i.test(k) && typeof md[k] === 'string' && md[k].trim()) hiddenCurated.add(k)
    }
  }

  const followups = Array.isArray(md.followups)
    ? md.followups
    : typeof md.followups === 'string'
      ? [md.followups]
      : []
  if (followups.length > 0) {
    facts.push({
      label: 'Follow-ups',
      node: (
        <div className="flex flex-wrap gap-1">
          {followups.map((f) => (
            <FollowupChip key={String(f)} value={String(f)} repoBase={repoBase} />
          ))}
        </div>
      ),
    })
    hiddenCurated.add('followups')
  }

  // Full issue/PR URLs that are not already linked by the header chips
  // (which need a numeric issueNumber/prNumber plus an inferred repo base).
  const headerCoversIssue = !!issueLink
  const headerCoversPr = !!prLink
  for (const [k, v] of Object.entries(md)) {
    if (typeof v !== 'string' || !/^https?:\/\//.test(v)) continue
    if (v.includes('/issues/') && !headerCoversIssue) {
      facts.push({
        label: 'Issue',
        node: (
          <a
            href={v}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sky-400 underline-offset-2 hover:underline"
          >
            {displayUrl(v)} ↗
          </a>
        ),
      })
      hiddenCurated.add(k)
    }
    if (/\/pull(\/|request)/.test(v) && !headerCoversPr) {
      facts.push({
        label: 'PR',
        node: (
          <a
            href={v}
            target="_blank"
            rel="noreferrer"
            className="break-all text-purple-400 underline-offset-2 hover:underline"
          >
            {displayUrl(v)} ↗
          </a>
        ),
      })
      hiddenCurated.add(k)
    }
  }
  // Numeric PR-ish references (relatedPr: 2423) become pull links when the
  // repo base is known — skipped only when they equal the header's own PR.
  for (const [k, v] of Object.entries(md)) {
    if (
      typeof v === 'number' &&
      /(pr$|^pr|pull)/i.test(k) &&
      repoBase &&
      String(v) !== String(ticket?.prNumber ?? '')
    ) {
      facts.push({
        label: humanizeKey(k).replace(/ Pr$/i, ' PR'),
        node: (
          <a
            href={`${repoBase}/pull/${v}`}
            target="_blank"
            rel="noreferrer"
            className="break-all text-purple-400 underline-offset-2 hover:underline"
          >
            PR #{v} ↗
          </a>
        ),
      })
      hiddenCurated.add(k)
    }
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setFormError('')
    try {
      const body = buildTicketBody(form)
      if (form.status === 'finished') {
        await api.updateTicket(ticket.id, { ...body, status: undefined })
        await api.finishTicket(ticket.id)
        toast.success('Ticket moved to finished')
      } else {
        await api.updateTicket(ticket.id, { ...body, status: form.status })
        toast.success('Ticket saved')
      }
      setEditing(false)
      onSaved?.()
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
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:w-[62vw] sm:min-w-[620px] sm:max-w-none">
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-1.5 pr-9">
            <Badge variant="outline" className={cn('text-[11px]', statusBadge[ticket.status])}>
              <span className={cn('size-1.5 rounded-full', statusDot[ticket.status])} />
              {ticket.status}
            </Badge>
            <span className="text-xs font-semibold text-sky-400">{ticket.agent || 'unknown'}</span>
            {issueLink ? (
              <a href={issueLink} target="_blank" rel="noreferrer">
                <Badge variant="outline" className="px-1.5 text-[11px] hover:bg-accent">
                  issue #{ticket.issueNumber} ↗
                </Badge>
              </a>
            ) : ticket.issueNumber ? (
              <Badge variant="outline" className="px-1.5 text-[11px]">issue #{ticket.issueNumber}</Badge>
            ) : null}
            {prLink ? (
              <a href={prLink} target="_blank" rel="noreferrer">
                <Badge variant="outline" className="border-purple-400/40 px-1.5 text-[11px] text-purple-400 hover:bg-accent">
                  PR #{ticket.prNumber} ↗
                </Badge>
              </a>
            ) : ticket.prNumber ? (
              <Badge variant="outline" className="border-purple-400/40 px-1.5 text-[11px] text-purple-400">
                PR #{ticket.prNumber}
              </Badge>
            ) : null}
            {ticket.sessionCode ? (
              <CopyBtn
                text={ticket.sessionCode}
                label="session code"
                title={`Copy session code — claude --resume ${ticket.sessionCode}`}
                className="ml-auto"
              />
            ) : null}
          </div>

          <SheetTitle className="mt-2 text-left text-[15px] leading-snug">
            {title}
          </SheetTitle>
          <SheetDescription className="text-[11px] text-muted-foreground">
            Ticket #{ticket.id} · updated {timeAgo(ticket.updatedAt)}
          </SheetDescription>
        </SheetHeader>

        {editing ? (
          <form onSubmit={save} className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-5">
            <div className="grid gap-1.5">
              <Label htmlFor="d-tldr">TLDR</Label>
              <Input id="d-tldr" value={form.tldr} onChange={(e) => setForm((f) => ({ ...f, tldr: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-content">Content (agent report)</Label>
              <Textarea id="d-content" rows={10} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="d-agent">Agent</Label>
                <Input id="d-agent" value={form.agent} onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-worktree">Worktree</Label>
                <Input id="d-worktree" className="font-mono text-xs" value={form.worktree} onChange={(e) => setForm((f) => ({ ...f, worktree: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="d-issue">Issue number</Label>
                <Input id="d-issue" type="number" min={1} value={form.issueNumber} onChange={(e) => setForm((f) => ({ ...f, issueNumber: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="d-pr">PR number</Label>
                <Input id="d-pr" type="number" min={1} value={form.prNumber} onChange={(e) => setForm((f) => ({ ...f, prNumber: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-session">Session code</Label>
              <Input id="d-session" className="font-mono text-xs" value={form.sessionCode} onChange={(e) => setForm((f) => ({ ...f, sessionCode: e.target.value }))} />
              {form.sessionCode && (
                <span className="font-mono text-[11px] break-all text-muted-foreground">
                  claude --resume {form.sessionCode}
                </span>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-decisions">Decisions pending (one per line)</Label>
              <Textarea id="d-decisions" rows={3} value={form.decisionsText} onChange={(e) => setForm((f) => ({ ...f, decisionsText: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-meta">Metadata (JSON object)</Label>
              <Textarea
                id="d-meta"
                rows={5}
                className="font-mono text-xs"
                value={form.metadataText}
                onChange={(e) => setForm((f) => ({ ...f, metadataText: e.target.value }))}
                placeholder={'{\n  "branch": "user/anurag/2434",\n  "commits": ["8a55cfaf1"],\n  "pr": "https://github.com/org/repo/pull/2440",\n  "relatedPr": 2423,\n  "reviewedBy": "review-code 8a55cfaf1 round=1 verdict=PASS",\n  "followups": ["#2438"]\n}'}
              />
              <span className="text-[11px] text-muted-foreground">
                Blessed keys (branch, commits, pr, githubIssue, relatedPr, reviewedBy, followups)
                render as structured rows — branch chips, hash chips, GitHub links, colored
                verdicts. URLs in any key become links.
              </span>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.filter((s) => s !== 'finished' || ticket.status === 'finished').map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
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
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {facts.length > 0 && (
              <Section title="Key details">
                <dl className="space-y-1.5">
                  {facts.map((f) => (
                    <div key={f.label} className="flex items-baseline gap-3 text-[12.5px]">
                      <dt className="w-28 shrink-0 text-right text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="min-w-0">{f.node}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {ticket.content ? (
              <Section
                title="Content (agent report)"
                right={
                  <CopyBtn text={ticket.content} label="report" className="ml-auto" />
                }
              >
                <Content text={ticket.content} />
              </Section>
            ) : null}

            {ticket.decisionsPending?.length > 0 && (
              <Section
                title={`Decisions pending (${ticket.decisionsPending.length})`}
                right={
                  <CopyBtn
                    text={ticket.decisionsPending.join('\n')}
                    label="decisions"
                    className="ml-auto"
                  />
                }
              >
                <ul className="space-y-1.5">
                  {ticket.decisionsPending.map((d, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-snug text-yellow-400">
                      <span className="shrink-0">?</span>
                      <span className="text-foreground/90">{d}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {ticket.metadata && Object.keys(ticket.metadata).some((k) => !isRedundantMetaKey(ticket, k, ticket.metadata[k]) && !hiddenCurated.has(k)) && (
              <Section title="Other metadata">
                <dl className="space-y-1.5">
                  {Object.entries(ticket.metadata).map(([k, v]) => {
                    if (isRedundantMetaKey(ticket, k, v) || hiddenCurated.has(k)) return null
                    const meta = metaValue(k, v, repoBase)
                    return (
                      <div key={k} className="flex items-baseline gap-3 text-[12.5px]">
                        <dt className="w-28 shrink-0 text-right text-muted-foreground">
                          {humanizeKey(k)}
                        </dt>
                        <dd className="min-w-0">
                          {meta.kind === 'link' ? (
                            <a
                              href={meta.url}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-sky-400 underline-offset-2 hover:underline"
                            >
                              {meta.text} ↗
                            </a>
                          ) : meta.kind === 'code' ? (
                            <pre className="overflow-x-auto rounded bg-muted/60 px-2 py-1 font-mono text-[11.5px] whitespace-pre">
                              {meta.text}
                            </pre>
                          ) : (
                            <span className={cn('break-all', meta.muted && 'text-muted-foreground')}>
                              {meta.text}
                            </span>
                          )}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </Section>
            )}

            <Section title="Session & worktree">
              <div className="space-y-2.5">
                {ticket.sessionCode ? (
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-28 shrink-0 text-right text-muted-foreground">Session</span>
                    <span className="min-w-0 truncate font-mono text-xs">{ticket.sessionCode}</span>
                    <span
                      className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground"
                      title="resume command"
                    >
                      claude --resume
                    </span>
                    <CopyBtn
                      text={`claude --resume ${ticket.sessionCode}`}
                      label="resume command"
                      title="Copy the full resume command"
                    />
                    <CopyBtn text={ticket.sessionCode} label="session code" title="Copy the raw session code" />
                  </div>
                ) : null}
                {ticket.worktree ? (
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-28 shrink-0 text-right text-muted-foreground">Worktree</span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={ticket.worktree}>
                      {ticket.worktree}
                    </span>
                    <CopyBtn text={ticket.worktree} label="worktree path" className="ml-auto" />
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-28 shrink-0 text-right text-muted-foreground">Created</span>
                  <span title={ticket.createdAt}>{timeAgo(ticket.createdAt)}</span>
                </div>
              </div>
            </Section>
          </div>
        )}

        {!editing && (
          <div className="flex items-center gap-2 border-t px-5 py-3.5">
            <Select
              value={ticket.status}
              onValueChange={(v) => ticket.status !== v && onMove(ticket, v)}
            >
              <SelectTrigger className="w-36" title="Quick status change">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.filter((s) => s !== 'finished' || ticket.status === 'finished').map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ticket.status !== 'finished' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await onMove(ticket, 'finished')
                }}
                title="User-only action: move this ticket to finished"
                className="text-purple-400"
              >
                Move to Finished
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setEditing(true)} className="ml-auto">
              <Pencil />
              Edit
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
