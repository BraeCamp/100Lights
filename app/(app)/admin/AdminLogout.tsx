'use client'
import { useRouter } from 'next/navigation'

export default function AdminLogout() {
  const router = useRouter()
  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE' })
    router.refresh()
  }
  return (
    <button
      onClick={logout}
      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 8 }}
    >
      Sign out
    </button>
  )
}
