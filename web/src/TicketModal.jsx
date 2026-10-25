import { useEffect, useState } from 'react'
import { api } from './api.js'
import { copyText } from './util.js'

const STATUSES = ['unstarted', 'started', 'stopped', 'completed', 'finished']

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
    metadataText: ticket?.metadata && Object.keys(ticket.metadata).length
      ? JSON.stringify(ticket.metadata, null, 2)
      : '',
    status: ticket?.status ?? 'unstarted',
  }
}

export default function TicketModal({ isNew, ticket, onClose, onSaved, onNotify }) {
  const [form, setForm] = useState(() => formFrom(ticket))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function copySession() {
    if (!form.sessionCode) return
    try {
      await copyText(form.sessionCode)
      setCopied(true)
      onNotify?.('Session code copied — run: claude --resume ' + form.sessionCode)
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
      onSaved()
      onNotify?.('Ticket moved to finished')
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
        onNotify?.('Ticket created')
      } else {
        // The API rejects status=finished on updates; going through the
        // finish endpoint instead. All other statuses ride along in the PATCH.
        if (form.status === 'finished') {
          await api.updateTicket(ticket.id, { ...body, status: undefined })
          await api.finishTicket(ticket.id)
          onNotify?.('Ticket moved to finished')
        } else {
          await api.updateTicket(ticket.id, { ...body, status: form.status })
          onNotify?.('Ticket saved')
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{isNew ? 'New ticket' : `Ticket #${ticket.id}`}</h2>
          <div className="row">
            {!isNew && <span className={`status-pill status-${form.status}`}>{form.status}</span>}
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>

        <form onSubmit={save}>
          <div className="field">
            <label>TLDR</label>
            <input
              value={form.tldr}
              onChange={(e) => set('tldr', e.target.value)}
              placeholder="One-line summary shown on the card"
            />
          </div>

          <div className="field">
            <label>Content (agent report)</label>
            <textarea
              rows={5}
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              placeholder="What this session is / was about, any report the agent leaves"
            />
          </div>

          <div className="row">
            <div className="field">
              <label>Agent</label>
              <input
                value={form.agent}
                onChange={(e) => set('agent', e.target.value)}
                placeholder="claude"
              />
            </div>
            <div className="field">
              <label>Worktree</label>
              <input
                className="mono"
                value={form.worktree}
                onChange={(e) => set('worktree', e.target.value)}
                placeholder="X:/code/project/wt-42"
              />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Issue number</label>
              <input
                type="number"
                min={1}
                value={form.issueNumber}
                onChange={(e) => set('issueNumber', e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="field">
              <label>PR number</label>
              <input
                type="number"
                min={1}
                value={form.prNumber}
                onChange={(e) => set('prNumber', e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div className="field">
            <label>Session code</label>
            <div className="session-row">
              <input
                className="mono"
                value={form.sessionCode}
                onChange={(e) => set('sessionCode', e.target.value)}
                placeholder="claude session id for --resume"
              />
              <button
                type="button"
                className={'icon-btn' + (copied ? ' copied' : '')}
                onClick={copySession}
                disabled={!form.sessionCode}
                title={
                  form.sessionCode ? `claude --resume ${form.sessionCode}` : 'No session code yet'
                }
              >
                {copied ? 'copied ✓' : '⧉ copy'}
              </button>
            </div>
            {form.sessionCode && (
              <div className="hint mono">
                claude --resume {form.sessionCode}
              </div>
            )}
          </div>

          <div className="field">
            <label>Decisions pending (one per line)</label>
            <textarea
              rows={3}
              value={form.decisionsText}
              onChange={(e) => set('decisionsText', e.target.value)}
              placeholder="Questions awaiting the user's call"
            />
          </div>

          <div className="field">
            <label>Metadata (JSON object)</label>
            <textarea
              className="mono"
              rows={3}
              value={form.metadataText}
              onChange={(e) => set('metadataText', e.target.value)}
              placeholder='{"branch": "fix/login"}'
            />
          </div>

          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.filter((s) => (isNew ? s !== 'finished' : true)).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="hint">
              Finished is user-only — pick it here (uses the finish endpoint) or drag the card.
            </div>
          </div>

          {formError && <div className="form-error">{formError}</div>}

          <div className="modal-actions">
            {ticket && ticket.status !== 'finished' && (
              <button
                type="button"
                className="btn finish-btn"
                onClick={finish}
                disabled={busy}
                title="User-only action: move this ticket to finished"
              >
                ✓ Move to Finished
              </button>
            )}
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
