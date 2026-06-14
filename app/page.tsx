import Link from 'next/link'
import { Zap, Film, Mic, FileText, Camera, Newspaper, AlignLeft, ArrowRight, Check } from 'lucide-react'

const features = [
  { icon: Film, title: 'Video Clipping', description: 'AI identifies your best moments and cuts them into shareable clips automatically.', color: '#8b5cf6' },
  { icon: Mic, title: 'Transcription', description: 'Word-for-word transcripts with speaker detection, timestamps, and confidence scores.', color: '#3b82f6' },
  { icon: FileText, title: 'Article Generation', description: 'Turn any video or podcast into a full editorial article, ready to publish.', color: '#10b981' },
  { icon: Newspaper, title: 'Blog Posts', description: 'SEO-ready blog posts derived from your existing content with one click.', color: '#f59e0b' },
  { icon: AlignLeft, title: 'Podcast Editing', description: 'Remove silences, filler words, and clean up audio — all driven by AI.', color: '#ec4899' },
  { icon: Camera, title: 'Any Video or Audio', description: 'Dashcam, CCTV, calls, lectures — if it has audio, 100Lights can process it.', color: '#ef4444' },
]

const steps = [
  { number: '01', title: 'Upload your content', body: 'Drop in a video, podcast, or recording. We handle MP4, MOV, MKV, MP3, WAV and more — up to 4GB per file.' },
  { number: '02', title: 'AI processes everything', body: 'Our pipeline transcribes your content, identifies structure, and understands the context in minutes.' },
  { number: '03', title: 'Publish everywhere', body: 'Download articles, blog posts, show notes, clips, and transcripts — ready for every platform you use.' },
]

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Zap size={16} color="#fff" fill="#fff" />
          </div>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>100Lights</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="#features" className="hidden sm:block text-sm" style={{ color: 'var(--text-secondary)' }}>Features</Link>
          <Link href="#how-it-works" className="hidden sm:block text-sm" style={{ color: 'var(--text-secondary)' }}>How it works</Link>
          <Link href="#pricing" className="hidden sm:block text-sm" style={{ color: 'var(--text-secondary)' }}>Pricing</Link>
          <Link href="/sign-in" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Sign in</Link>
          <Link
            href="/sign-up"
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Get started <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 pt-16 sm:pt-24 pb-16 sm:pb-20 text-center">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8"
          style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
        >
          <Zap size={11} />
          AI-powered content repurposing
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold leading-tight tracking-tight mb-6" style={{ color: 'var(--text-primary)' }}>
          Turn hours of content into{' '}
          <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            minutes of work
          </span>
        </h1>
        <p className="text-base sm:text-lg max-w-2xl mx-auto mb-10" style={{ color: 'var(--text-secondary)' }}>
          Upload any video, podcast, or recording. 100Lights transcribes, analyzes, and generates articles, blog posts, show notes, and clips — automatically.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/sign-up"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Start for free <ArrowRight size={15} />
          </Link>
          <Link
            href="#how-it-works"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium"
            style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            How it works
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mt-10">
          {['No credit card required', 'Free tier available', 'Cancel anytime'].map((item) => (
            <div key={item} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Check size={12} color="var(--success)" />
              {item}
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Everything in one pipeline</h2>
          <p className="text-base" style={{ color: 'var(--text-secondary)' }}>One upload triggers a complete content repurposing workflow.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, description, color }) => (
            <div key={title} className="p-6 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: `${color}18` }}>
                <Icon size={18} color={color} />
              </div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>How it works</h2>
          <p className="text-base" style={{ color: 'var(--text-secondary)' }}>From raw recording to published content in three steps.</p>
        </div>
        <div className="flex flex-col gap-4">
          {steps.map(({ number, title, body }) => (
            <div key={number} className="flex gap-6 p-6 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="text-3xl font-bold shrink-0 leading-none" style={{ color: 'var(--border-light)' }}>
                {number}
              </div>
              <div>
                <h3 className="text-base font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Simple, transparent pricing</h2>
          <p className="text-base" style={{ color: 'var(--text-secondary)' }}>Start free. Upgrade when you need more.</p>
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
              {[
                '3 transcriptions / month',
                '10 AI content generations / month',
                '500 MB file storage',
                'Unlimited projects',
                'Full editor access',
              ].map((f) => (
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
                <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>$19</p>
                <p className="text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>/month</p>
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Cancel anytime</p>
            </div>
            <ul className="flex flex-col gap-3 flex-1 mb-8">
              {[
                '30 transcriptions / month',
                '100 AI content generations / month',
                '20 GB file storage',
                'Unlimited projects',
                'Full editor access',
                'Priority support',
              ].map((f) => (
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

      <section className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
        <div
          className="flex flex-col items-center text-center py-12 sm:py-16 px-6 sm:px-8 rounded-2xl border"
          style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(59, 130, 246, 0.08))', borderColor: 'rgba(139, 92, 246, 0.25)' }}
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Ready to start repurposing?</h2>
          <p className="text-base mb-8 max-w-lg" style={{ color: 'var(--text-secondary)' }}>
            Join creators who are multiplying their content output without multiplying their hours.
          </p>
          <Link
            href="/sign-up"
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Get started for free <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <footer className="border-t max-w-6xl mx-auto px-6 py-8" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-0 sm:justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} color="var(--text-muted)" />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>100Lights</span>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>© 2026 100Lights. Built for creators.</p>
            <Link href="/legal/terms" className="text-xs" style={{ color: 'var(--text-muted)' }}>Terms</Link>
            <Link href="/legal/privacy" className="text-xs" style={{ color: 'var(--text-muted)' }}>Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
