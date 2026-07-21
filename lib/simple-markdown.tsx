// Tiny markdown renderer for the Learn section — a deliberate subset
// (headings, lists, quotes, code, links, bold/italic, images) rendered to
// React elements, so there is no dangerouslySetInnerHTML anywhere. Also
// understands `@video` slots: a line like
//   @video A 30-second clip of building the drum loop
// renders a labeled placeholder card, and
//   @video(https://...mp4) Same clip, now recorded
// renders the actual player once a URL is added.

import React from 'react'
import LazyArticleWidget from '@/components/LazyArticleWidget'
import type { ProgressionData } from '@/components/ArticleProgression'
import type { GridSpec } from '@/components/ArticleGrid'
import type { ABSpec } from '@/components/ArticleAB'
import type { SynthConfig } from '@/components/SynthPlayground'

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // tokens: `code`, **bold**, *italic*, [text](url), ![alt](src)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) out.push(<code key={key} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('![')) {
      const alt = tok.slice(2, tok.indexOf(']'))
      const src = tok.slice(tok.indexOf('(') + 1, -1)
      // eslint-disable-next-line @next/next/no-img-element
      out.push(<img key={key} src={src} alt={alt} loading="lazy" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />)
    } else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    else {
      const label = tok.slice(1, tok.indexOf(']'))
      const href = tok.slice(tok.indexOf('(') + 1, -1)
      const external = /^https?:\/\//.test(href) && !href.startsWith('https://100lights.com')
      out.push(<a key={key} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>{label}</a>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function VideoSlot({ url, caption }: { url: string | null; caption: string }) {
  if (url) {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
    return (
      <figure style={{ margin: '28px 0' }}>
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt[1]}`}
            title={caption || 'Video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', aspectRatio: '16 / 9', border: '1px solid var(--border)', borderRadius: 12, display: 'block' }}
          />
        ) : (
          <video src={url} controls playsInline preload="metadata" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)', display: 'block' }} />
        )}
        {caption && <figcaption style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{caption}</figcaption>}
      </figure>
    )
  }
  return (
    <div aria-hidden="true" style={{
      margin: '28px 0', padding: '26px 20px', borderRadius: 12, textAlign: 'center',
      border: '1px dashed var(--border)', background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>🎬</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>Video coming soon{caption ? ` — ${caption}` : ''}</div>
    </div>
  )
}

/**
 * Server-rendered stand-in for the interactive piano.
 *
 * This is not a spinner — it's the article's actual content in text form.
 * The chord names and key are the substance a search engine should see, and
 * they're identical to what the widget shows collapsed, so the swap is
 * invisible to a reader.
 */
function ProgressionFallback({ data }: { data: ProgressionData }) {
  const names = data.chords.map(c => c.name).join(' → ')
  return (
    <figure style={{ margin: '24px 0', padding: '18px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{names}</p>
      {data.originalKey && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>Key of {data.originalKey}</p>
      )}
      {data.caption && (
        <figcaption style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: 1.6 }}>{data.caption}</figcaption>
      )}
    </figure>
  )
}

/** Server-rendered stand-in for a community sound embed — keeps the caption
 *  in the document even if the fetch never happens. */
function SoundFallback({ caption }: { caption: string }) {
  return (
    <figure style={{ margin: '24px 0', padding: '18px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>♪ Sound preview</p>
      {caption && (
        <figcaption style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0', lineHeight: 1.6 }}>{caption}</figcaption>
      )}
    </figure>
  )
}

/**
 * Callouts that keep the two kinds of explanation visually apart.
 *
 * `@theory` is why something sounds the way it does. `@math` is the
 * arithmetic behind it, and is always optional — articles are written so that
 * deleting every @math block leaves them intact, which is why this one is
 * styled as an aside and labeled skippable. `@ear` is a listening
 * instruction. Mixing theory and math in one block was the thing to avoid;
 * making them different shapes on the page is what enforces it.
 */
const CALLOUTS = {
  theory: { label: 'Theory', accent: '#a78bfa', tint: 'rgba(167,139,250,0.09)', mono: false, note: '' },
  math:   { label: 'Math',   accent: '#38bdf8', tint: 'rgba(56,189,248,0.08)',  mono: true,  note: 'optional — skip it and nothing breaks' },
  ear:    { label: 'Ear',    accent: '#34d399', tint: 'rgba(52,211,153,0.08)',  mono: false, note: 'go listen' },
} as const

type CalloutKind = keyof typeof CALLOUTS

function Callout({ kind, text, keyBase }: { kind: CalloutKind; text: string; keyBase: string }) {
  const c = CALLOUTS[kind]
  return (
    <aside
      style={{
        margin: '22px 0',
        padding: '14px 18px',
        borderLeft: `3px solid ${c.accent}`,
        borderRadius: '0 10px 10px 0',
        background: c.tint,
      }}
    >
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: c.accent }}>
          {c.label}
        </span>
        {c.note && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>{c.note}</span>
        )}
      </p>
      <div
        style={{
          fontSize: c.mono ? 14 : 15,
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
          fontFamily: c.mono ? 'var(--font-geist-mono), ui-monospace, monospace' : undefined,
        }}
      >
        {inline(text, keyBase)}
      </div>
    </aside>
  )
}

/**
 * Server-rendered stand-in for the step sequencer: the pattern written out in
 * words. A crawler and a no-JS reader get the actual drum pattern, which is
 * the content — the grid is a nicer way to receive it, not the only way.
 */
function GridFallback({ spec }: { spec: GridSpec }) {
  return (
    <figure style={{ margin: '24px 0', padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
        {spec.bpm} BPM pattern
      </p>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        {spec.lanes.map((lane, li) => {
          const hits = (spec.pattern[li] ?? []).map(s => s / 4 + 1)
          return (
            <li key={lane.name}>
              <strong>{lane.name}</strong> — {hits.length ? `beats ${hits.map(h => (Number.isInteger(h) ? h : h.toFixed(2))).join(', ')}` : 'silent'}
            </li>
          )
        })}
      </ul>
      {spec.caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>{spec.caption}</figcaption>
      )}
    </figure>
  )
}

/** Server-rendered stand-in for the A/B test — both clips as plain players. */
function ABFallback({ spec }: { spec: ABSpec }) {
  return (
    <figure style={{ margin: '24px 0', padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600 }}>{spec.question}</p>
      <audio controls preload="none" src={spec.plainSrc} style={{ width: '100%', height: 36, display: 'block', marginBottom: 6 }} aria-label="Clip one" />
      <audio controls preload="none" src={spec.treatedSrc} style={{ width: '100%', height: 36, display: 'block' }} aria-label="Clip two" />
      {spec.explanation && (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>{spec.explanation}</p>
      )}
    </figure>
  )
}

/** Server-rendered stand-in for the synth playground — the patch as readable
 *  text, so the recipe survives with no JS and crawlers get the numbers. */
function SynthFallback({ config }: { config: SynthConfig }) {
  const voices = config.voices ?? 2
  return (
    <figure style={{ margin: '24px 0', padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Reese bass patch</p>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <li>{voices} sawtooth oscillator{voices > 1 ? 's' : ''}{voices > 1 ? `, detuned ${config.detune ?? 9} cents apart` : ''}</li>
        <li>Low-pass filter at {config.cutoff ?? 620} Hz, resonance Q {config.resonance ?? 6}</li>
        <li>Fast attack, high sustain envelope</li>
      </ul>
      {config.caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>{config.caption}</figcaption>
      )}
    </figure>
  )
}

/** GitHub-style pipe table. Added because the one published article uses one
 *  and it was rendering as literal pipe characters on the live site. */
function Table({ rows, keyBase }: { rows: string[][]; keyBase: string }) {
  const [head, ...body] = rows
  const cell: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', verticalAlign: 'top' }
  return (
    <div style={{ overflowX: 'auto', margin: '20px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${keyBase}-h${i}`} style={{ ...cell, color: 'var(--text-primary)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {inline(h, `${keyBase}-h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={`${keyBase}-r${ri}`}>
              {r.map((c, ci) => (
                <td key={`${keyBase}-r${ri}c${ci}`} style={{ ...cell, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {inline(c, `${keyBase}-r${ri}c${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Splits a pipe-table block into cells, or returns null if it isn't one. */
function parseTable(block: string): string[][] | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2 || !lines.every(l => l.includes('|'))) return null
  // Second line must be the ---|--- separator.
  if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[1])) return null
  const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  return [cells(lines[0]), ...lines.slice(2).map(cells)]
}

export function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.split(/\n\s*\n/)
  const out: React.ReactNode[] = []
  blocks.forEach((block, bi) => {
    const b = block.trim()
    if (!b) return
    const key = `b${bi}`
    if (b.startsWith('```')) {
      const code = b.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      out.push(<pre key={key} style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', overflowX: 'auto', fontSize: 13, lineHeight: 1.55 }}><code>{code}</code></pre>)
      return
    }
    // @theory / @math / @ear — see CALLOUTS. Checked before @video so the
    // prefix match can't be shadowed.
    {
      const m = b.match(/^@(theory|math|ear)\b\s*([\s\S]*)$/)
      if (m) {
        const text = m[2].trim()
        if (text) out.push(<Callout key={key} kind={m[1] as CalloutKind} text={text} keyBase={key} />)
        return
      }
    }
    if (b.startsWith('@video')) {
      const m = b.match(/^@video(?:\(([^)]+)\))?\s*([\s\S]*)$/)
      out.push(<VideoSlot key={key} url={m?.[1] ?? null} caption={m?.[2]?.trim() ?? ''} />)
      return
    }
    // @audio(url) caption — plain audio file player (uploaded or any URL)
    if (b.startsWith('@audio')) {
      const m = b.match(/^@audio\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        const caption = m[2]?.trim() ?? ''
        // Fallback is a real, working native player — this upgrades to the
        // themed one, it never gates playback on JS.
        out.push(
          <LazyArticleWidget key={key} kind="audio" props={{ src: m[1], caption }}>
            <figure style={{ margin: '22px 0' }}>
              <audio controls preload="none" src={m[1]} style={{ width: '100%', height: 40, display: 'block' }} aria-label={caption ? `Audio: ${caption}` : 'Audio clip'} />
              {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
            </figure>
          </LazyArticleWidget>
        )
      }
      return
    }
    // @grid(<uri-encoded json>) caption — playable step sequencer
    if (b.startsWith('@grid')) {
      const m = b.match(/^@grid\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        try {
          const spec = JSON.parse(decodeURIComponent(m[1])) as GridSpec
          if (m[2]?.trim()) spec.caption = m[2].trim()
          if (spec.lanes?.length) {
            out.push(
              <LazyArticleWidget key={key} kind="grid" props={{ spec }}>
                <GridFallback spec={spec} />
              </LazyArticleWidget>
            )
          }
        } catch { /* malformed payload — skip */ }
      }
      return
    }
    // @ab(<uri-encoded json>) caption — blind A/B listening test
    if (b.startsWith('@ab')) {
      const m = b.match(/^@ab\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        try {
          const spec = JSON.parse(decodeURIComponent(m[1])) as ABSpec
          if (m[2]?.trim()) spec.caption = m[2].trim()
          if (spec.treatedSrc && spec.plainSrc) {
            out.push(
              <LazyArticleWidget key={key} kind="ab" props={{ spec }}>
                <ABFallback spec={spec} />
              </LazyArticleWidget>
            )
          }
        } catch { /* malformed payload — skip */ }
      }
      return
    }
    // @synth(<uri-encoded json>) caption — playable subtractive synth; the
    // reader builds the sound by dragging detune / cutoff / resonance live
    if (b.startsWith('@synth')) {
      const m = b.match(/^@synth\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        try {
          const config = JSON.parse(decodeURIComponent(m[1])) as SynthConfig
          if (m[2]?.trim()) config.caption = m[2].trim()
          out.push(
            <LazyArticleWidget key={key} kind="synth" props={{ config }}>
              <SynthFallback config={config} />
            </LazyArticleWidget>
          )
        } catch { /* malformed payload — skip */ }
      }
      return
    }
    // @sound(communityItemId) caption — embeds a shared sample/recipe/song
    if (b.startsWith('@sound')) {
      const m = b.match(/^@sound\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        const caption = m[2]?.trim() ?? ''
        out.push(
          <LazyArticleWidget key={key} kind="sound" props={{ itemId: m[1].trim(), caption }}>
            <SoundFallback caption={caption} />
          </LazyArticleWidget>
        )
      }
      return
    }
    // @progression(<uri-encoded json>) caption — chord progression with the
    // interactive piano viewer (see-more, transpose, per-chord highlight)
    if (b.startsWith('@progression')) {
      const m = b.match(/^@progression\(([^)]+)\)\s*([\s\S]*)$/)
      if (m) {
        try {
          const parsed = JSON.parse(decodeURIComponent(m[1])) as ProgressionData
          if (m[2]?.trim()) parsed.caption = m[2].trim()
          if (parsed.chords?.length) {
            out.push(
              <LazyArticleWidget key={key} kind="progression" props={{ data: parsed }}>
                <ProgressionFallback data={parsed} />
              </LazyArticleWidget>
            )
          }
        } catch { /* malformed payload — skip */ }
      }
      return
    }
    if (/^#{1,3}\s/.test(b)) {
      const level = b.match(/^#+/)![0].length
      const text = b.replace(/^#+\s*/, '')
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
      const style = { color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.3, marginTop: level === 1 ? 0 : 36, marginBottom: 12 }
      if (level === 1) out.push(<h1 key={key} id={id} style={{ ...style, fontSize: 32, fontWeight: 800 }}>{inline(text, key)}</h1>)
      else if (level === 2) out.push(<h2 key={key} id={id} style={{ ...style, fontSize: 23, fontWeight: 750 }}>{inline(text, key)}</h2>)
      else out.push(<h3 key={key} id={id} style={{ ...style, fontSize: 17, fontWeight: 700 }}>{inline(text, key)}</h3>)
      return
    }
    if (b.includes('|')) {
      const rows = parseTable(b)
      if (rows) { out.push(<Table key={key} rows={rows} keyBase={key} />); return }
    }
    if (/^>\s/.test(b)) {
      out.push(<blockquote key={key} style={{ borderLeft: '3px solid #a78bfa', margin: '20px 0', padding: '4px 0 4px 16px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{inline(b.replace(/^>\s?/gm, ''), key)}</blockquote>)
      return
    }
    if (/^(-|\d+\.)\s/.test(b)) {
      const ordered = /^\d+\./.test(b)
      const items = b.split('\n').map(l => l.replace(/^(-|\d+\.)\s*/, ''))
      const li = items.map((it, i) => <li key={`${key}-${i}`} style={{ margin: '6px 0', lineHeight: 1.65 }}>{inline(it, `${key}-${i}`)}</li>)
      out.push(ordered
        ? <ol key={key} style={{ paddingLeft: 24, color: 'var(--text-secondary)', fontSize: 15 }}>{li}</ol>
        : <ul key={key} style={{ paddingLeft: 24, color: 'var(--text-secondary)', fontSize: 15, listStyle: 'disc' }}>{li}</ul>)
      return
    }
    out.push(<p key={key} style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.75, margin: '14px 0' }}>{inline(b, key)}</p>)
  })
  return <>{out}</>
}
