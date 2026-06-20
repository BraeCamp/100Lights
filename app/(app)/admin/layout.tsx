import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import AdminLogin from './AdminLogin'

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar     = await cookies()
  const token   = jar.get('admin_auth')?.value
  const isAdmin = !!token && token === process.env.ADMIN_CODE

  if (!isAdmin) return <AdminLogin />
  return <>{children}</>
}
