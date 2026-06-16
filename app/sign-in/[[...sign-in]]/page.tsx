import type { Metadata } from 'next'
import { SignIn } from '@clerk/nextjs'
import { Zap } from 'lucide-react'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="flex items-center gap-2.5 mb-10">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
        >
          <Zap size={16} color="#fff" fill="#fff" />
        </div>
        <span className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
          100Lights
        </span>
      </div>
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={{
          variables: {
            colorBackground: '#1e1e30',
            colorInputBackground: '#2a2a42',
            colorText: '#ffffff',
            colorTextSecondary: '#ffffff',
            colorInputText: '#f4f3ff',
            colorNeutral: '#9896b8',
            colorPrimary: '#8b5cf6',
          },
          elements: {
            headerTitle: { color: '#ffffff' },
            headerSubtitle: { color: '#ffffff' },
            formFieldLabel: { color: '#ffffff' },
          },
        }}
      />
    </div>
  )
}
