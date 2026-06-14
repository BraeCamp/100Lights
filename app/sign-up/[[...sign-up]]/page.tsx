import type { Metadata } from 'next'
import { SignUp } from '@clerk/nextjs'
import { Zap } from 'lucide-react'

export const metadata: Metadata = { title: 'Sign up' }

export default function SignUpPage() {
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
      <SignUp
        fallbackRedirectUrl="/dashboard"
        signInUrl="/sign-in"
        appearance={{
          variables: {
            colorBackground: '#181828',
            colorInputBackground: '#0d0d18',
            colorText: '#f1f0ff',
            colorTextSecondary: '#c0bedd',
            colorInputText: '#f1f0ff',
            colorNeutral: '#c4c3d8',
            colorPrimary: '#8b5cf6',
          },
        }}
      />
    </div>
  )
}
