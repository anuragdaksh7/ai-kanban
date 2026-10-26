import { Fragment } from 'react'
import { cn } from '@/lib/utils'

// Renderer for agent-written report text, following the formats seen in real
// tickets: markdown headings (## / ###), markdown bold, inline `code`,
// bullet lists (- * •), numbered lists (1.), and bare URLs (auto-linkified,
// github ones shown as org/repo/...). All text stays plain React nodes —
// no HTML injection.

const URL_RE = /https?:\/\/[^\s`]+/g

function trimUrlPunct(url) {
  let trail = ''
  while (url.length > 0 && /[.,;:!?)\]}]+$/.test(url)) {
    trail = url.slice(-1) + trail
    url = url.slice(0, -1)
  }
  return [url, trail]
}

function Linkify({ text }) {
  if (!text.includes('http')) return <Fragment>{text}</Fragment>
  const matches = [...text.matchAll(URL_RE)]
  if (matches.length === 0) return <Fragment>{text}</Fragment>
  const out = []
  let last = 0
  matches.forEach((m, i) => {
    const idx = m.index
    if (idx > last) out.push(<Fragment key={`t${i}`}>{text.slice(last, idx)}</Fragment>)
    const [url, trail] = trimUrlPunct(m[0])
    const display = url.replace(/^https?:\/\/github\.com\//, '')
    out.push(
      <a
        key={`l${i}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className="break-all text-sky-400 underline-offset-2 hover:underline"
      >
        {display}
      </a>,
    )
    if (trail) out.push(<Fragment key={`x${i}`}>{trail}</Fragment>)
    last = idx + m[0].length
  })
  if (last < text.length) out.push(<Fragment key="end">{text.slice(last)}</Fragment>)
  return <>{out}</>
}

function Inline({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} className="mx-0.5 rounded px-1 py-0.5 font-mono text-[0.86em] bg-muted">
              {p.slice(1, -1)}
            </code>
          )
        }
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold">
              <Linkify text={p.slice(2, -2)} />
            </strong>
          )
        }
        return (
          <Fragment key={i}>
            <Linkify text={p} />
          </Fragment>
        )
      })}
    </>
  )
}

const headingSize = { 1: 'text-[15px]', 2: 'text-[14px]', 3: 'text-[13px]' }

export default function Content({ text, className }) {
  const lines = (text ?? '').split(/\r?\n/)
  const blocks = []
  let para = []
  let bullets = []
  let numbers = []

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join(' ') })
      para = []
    }
  }
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ type: 'ul', items: [...bullets] })
      bullets = []
    }
  }
  const flushNumbers = () => {
    if (numbers.length) {
      blocks.push({ type: 'ol', items: [...numbers] })
      numbers = []
    }
  }
  const flushAll = () => {
    flushPara()
    flushBullets()
    flushNumbers()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*$/.test(line)) {
      flushAll()
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushAll()
      blocks.push({ type: 'h', level: h[1].length, text: h[2].replace(/#+\s*$/, '') })
      continue
    }
    const b = line.match(/^\s*[-*•]\s+(.*)$/)
    if (b) {
      flushPara()
      flushNumbers()
      bullets.push(b[1])
      continue
    }
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (n) {
      flushPara()
      flushBullets()
      numbers.push(n[1])
      continue
    }
    flushBullets()
    flushNumbers()
    para.push(line.trim())
  }
  flushAll()

  return (
    <div className={cn('space-y-1.5 text-[13px] leading-relaxed text-foreground/90', className)}>
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          return (
            <div
              key={i}
              className={cn(
                'pt-1 font-semibold text-foreground',
                headingSize[b.level] ?? 'text-[12.5px]',
              )}
            >
              <Inline text={b.text} />
            </div>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        )
      })}
    </div>
  )
}