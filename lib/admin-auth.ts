import { currentUser } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { isAdminAddress } from '@/lib/admin-email'

const COOKIE = 'admin_auth'

export async function isAdminEmail(): Promise<boolean> {
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress
  return isAdminAddress(email)
}

export async function isAdmin(): Promise<boolean> {
  const [emailOk, jar] = await Promise.all([isAdminEmail(), cookies()])
  if (!emailOk) return false
  const token = jar.get(COOKIE)?.value
  return !!token && token === process.env.ADMIN_CODE
}
