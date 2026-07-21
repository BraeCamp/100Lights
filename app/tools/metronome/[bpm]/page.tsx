import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ToolShell from '@/components/tools/ToolShell'

const Metronome = dynamic(() => import('@/components/tools/Metronome'))

// The searched range. Each becomes its own page — "120 bpm metronome" and
// friends are high-volume, low-competition queries, and one template captures
// all of them.
const MIN = 40
const MAX = 220

function parse(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= MIN && n <= MAX ? n : null
}

// Tempo character for the copy, matched loosely to the classical markings.
function feel(bpm: number): string {
  if (bpm < 60) return 'a slow, spacious tempo — good for ballads and for practising a hard passage until it’s clean'
  if (bpm < 76) return 'an unhurried tempo you’ll find under a lot of soul and slow hip-hop'
  if (bpm < 100) return 'a relaxed walking tempo — a huge amount of pop and rock lives around here'
  if (bpm < 120) return 'a comfortable mid-tempo, the pocket for a great deal of R&B and indie'
  if (bpm < 140) return 'an upbeat, danceable tempo — house, disco, and most modern pop sit in this band'
  if (bpm < 170) return 'a fast, driving tempo you’ll hear in rock, drum and bass, and a lot of electronic music'
  return 'a very fast tempo — punk, speed metal, and the quicker end of dance music'
}

export function generateStaticParams() {
  return Array.from({ length: MAX - MIN + 1 }, (_, i) => ({ bpm: String(MIN + i) }))
}

export async function generateMetadata({ params }: { params: Promise<{ bpm: string }> }): Promise<Metadata> {
  const { bpm: raw } = await params
  const bpm = parse(raw)
  if (bpm == null) return { title: 'Metronome' }
  return {
    title: `${bpm} BPM Metronome — Free Online Click at ${bpm} Beats Per Minute`,
    description: `A free ${bpm} BPM metronome that runs in your browser. Start it instantly, add subdivisions or a tempo trainer, and keep perfect time at ${bpm} beats per minute.`,
    alternates: { canonical: `https://100lights.com/tools/metronome/${bpm}` },
    openGraph: {
      title: `${bpm} BPM Metronome — 100Lights`,
      description: `Free online metronome running at ${bpm} beats per minute. No download, no sign-up.`,
      url: `https://100lights.com/tools/metronome/${bpm}`,
      type: 'website',
      siteName: '100Lights',
    },
  }
}

export default async function BpmMetronomePage({ params }: { params: Promise<{ bpm: string }> }) {
  const { bpm: raw } = await params
  const bpm = parse(raw)
  if (bpm == null) notFound()

  return (
    <ToolShell
      title={`${bpm} BPM metronome`}
      intro={`A free metronome running at ${bpm} beats per minute — ${feel(bpm)}. Press start, or set your own tempo below.`}
    >
      <Metronome initialBpm={bpm} />

      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>Practising at {bpm} BPM</h2>
        <p style={{ margin: '0 0 10px' }}>
          Hit <strong>Start</strong> (or press the spacebar) and the click runs at {bpm} beats per minute. Turn on <strong>subdivisions</strong> to hear the eighth or sixteenth notes between the beats — the fastest way to tighten up fast passages. Click the beat dots to accent, quiet, or silence individual beats for odd meters.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          If {bpm} is your goal but not yet your speed, switch on the <strong>tempo trainer</strong>: set a lower starting tempo and let it climb toward {bpm} a few BPM at a time as you play. That&rsquo;s how you build speed without practising your mistakes faster.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Need a different tempo? Jump to{' '}
          {[Math.max(MIN, bpm - 10), Math.max(MIN, bpm - 5), Math.min(MAX, bpm + 5), Math.min(MAX, bpm + 10)]
            .filter((v, i, a) => v !== bpm && a.indexOf(v) === i)
            .map((v, i, arr) => (
              <span key={v}>
                <Link href={`/tools/metronome/${v}`} style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 2 }}>{v} BPM</Link>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
          , or the <Link href="/tools/metronome" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 2 }}>full metronome</Link>.
        </p>
      </div>
    </ToolShell>
  )
}
