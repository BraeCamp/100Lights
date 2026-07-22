import type { Metadata } from 'next'

// QA-only page: auditions every rendered learn-article demo clip in one place,
// with labels (so you know which is which, unlike the blind A/B in the article).
// noindex — this is a tool, not content.
export const metadata: Metadata = {
  title: 'Audio check',
  robots: { index: false, follow: false },
}

type Clip = { file: string; label: string }
type Group = { title: string; note?: string; clips: Clip[] }

const GROUPS: Group[] = [
  {
    title: 'Can You Hear the Difference',
    clips: [
      { file: 'hear-comp-off', label: '1 · Compression — DRY' },
      { file: 'hear-comp-on', label: '1 · Compression — COMPRESSED' },
      { file: 'hear-eq-cut', label: '2 · EQ — low-mids CUT (scooped)' },
      { file: 'hear-eq-boost', label: '2 · EQ — low-mids BOOSTED (boomy)' },
      { file: 'hear-verb-08', label: '3 · Reverb — SHORT tail' },
      { file: 'hear-verb-14', label: '3 · Reverb — LONG tail' },
      { file: 'hear-hats-0', label: '4 · Hats — normal' },
      { file: 'hear-hats-plus1', label: '4 · Hats — +5 dB louder' },
    ],
  },
  { title: 'Sidechain', clips: [{ file: 'duck-off', label: 'Bass held (no duck)' }, { file: 'duck-on', label: 'Bass ducked to the kick' }] },
  { title: 'Mixing — high-pass', clips: [{ file: 'mix-mud', label: 'Everything full-range (mud)' }, { file: 'mix-hp', label: 'High-passed except kick/bass' }] },
  { title: 'Mixing — panning', clips: [{ file: 'mix-pan-center', label: 'Layers stacked centre' }, { file: 'mix-pan-wide', label: 'Layers panned hard L/R' }] },
  { title: 'Looping — the click', clips: [{ file: 'loop-clean', label: 'Clean seam' }, { file: 'loop-click', label: 'Clicks each loop' }] },
  { title: 'Ten licks — pedal point', clips: [{ file: 'pedal-roots', label: 'Bass follows the roots' }, { file: 'pedal-drone', label: 'Low A drone underneath' }] },
  { title: 'Piano roll — the hook', clips: [{ file: 'hook-identical', label: 'Repeat is identical' }, { file: 'hook-moved', label: 'Repeat shifted up' }] },
  { title: 'Song structure', clips: [{ file: 'eight-static', label: 'Never changes' }, { file: 'eight-developed', label: 'Drops an element at bar 8' }] },
  { title: 'Free sample packs', clips: [{ file: 'snare-clean', label: 'Clean library snare' }, { file: 'snare-layered', label: 'Rough clap layered in' }] },
  { title: 'You don’t need better gear', clips: [{ file: 'gear-competing', label: 'Elements competing' }, { file: 'gear-rebalanced', label: 'Rebalanced hierarchy' }] },
  { title: 'What is a DAW', clips: [{ file: 'daw-loop', label: 'The bored-loop demo' }] },
]

export default function AudioCheck() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 80px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>Audio check</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 28px', lineHeight: 1.6 }}>
          Every article demo clip, labelled. Use this to tell me what sounds wrong — by number/name and what you hear
          (e.g. &ldquo;1-compressed drones,&rdquo; &ldquo;3 tail too quiet,&rdquo; &ldquo;bass too loud in all of test 2&rdquo;).
        </p>
        {GROUPS.map(g => (
          <section key={g.title} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 15, fontWeight: 750, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{g.title}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.clips.map(c => (
                <div key={c.file} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.label}</span>
                  <audio controls preload="none" src={`/learn-audio/${c.file}.mp3`} style={{ width: '100%', height: 38 }} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
