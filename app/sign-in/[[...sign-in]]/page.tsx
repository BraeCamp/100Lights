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
            colorBackground: '#181828',
            colorInputBackground: '#0f0f1a',
            colorText: '#f0effe',
            colorTextSecondary: '#c4c3d8',
            colorInputText: '#f0effe',
          },
        }}
      />
    </div>
  )
}
