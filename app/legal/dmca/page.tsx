import type { Metadata } from 'next'
import DmcaForm from './DmcaForm'

export const metadata: Metadata = {
  title: '100Lights — Copyright / DMCA Policy',
  description: 'How to report copyright infringement on 100Lights and file a DMCA takedown notice.',
  alternates: { canonical: 'https://100lights.com/legal/dmca' },
}

export default function DmcaPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div className="max-w-3xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Copyright &amp; DMCA Policy</h1>
        <p className="text-sm mb-10" style={{ color: 'var(--text-muted)' }}>How to report infringing content on 100Lights</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            100Lights respects the intellectual property of others and expects our community to do the same. Users are solely responsible for the content they upload and share. If you believe content on 100Lights infringes your copyright, you may submit a takedown notice using the form below and we will respond promptly.
          </p>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            We remove infringing material when we receive a valid notice, and we may terminate the accounts of repeat infringers. Filing a notice with knowingly false information may result in liability. If your content was removed and you believe that was a mistake, you may submit a counter-notice to the contact below.
          </p>
        </div>

        <h2 className="text-xl font-semibold mt-12 mb-4" style={{ color: 'var(--text-primary)' }}>File a takedown notice</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 22 }}>
          Complete all fields. A valid notice must identify the copyrighted work, point to where the infringing material appears on 100Lights, and include the two statements below.
        </p>

        <DmcaForm />

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 26, lineHeight: 1.6 }}>
          You may also reach our designated copyright agent by email. Counter-notices and other copyright correspondence can be sent to the same address.
        </p>
      </div>
    </div>
  )
}
