export const metadata = { title: '100Lights — Terms of Service' }

export default function TermsPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div className="max-w-3xl mx-auto px-8 py-16">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Terms of Service</h1>
        <p className="text-sm mb-12" style={{ color: 'var(--text-muted)' }}>Last updated: June 2026</p>

        {[
          {
            title: '1. Acceptance of Terms',
            body: 'By accessing or using 100Lights ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.',
          },
          {
            title: '2. Description of Service',
            body: '100Lights is a creative platform for music production, podcast editing, video editing, and image creation. Features include a browser-based digital audio workstation, multi-camera video editor, chapter markers, RSS feed generation, and image layering tools.',
          },
          {
            title: '3. Account Registration',
            body: 'You must create an account to use the Service. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. You must provide accurate information and promptly update it if it changes.',
          },
          {
            title: '4. Acceptable Use',
            body: 'You may not use the Service to upload content you do not own or have rights to, to generate illegal or harmful content, to attempt to circumvent usage limits or security measures, or to resell or redistribute access to the Service without written permission.',
          },
          {
            title: '5. Your Content',
            body: 'You retain all ownership rights to content you upload. By uploading content, you grant 100Lights a limited, non-exclusive licence to process and store that content solely to provide the Service to you. We do not use your content to train machine-learning models.',
          },
          {
            title: '6. Payment and Billing',
            body: 'Paid plans are billed in advance on a monthly or annual basis. All fees are non-refundable except where required by law. We reserve the right to change pricing with 30 days notice.',
          },
          {
            title: '7. Service Availability',
            body: 'We aim for high availability but do not guarantee uninterrupted access. We may temporarily suspend the Service for maintenance, upgrades, or circumstances beyond our control.',
          },
          {
            title: '8. Termination',
            body: 'Either party may terminate at any time. Upon termination, your access to the Service will cease and your stored data will be deleted after a 30-day grace period. We may terminate accounts that violate these Terms without notice.',
          },
          {
            title: '9. Disclaimer of Warranties',
            body: 'The Service is provided "as is" without warranties of any kind, express or implied. Automated processing such as transcription may contain errors; you are responsible for reviewing and verifying any output before use.',
          },
          {
            title: '10. User Content & the Community',
            body: 'You may share songs, samples, presets, recipes, and projects to the public Community. You keep ownership of everything you share; by sharing, you grant 100Lights a non-exclusive, worldwide license to host, stream, and display that content within the Service, and you grant other users the right to download and use it in their own projects. Only share audio you created or have the rights to distribute. We may remove any shared content at our discretion, including content that is reported by other users.',
          },
          {
            title: '11. Copyright & Takedown',
            body: 'We respect intellectual property rights. If you believe content shared on 100Lights infringes your copyright, report it using the flag on the item or email legal@100lights.com with a link to the content, a description of the copyrighted work, and your contact information. We review reports promptly and remove infringing content. Repeat infringers will have their accounts terminated.',
          },
          {
            title: '12. Limitation of Liability',
            body: 'To the maximum extent permitted by law, 100Lights shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service. Our total liability shall not exceed the fees paid by you in the 12 months preceding the claim.',
          },
          {
            title: '13. Governing Law',
            body: 'These Terms are governed by the laws of the jurisdiction in which 100Lights operates, without regard to conflict of law principles.',
          },
          {
            title: '14. Changes to Terms',
            body: 'We may update these Terms from time to time. We will notify you of material changes by email or in-app notice. Continued use after notice constitutes acceptance of the updated Terms.',
          },
          {
            title: '15. Contact',
            body: 'Questions about these Terms? Contact us at legal@100lights.com.',
          },
        ].map(({ title, body }) => (
          <div key={title} className="mb-8">
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
