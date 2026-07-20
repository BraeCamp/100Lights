export const metadata = {
  title: 'Firefly — Privacy Policy',
  description: 'Privacy policy for Firefly, the 100Lights mobile companion app. Firefly collects no data.',
}

export default function FireflyPrivacyPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div className="max-w-3xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Firefly — Privacy Policy</h1>
        <p className="text-sm mb-12" style={{ color: 'var(--text-muted)' }}>Last updated: July 20, 2026</p>

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
            body: 'When you export a project or audio file, Firefly hands the file to your device’s system share sheet. Where it goes from there (AirDrop, Files, Drive, email, the 100Lights studio in your browser) is entirely your choice, handled by your device — Firefly itself sends nothing. If your project contains recordings, the exported file is a bundle that includes those recordings, so that they open alongside the rest of your project.',
          },
          {
            title: '4. Microphone',
            body: 'Firefly asks for microphone access only when you tap record on an audio track, and uses it only to capture that recording. Recordings are stored on your device alongside your project. Firefly never uploads them: the app has no network access at all, and on Android it does not even request internet permission. They leave your device only if you choose to export or share them, in which case they travel wherever you send them — see “Sharing and Export” above. Firefly requests no other permissions: no camera, contacts, location, or photos.',
          },
          {
            title: '5. Children',
            body: 'Firefly collects no personal information from anyone, including children.',
          },
          {
            title: '6. The 100Lights Web Service',
            body: 'Firefly is a companion to the 100Lights studio at 100lights.com, but the app itself never connects to it — moving a project between the two is something you do by hand, by exporting a file and then opening it. If you do open an exported project in 100Lights while signed in, any recordings it contains are uploaded to your 100Lights account so they keep working after you reload the page. At that point they are stored by the 100Lights service and its privacy policy governs them. Nothing is uploaded until you import a project yourself.',
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
