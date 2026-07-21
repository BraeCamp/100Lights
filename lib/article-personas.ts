// Editorial personas for the four article voices, plus small parsers the
// article page uses to build a table of contents and FAQ rich results.
//
// These are *voices/columns*, not fabricated people — the byline names the
// editorial angle a piece is written in (the same four voices the admin tools
// generate with), never a made-up human author with invented credentials.

import type { VoiceId } from './article-voice'
import { pickVoice } from './article-voice'

export interface Persona {
  label: string     // the voice/column name shown in the byline
  tagline: string   // what this voice does — truthful about the angle
  emoji: string     // monogram glyph (no fake headshots)
  from: string      // gradient start for the avatar
  to: string        // gradient end
}

export const PERSONAS: Record<VoiceId, Persona> = {
  heretic:   { label: 'The Heretic',   tagline: 'Takes away the advice you were taught, then rebuilds it', emoji: '🔥', from: '#f472b6', to: '#a855f7' },
  insider:   { label: 'The Insider',   tagline: 'How records actually get made, told slightly conspiratorially', emoji: '🎚️', from: '#38bdf8', to: '#3b82f6' },
  roast:     { label: 'The Deadpan Roast', tagline: 'Your own habits, described back to you — then fixed', emoji: '☕', from: '#fb923c', to: '#ea580c' },
  detective: { label: 'The Detective', tagline: 'An experiment first; the explanation only once your ears agree', emoji: '🔎', from: '#34d399', to: '#10b981' },
}

/** The persona for an article — its explicit `voice`, else inferred from the topic. */
export function articlePersona(a: { voice?: string; title: string; tags: string[] }): Persona {
  const v = (a.voice as VoiceId) && PERSONAS[a.voice as VoiceId] ? (a.voice as VoiceId) : pickVoice(a.title, a.tags)
  return PERSONAS[v] ?? PERSONAS.heretic
}

const slugify = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')

export interface Heading { id: string; text: string; level: 2 | 3 }

/** H2/H3 headings for the table of contents, matching the ids simple-markdown emits. */
export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/)
    if (m) out.push({ id: slugify(m[2]), text: m[2].replace(/[*_`]/g, ''), level: m[1].length as 2 | 3 })
  }
  return out
}

export interface Faq { q: string; a: string }

/** FAQ pairs from `@faq Question :: Answer` blocks, for rendering + FAQPage schema. */
export function extractFaq(body: string): Faq[] {
  const out: Faq[] = []
  for (const block of body.split(/\n{2,}/)) {
    const t = block.trim()
    if (!t.startsWith('@faq')) continue
    const rest = t.slice(4).trim()
    const i = rest.indexOf('::')
    if (i === -1) continue
    const q = rest.slice(0, i).trim()
    const a = rest.slice(i + 2).trim()
    if (q && a) out.push({ q, a })
  }
  return out
}
