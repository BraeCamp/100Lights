'use client'

import { useState } from 'react'
import { useOthers } from '@/lib/liveblocks.config'

export function CollabInvite({ projectId }: { projectId: string }) {
  const [copied, setCopied] = useState(false)
  const others = useOthers()

  async function copyLink() {
    const url = `${window.location.origin}/projects/${projectId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const count = others.length

  return (
    <button
      onClick={copyLink}
      title="Copy invite link"
      data-help-id="invite"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 10, height: 24, padding: '0 8px', borderRadius: 5,
        border: `1px solid ${copied ? '#22c55e' : '#2e2e2e'}`,
        background: copied ? 'rgba(34,197,94,0.12)' : 'rgba(61,143,239,0.08)',
        color: copied ? '#22c55e' : '#7ab4f5',
        cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
        transition: 'all 0.15s',
      }}
    >
      {copied ? '✓ Copied' : (
        <>
          <span style={{ fontSize: 11 }}>⊕</span>
          Invite
          {count > 0 && (
            <span style={{
              marginLeft: 2, background: '#3d8fef', color: '#fff',
              borderRadius: 8, padding: '0 5px', fontSize: 9, fontWeight: 700,
            }}>
              {count}
            </span>
          )}
        </>
      )}
    </button>
  )
}
