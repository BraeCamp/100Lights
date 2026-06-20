'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLogin() {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef              = useRef<HTMLInputElement>(null)
  const router                = useRouter()

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ code: code.trim() }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setError('Incorrect code. Try again.')
        setCode('')
        inputRef.current?.focus()
      }
    } catch {
      setError('Connection error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        width: 340, padding: '40px 36px', borderRadius: 16,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Lock icon */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, margin: '0 auto 14px',
            background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>
            🔐
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Admin Access
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Enter your admin code to continue
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            placeholder="Admin code"
            value={code}
            onChange={e => { setCode(e.target.value); setError('') }}
            disabled={loading}
            style={{
              padding: '11px 14px', borderRadius: 8, fontSize: 16, letterSpacing: '0.15em',
              border: `1.5px solid ${error ? '#ef4444' : 'var(--border)'}`,
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              outline: 'none', width: '100%', boxSizing: 'border-box',
              textAlign: 'center',
            }}
          />

          {error && (
            <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            style={{
              padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
              background: code.trim() ? 'var(--accent)' : 'var(--border)',
              color: code.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none', cursor: code.trim() ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
