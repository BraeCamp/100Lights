import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { isAdminEmail } from '@/lib/admin-auth'
import AdminLogin from './AdminLogin'

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const emailOk = await isAdminEmail()
  if (!emailOk) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)',
      }}>
        <div style={{
          width: 340, padding: '40px 36px', borderRadius: 16, textAlign: 'center',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🚫</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            Not authorized
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            This area is restricted to the account owner.
          </p>
        </div>
      </div>
    )
  }

  const jar   = await cookies()
  const token = jar.get('admin_auth')?.value
  const isAdmin = !!token && token === process.env.ADMIN_CODE

  if (!isAdmin) return <AdminLogin />
  return <>{children}</>
}
