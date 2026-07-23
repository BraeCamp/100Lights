'use client'

import { useState } from 'react'

export default function CopyPreviewLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
      }}
      title="Copy a shareable link that lets anyone preview this draft — no admin login needed"
      style={{
        alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
        cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-base)',
        color: copied ? '#34d399' : 'var(--text-muted)',
      }}
    >{copied ? 'Copied ✓' : '🔗 Copy shareable preview link'}</button>
  )
}
