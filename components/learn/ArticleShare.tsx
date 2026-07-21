'use client'

// Share row: copy the link, or hand it off to X / Reddit (big music communities).
// External links, so they open in a new tab; copy uses the clipboard API.

import { useState } from 'react'

export default function ArticleShare({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`
  const reddit = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
    padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'none',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Share</span>
      <button onClick={copy} style={btn}>{copied ? '✓ Copied' : 'Copy link'}</button>
      <a href={x} target="_blank" rel="noreferrer" style={btn}>X</a>
      <a href={reddit} target="_blank" rel="noreferrer" style={btn}>Reddit</a>
    </div>
  )
}
