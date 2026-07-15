import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import {
  Zap, Check, ArrowRight,
  Layers, Music2, Sliders, CircleDot,
  Library, Globe2, Users, AudioLines,
  Music,
} from 'lucide-react'
import PricingSection from '@/components/PricingSection'

export const metadata: Metadata = {
  title: { absolute: '100Lights — The Music Studio in Your Browser' },
  description: 'A full digital audio workstation that runs in the browser: Session and Arrangement views, piano roll, drum rack, mixer, and a community of shared sounds and chord recipes. Free to start — no downloads.',
  keywords: ['browser DAW', 'online music studio', 'digital audio workstation', 'online audio editor', 'make music in browser', 'free DAW', 'piano roll online', 'chord progressions', 'sample library', 'music collaboration'],
  openGraph: {
    title: '100Lights — The Music Studio in Your Browser',
    description: 'A full DAW in the browser: Session View, piano roll, drum rack, mixer, and a community of shared sounds and recipes. No downloads, no plugins.',
    url: 'https://100lights.com',
    type: 'website',
    siteName: '100Lights',
  },
  twitter: {
    card: 'summary_large_image',
    title: '100Lights — The Music Studio in Your Browser',
    description: 'A full DAW in the browser, with a community of shared sounds and chord recipes. Free to start.',
  },
  alternates: { canonical: 'https://100lights.com' },
}

const studioFeatures = [
  {
    icon: Layers,
    title: 'Session & Arrangement View',
    description: 'Launch clips in real time from Session View or compose full arrangements in the timeline — like Ableton Live, right in your browser.',
    color: '#3b82f6',
  },
  {
    icon: Music2,
    title: 'Piano Roll that listens',
    description: 'A full piano roll with per-roll sustain and effects — plus voice mapping: sing a melody and see your pitch traced over the keys while you place the notes.',
    color: '#8b5cf6',
  },
  {
    icon: Sliders,
    title: 'Mixing & Effects',
    description: 'Full mixer with sends, returns, and a per-track effects chain: EQ, Compressor, Reverb, Delay, Saturator, Auto Pan, and more.',
    color: '#10b981',
  },
  {
    icon: CircleDot,
    title: 'Drum Rack & JAM',
    description: 'Color-coded 8-pad drum rack with per-pad volume, pitch, pan, and mute — and JAM mode to capture a live take straight onto the timeline.',
    color: '#f59e0b',
  },
]

const beyondFeatures = [
  {
    icon: Library,
    title: 'A sound library that sustains',
    description: 'Over a thousand built-in sounds across strings, keys, guitar, synths, brass, and drums. Every sample stretches to any note length — hold a violin for four bars and it keeps singing.',
    color: '#14b8a6',
  },
  {
    icon: Globe2,
    title: 'Community sounds & recipes',
    description: 'Share samples, packs, presets, and chord-progression recipes with a public link anyone can play — no account needed to listen. Pull anything you find straight into your library.',
    color: '#34d399',
  },
  {
    icon: Users,
    title: 'Real-time collaboration',
    description: 'Share a project link and work on the same session together, live. Keep it private with an invite list or open it up public — you control who can edit and who can listen.',
    color: '#ec4899',
  },
  {
    icon: AudioLines,
    title: 'Podcast mode',
    description: 'The same studio, tuned for talk: multitrack recording, level riding, and clean exports for your show.',
    color: '#60a5fa',
  },
]

const steps = [
  {
    title: 'Open the studio',
    body: 'Name your project and you’re in — no downloads, no plugins, no waiting. Start from silence or drop a chord recipe on a track and build from there.',
  },
  {
    title: 'Make it yours',
    body: 'Arrange tracks, write MIDI in the piano roll, capture live takes with JAM, and mix with the full effects chain. Every session sharpens your ear.',
  },
  {
    title: 'Share it',
    body: 'Export your mix, invite a collaborator into the session, or publish sounds and recipes to the community with a link anyone can play.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '100Lights',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web, macOS, Windows',
  description: 'A full digital audio workstation for the browser: Session and Arrangement views, piano roll, drum rack, mixer, real-time collaboration, and a community of shared sounds and chord recipes.',
  url: 'https://100lights.com',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
}

export default async function LandingPage() {
  const { userId } = await auth()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>

        {/* ── Header ── */}
        <header>
          <nav
            aria-label="Main navigation"
            className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto"
          >
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5" aria-label="100Lights home">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent)' }}
              >
                <Zap size={16} color="#fff" fill="#fff" aria-hidden="true" />
              </div>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>100Lights</span>
            </Link>

            {/* Nav links */}
            <div className="hidden sm:flex items-center gap-6">
              <Link href="#studio" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Studio</Link>
              <Link href="/community" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Community</Link>
              <Link href="#pricing" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Pricing</Link>
            </div>

            {/* Auth-aware right side */}
            <div className="flex items-center gap-3">
              {userId ? (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Dashboard <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : (
                <>
                  <Link href="/sign-in" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Sign in</Link>
                  <Link
                    href="/sign-up"
                    className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>

        {/* ── Main ── */}
        <main id="main">

          {/* ── Hero ── */}
          <section
            aria-labelledby="hero-heading"
            className="max-w-4xl mx-auto px-6 pt-16 sm:pt-24 pb-16 sm:pb-20 text-center"
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
            >
              <Music size={11} aria-hidden="true" />
              A full DAW in your browser
            </div>

            <h1
              id="hero-heading"
              className="text-3xl sm:text-5xl font-bold leading-tight tracking-tight mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              A studio that{' '}
              <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                trains your ears
              </span>
            </h1>

            <p className="text-base sm:text-lg max-w-2xl mx-auto mb-10" style={{ color: 'var(--text-secondary)' }}>
              Most music software does the work for you. 100Lights is built so the work makes you better —
              a real digital audio workstation with Session View, a piano roll that traces your singing,
              and a community of sounds and chord recipes to learn from. In the browser, free to start.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Start making music <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link
                href="/community"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Hear what people are making
              </Link>
            </div>

            <div
              className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mt-10"
              role="list"
            >
              {['Runs in your browser — nothing to install', 'Free tier, no card required', 'Desktop app for Mac & Windows'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }} role="listitem">
                  <Check size={12} color="var(--success)" aria-hidden="true" />
                  {item}
                </div>
              ))}
            </div>

            {/* Demo loop — a real session: metronome, live JAM capture, mix tweaks */}
            <div
              className="mt-12 sm:mt-16 rounded-2xl border overflow-hidden mx-auto"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', boxShadow: '0 24px 60px rgba(0,0,0,0.45)', maxWidth: 960 }}
            >
              <video
                src="/demo/daw-loop.webm"
                poster="/demo/daw-poster.jpg"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="30-second loop of the 100Lights studio: adding tracks, capturing a live take with JAM, and riding a volume fader"
                className="w-full block"
                style={{ aspectRatio: '1280 / 800' }}
              />
            </div>
          </section>

          {/* ── The Studio ── */}
          <section
            id="studio"
            aria-labelledby="studio-heading"
            className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div className="text-center mb-10 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
                style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.25)' }}
              >
                <Music size={11} aria-hidden="true" />
                The Studio
              </div>
              <h2 id="studio-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Everything a DAW should have
              </h2>
              <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Session View for live clip launching, a full Arrangement timeline, MIDI composition with
                Arpeggiator, Chord, Scale, and Velocity effects, and a complete mixing chain — all running
                without a single download.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {studioFeatures.map(({ icon: Icon, title, description, color }) => (
                <article
                  key={title}
                  className="p-6 rounded-xl border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: `${color}18` }}
                  >
                    <Icon size={18} color={color} aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── Beyond the timeline ── */}
          <section
            id="community"
            aria-labelledby="beyond-heading"
            className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div className="text-center mb-10 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
                style={{ background: 'rgba(52, 211, 153, 0.12)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.25)' }}
              >
                <Globe2 size={11} aria-hidden="true" />
                Sounds &amp; Community
              </div>
              <h2 id="beyond-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                You never start from nothing
              </h2>
              <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                A deep built-in sound library, chord-progression recipes you can drag straight onto a track,
                and a community where every share is a public link anyone can listen to.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {beyondFeatures.map(({ icon: Icon, title, description, color }) => (
                <article
                  key={title}
                  className="p-6 rounded-xl border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: `${color}18` }}
                  >
                    <Icon size={18} color={color} aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── How it works ── */}
          <section
            id="how-it-works"
            aria-labelledby="how-heading"
            className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div className="text-center mb-10 sm:mb-14">
              <h2 id="how-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                How it works
              </h2>
            </div>

            <ol className="flex flex-col gap-4">
              {steps.map(({ title, body }, i) => (
                <li
                  key={title}
                  className="flex gap-6 p-6 rounded-xl border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div
                    className="text-3xl font-bold shrink-0 leading-none tabular-nums"
                    style={{ color: 'var(--border-light)' }}
                    aria-hidden="true"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Pricing ── */}
          <PricingSection />

          {/* ── CTA ── */}
          <section
            aria-labelledby="cta-heading"
            className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div
              className="flex flex-col items-center text-center py-12 sm:py-16 px-6 sm:px-8 rounded-2xl border"
              style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(59, 130, 246, 0.08))', borderColor: 'rgba(139, 92, 246, 0.25)' }}
            >
              <h2 id="cta-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Your first track is a click away
              </h2>
              <p className="text-base mb-8 max-w-lg" style={{ color: 'var(--text-secondary)' }}>
                Open the studio, drop a chord recipe on a track, and start shaping your sound — free, in the browser, right now.
              </p>
              <Link
                href="/sign-up"
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Get started for free <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </section>

        </main>

        {/* ── Footer ── */}
        <footer className="border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-0 sm:justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded flex items-center justify-center"
                  style={{ background: 'var(--accent)' }}
                >
                  <Zap size={12} color="#fff" fill="#fff" aria-hidden="true" />
                </div>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>100Lights</span>
              </div>
              <nav aria-label="Footer navigation">
                <div className="flex items-center gap-4">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>© 2026 100Lights. Built for musicians.</p>
                  <Link href="/community" className="text-xs" style={{ color: 'var(--text-muted)' }}>Community</Link>
                  <Link href="/legal/terms" className="text-xs" style={{ color: 'var(--text-muted)' }}>Terms</Link>
                  <Link href="/legal/privacy" className="text-xs" style={{ color: 'var(--text-muted)' }}>Privacy</Link>
                </div>
              </nav>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
