// Tiny markdown renderer for the Learn section — a deliberate subset
// (headings, lists, quotes, code, links, bold/italic, images) rendered to
// React elements, so there is no dangerouslySetInnerHTML anywhere. Also
// understands `@video` slots: a line like
//   @video A 30-second clip of building the drum loop
// renders a labeled placeholder card, and
//   @video(https://...mp4) Same clip, now recorded
// renders the actual player once a URL is added.

import React from 'react'

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // tokens: `code`, **bold**, *italic*, [text](url), ![alt](src)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) out.push(<code key={key} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('![')) {
      const alt = tok.slice(2, tok.indexOf(']'))
      const src = tok.slice(tok.indexOf('(') + 1, -1)
      // eslint-disable-next-line @next/next/no-img-element
      out.push(<img key={key} src={src} alt={alt} loading="lazy" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />)
    } else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    else {
      const label = tok.slice(1, tok.indexOf(']'))
      const href = tok.slice(tok.indexOf('(') + 1, -1)
      const external = /^https?:\/\//.test(href) && !href.startsWith('https://100lights.com')
      out.push(<a key={key} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>{label}</a>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function VideoSlot({ url, caption }: { url: string | null; caption: string }) {
  if (url) {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
    return (
      <figure style={{ margin: '28px 0' }}>
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt[1]}`}
            title={caption || 'Video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', aspectRatio: '16 / 9', border: '1px solid var(--border)', borderRadius: 12, display: 'block' }}
          />
        ) : (
          <video src={url} controls playsInline preload="metadata" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)', display: 'block' }} />
        )}
        {caption && <figcaption style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{caption}</figcaption>}
      </figure>
    )
  }
  return (
    <div aria-hidden="true" style={{
      margin: '28px 0', padding: '26px 20px', borderRadius: 12, textAlign: 'center',
      border: '1px dashed var(--border)', background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>🎬</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>Video coming soon{caption ? ` — ${caption}` : ''}</div>
    </div>
  )
}

export function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.split(/\n\s*\n/)
  const out: React.ReactNode[] = []
  blocks.forEach((block, bi) => {
    const b = block.trim()
    if (!b) return
    const key = `b${bi}`
    if (b.startsWith('```')) {
      const code = b.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      out.push(<pre key={key} style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', overflowX: 'auto', fontSize: 13, lineHeight: 1.55 }}><code>{code}</code></pre>)
      return
    }
    if (b.startsWith('@video')) {
      const m = b.match(/^@video(?:\(([^)]+)\))?\s*([\s\S]*)$/)
      out.push(<VideoSlot key={key} url={m?.[1] ?? null} caption={m?.[2]?.trim() ?? ''} />)
      return
    }
    if (/^#{1,3}\s/.test(b)) {
      const level = b.match(/^#+/)![0].length
      const text = b.replace(/^#+\s*/, '')
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
      const style = { color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.3, marginTop: level === 1 ? 0 : 36, marginBottom: 12 }
      if (level === 1) out.push(<h1 key={key} id={id} style={{ ...style, fontSize: 32, fontWeight: 800 }}>{inline(text, key)}</h1>)
      else if (level === 2) out.push(<h2 key={key} id={id} style={{ ...style, fontSize: 23, fontWeight: 750 }}>{inline(text, key)}</h2>)
      else out.push(<h3 key={key} id={id} style={{ ...style, fontSize: 17, fontWeight: 700 }}>{inline(text, key)}</h3>)
      return
    }
    if (/^>\s/.test(b)) {
      out.push(<blockquote key={key} style={{ borderLeft: '3px solid #a78bfa', margin: '20px 0', padding: '4px 0 4px 16px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{inline(b.replace(/^>\s?/gm, ''), key)}</blockquote>)
      return
    }
    if (/^(-|\d+\.)\s/.test(b)) {
      const ordered = /^\d+\./.test(b)
      const items = b.split('\n').map(l => l.replace(/^(-|\d+\.)\s*/, ''))
      const li = items.map((it, i) => <li key={`${key}-${i}`} style={{ margin: '6px 0', lineHeight: 1.65 }}>{inline(it, `${key}-${i}`)}</li>)
      out.push(ordered
        ? <ol key={key} style={{ paddingLeft: 24, color: 'var(--text-secondary)', fontSize: 15 }}>{li}</ol>
        : <ul key={key} style={{ paddingLeft: 24, color: 'var(--text-secondary)', fontSize: 15, listStyle: 'disc' }}>{li}</ul>)
      return
    }
    out.push(<p key={key} style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.75, margin: '14px 0' }}>{inline(b, key)}</p>)
  })
  return <>{out}</>
}
