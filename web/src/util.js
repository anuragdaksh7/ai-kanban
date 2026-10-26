// Pure helpers for presenting ticket data (units learned from real agent
// data: URLs and numbers inside metadata, empty arrays, duplicated keys,
// dense prose with bullets and inline code).

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s)) return ''
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function humanizeKey(key) {
  const s = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Infer a GitHub repo base (https://github.com/<org>/<repo>) from any URL in
// the metadata, so numeric issue/PR values can become real links.
export function repoBaseFromMetadata(metadata) {
  for (const v of Object.values(metadata ?? {})) {
    if (typeof v === 'string') {
      const m = v.match(/^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/)
      if (m) return m[0]
    }
  }
  return null
}

// Shorten URL display text: github URLs read as org/repo/issues/123.
export function displayUrl(u) {
  return u.replace(/^https?:\/\/github\.com\//, '')
}

// Render plan for one metadata value (all value shapes seen in the wild).
export function metaValue(key, v, repoBase) {
  if (v === null || v === undefined) {
    return { kind: 'text', text: '—', muted: true }
  }
  if (typeof v === 'boolean') {
    return { kind: 'text', text: String(v) }
  }
  if (typeof v === 'number' || typeof v === 'string') {
    const s = String(v)
    if (/^https?:\/\//.test(s)) {
      return { kind: 'link', url: s, text: displayUrl(s) }
    }
    if (repoBase && typeof v === 'number') {
      if (/pull|\bpr\b/i.test(key)) return { kind: 'link', url: `${repoBase}/pull/${s}`, text: `PR #${s}` }
      if (/issue/i.test(key)) return { kind: 'link', url: `${repoBase}/issues/${s}`, text: `#${s}` }
    }
    return { kind: 'text', text: s }
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      return { kind: 'text', text: '—', muted: true }
    }
    if (v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
      return { kind: 'text', text: v.map(String).join(', ') }
    }
    return { kind: 'code', text: JSON.stringify(v, null, 1) }
  }
  return { kind: 'code', text: JSON.stringify(v, null, 1) }
}

// Keys that duplicate the ticket's own fields.
export function isRedundantMetaKey(ticket, key, v) {
  if (key === 'worktree') return v === ticket.worktree
  if (key === 'sessionCode') return v === ticket.sessionCode
  return false
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  // Fallback for non-secure contexts
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function firstLine(text) {
  const line = (text ?? '').split('\n').find((l) => l.trim() !== '')
  return (line ?? '').trimStart().slice(0, 120)
}

export function baseName(path) {
  if (!path) return ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
