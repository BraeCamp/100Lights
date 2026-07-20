export const metadata = {
  title: 'Firefly — Privacy Policy',
  description: 'Privacy policy for Firefly, the 100Lights mobile companion app. Firefly collects no data.',
}

export default function FireflyPrivacyPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div className="max-w-3xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Firefly — Privacy Policy</h1>
        <p className="text-sm mb-12" style={{ color: 'var(--text-muted)' }}>Last updated: July 2026</p>

        {[
          {
            title: '1. The Short Version',
            body: 'Firefly collects no data. The app has no account system, no analytics, no advertising, and makes no network requests. Everything you create stays on your device.',
          },
          {
            title: '2. Your Projects',
            body: 'Songs and sketches you make in Firefly are stored only in the app’s local storage on your device. They are never uploaded, synced, or transmitted anywhere by the app. Deleting the app deletes them.',
          },
          {
            title: '3. Sharing and Export',
            body: 'When you export a project or audio file, Firefly hands the file to your device’s system share sheet. Where it goes from there (AirDrop, Files, Drive, email, the 100Lights studio in your browser) is entirely your choice, handled by your device — Firefly itself sends nothing.',
          },
          {
            title: '4. Permissions',
            body: 'Firefly requests no permissions. It does not access your microphone, camera, contacts, location, or photos.',
          },
          {
            title: '5. Children',
            body: 'Firefly collects no personal information from anyone, including children.',
          },
          {
            title: '6. The 100Lights Web Service',
            body: 'Firefly is a companion to the 100Lights studio at 100lights.com. If you choose to open an exported project there, the 100Lights privacy policy applies to that service. The app itself does not connect to it.',
          },
          {
            title: '7. Changes and Contact',
            body: 'If a future version of Firefly ever changes any of the above (for example, adding optional sync), this policy and the app-store listings will be updated first. Questions: use the feedback option at 100lights.com.',
          },
        ].map(({ title, body }) => (
          <section key={title} className="mb-8">
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
