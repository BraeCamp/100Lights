import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import {
  Zap, Check, ArrowRight,
  Layers, Music2, Sliders, CircleDot,
  Camera, Film, Monitor, Mic2,
  Music,
} from 'lucide-react'
import PricingSection from '@/components/PricingSection'

export const metadata: Metadata = {
  title: { absolute: '100Lights — Professional Audio & Video Editing' },
  description: 'A full digital audio workstation and live multi-camera video session editor, built for the browser. Compose, mix, record, and edit — no downloads required.',
  keywords: ['audio editor', 'video editor', 'DAW', 'digital audio workstation', 'browser DAW', 'online audio editor', 'multi-camera editor', 'live session editor'],
  openGraph: {
    title: '100Lights — Professional Audio & Video Editing',
    description: 'A full DAW and multi-camera live session editor built for the browser. No downloads, no plugins.',
    url: 'https://100lights.com',
    type: 'website',
    siteName: '100Lights',
  },
  twitter: {
    card: 'summary_large_image',
    title: '100Lights — Professional Audio & Video Editing',
    description: 'A full DAW and multi-camera live session editor built for the browser.',
  },
  alternates: { canonical: 'https://100lights.com' },
}

const audioFeatures = [
  {
    icon: Layers,
    title: 'Session & Arrangement View',
    description: 'Launch clips in real time from Session View or compose full arrangements in the timeline — like Ableton Live, right in your browser.',
    color: '#3b82f6',
  },
  {
    icon: Music2,
    title: 'Piano Roll & MIDI',
    description: 'Write and edit MIDI patterns with a full piano roll. Add Arpeggiator, Chord, Scale, and Velocity MIDI effects.',
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
    title: 'Drum Rack',
    description: 'Color-coded 8-pad drum rack with per-pad volume, pitch, pan, and mute controls. Acoustic and 808 packs included.',
    color: '#f59e0b',
  },
]

const videoFeatures = [
  {
    icon: Camera,
    title: 'Live Camera Session',
    description: 'Switch between camera angles in real time. Point the camera at the sound source automatically, or take manual control. The Session View model applied to live video.',
    color: '#8b5cf6',
  },
  {
    icon: Film,
    title: 'Timeline Editing',
    description: 'Multi-track video timeline with precise cut control, transitions, and a blade tool. Edit your footage with frame-accurate precision.',
    color: '#3b82f6',
  },
  {
    icon: Monitor,
    title: 'Color Grading',
    description: 'Built-in color tools with brightness, contrast, saturation, and highlights controls — all non-destructive. LUT support included.',
    color: '#ec4899',
  },
  {
    icon: Mic2,
    title: 'Audio Mixing',
    description: 'Per-track audio channel strips with volume, solo, mute, and EQ. Sync your multi-camera audio in one place.',
    color: '#14b8a6',
  },
]

const steps = [
  {
    title: 'Open your project',
    body: 'Choose Audio or Video, name your project, and jump straight into your editor — no downloads, no plugins, no waiting.',
  },
  {
    title: 'Create and refine',
    body: 'Arrange tracks, mix audio, launch clips live, or cut and grade your video. All professional tools, all in the browser.',
  },
  {
    title: 'Export and share',
    body: 'Render your final audio mix or video cut and share it anywhere. Your projects are saved automatically.',
  },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '100Lights',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web browser',
  description: 'Professional audio and video editing suite for the browser. Includes a full digital audio workstation and a live multi-camera video session editor.',
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
              <Link href="#audio-editor" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Audio</Link>
              <Link href="#video-editor" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Video</Link>
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
              <Zap size={11} aria-hidden="true" />
              Professional editing in the browser
            </div>

            <h1
              id="hero-heading"
              className="text-3xl sm:text-5xl font-bold leading-tight tracking-tight mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Audio and video editing —{' '}
              <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                built for the browser
              </span>
            </h1>

            <p className="text-base sm:text-lg max-w-2xl mx-auto mb-10" style={{ color: 'var(--text-secondary)' }}>
              100Lights is a professional creative suite — a full digital audio workstation and a live multi-camera session editor, all running in your browser. No downloads. No plugins. Open it and create.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Start for free <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link
                href="#audio-editor"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                See what&apos;s inside
              </Link>
            </div>

            <div
              className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mt-10"
              role="list"
            >
              {['No credit card required', 'Free tier available', 'Cancel anytime'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }} role="listitem">
                  <Check size={12} color="var(--success)" aria-hidden="true" />
                  {item}
                </div>
              ))}
            </div>
          </section>

          {/* ── Audio Editor ── */}
          <section
            id="audio-editor"
            aria-labelledby="audio-heading"
            className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div className="text-center mb-10 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
                style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.25)' }}
              >
                <Music size={11} aria-hidden="true" />
                Audio Editor
              </div>
              <h2 id="audio-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                A full DAW — in your browser
              </h2>
              <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Session View for live clip launching, a full Arrangement timeline, Piano Roll for MIDI composition, an 8-pad Drum Rack, and a complete effects chain — all running without a single download.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {audioFeatures.map(({ icon: Icon, title, description, color }) => (
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

          {/* ── Video Editor ── */}
          <section
            id="video-editor"
            aria-labelledby="video-heading"
            className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24"
          >
            <div className="text-center mb-10 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
                style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#a78bfa', border: '1px solid rgba(139, 92, 246, 0.25)' }}
              >
                <Film size={11} aria-hidden="true" />
                Video Editor
              </div>
              <h2 id="video-heading" className="text-2xl sm:text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Live multi-camera session editing
              </h2>
              <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Apply the Session View model to video — switch camera angles live by sound source or manual control, then refine your cut in the multi-track timeline with color grading and audio mixing built in.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videoFeatures.map(({ icon: Icon, title, description, color }) => (
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
                Ready to start creating?
              </h2>
              <p className="text-base mb-8 max-w-lg" style={{ color: 'var(--text-secondary)' }}>
                Open your audio or video project now — it&apos;s free to start, no downloads required.
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
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>© 2026 100Lights. Built for creators.</p>
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
