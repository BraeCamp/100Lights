'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ArrowRight } from 'lucide-react'

type Period = 'monthly' | 'annual'

const FREE_FEATURES = [
  'Full audio editor (DAW) — free forever',
  '500 MB storage — your first few songs',
  '5 projects',
]

const PRO_FEATURES = [
  '20 GB storage — multitrack sessions, stems, full albums',
  'Unlimited projects',
  'Edit shared projects live with collaborators',
  'Priority support',
]

export default function PricingSection() {
  const [period, setPeriod] = useState<Period>('monthly')

  const monthlyPrice = 19
  const annualTotal = 190
  const annualPerMonth = (annualTotal / 12).toFixed(2)
  const annualSavings = monthlyPrice * 12 - annualTotal

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
      <div className="text-center mb-10 sm:mb-14">
        <h2 id="pricing-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Simple, transparent pricing</h2>
        <p className="text-base mb-6" style={{ color: 'var(--text-secondary)' }}>The audio editor is free forever. Upgrade when your library outgrows 500 MB — Pro adds space, unlimited projects, and live collaboration.</p>

        {/* Billing toggle */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {(['monthly', 'annual'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="relative px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{
                background: period === p ? 'var(--accent)' : 'transparent',
                color: period === p ? '#fff' : 'var(--text-muted)',
              }}
            >
              {p === 'monthly' ? 'Monthly' : 'Annual'}
              {p === 'annual' && (
                <span
                  className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: period === 'annual' ? 'rgba(255,255,255,0.2)' : 'rgba(16,185,129,0.15)',
                    color: period === 'annual' ? '#fff' : 'var(--success)',
                  }}
                >
                  Save ${annualSavings}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Free */}
        <div className="p-8 rounded-2xl border flex flex-col" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="mb-6">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Free</p>
            <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>$0</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>No credit card required</p>
          </div>
          <ul className="flex flex-col gap-3 flex-1 mb-8">
            {FREE_FEATURES.map(f => (
              <li key={f} className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Check size={14} color="var(--success)" className="shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/sign-up"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold border"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
          >
            Get started free
          </Link>
        </div>

        {/* Pro */}
        <div
          className="p-8 rounded-2xl border flex flex-col relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(59,130,246,0.08))', borderColor: 'rgba(139,92,246,0.5)' }}
        >
          <div
            className="absolute top-5 right-5 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Most popular
          </div>
          <div className="mb-6">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent-light)' }}>Pro</p>
            <div className="flex items-end gap-1.5">
              <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {period === 'annual' ? `$${annualPerMonth}` : `$${monthlyPrice}`}
              </p>
              <p className="text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>/month</p>
            </div>
            {period === 'annual' ? (
              <p className="text-sm mt-1" style={{ color: 'var(--success)' }}>
                ${annualTotal}/year — save ${annualSavings}
              </p>
            ) : (
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Cancel anytime</p>
            )}
          </div>
          <ul className="flex flex-col gap-3 flex-1 mb-8">
            {PRO_FEATURES.map(f => (
              <li key={f} className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Check size={14} color="var(--accent-light)" className="shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/sign-up"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Start free, upgrade anytime <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  )
}
