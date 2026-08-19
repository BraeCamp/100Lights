// Registry of standalone, shareable "play" experiences at /play/<slug> — the
// interactable link-in-bio pieces for social. Each is a full-screen, phone-first
// mini-game that ends with a "make your own →" push to the product. Self-
// contained (no account) and OG-rich so a pasted link previews well.
//
// Single source of truth: add an experience here and the /play/<slug> route,
// the /play index, and the OG cards all pick it up.

import type { ComponentType } from 'react'

export interface PlayExperience {
  slug: string
  /** The hook — big, first thing you see. */
  title: string
  /** One-line sub under the title. */
  tagline: string
  /** Meta/OG description. */
  description: string
  emoji: string
  /** Where "make your own" sends people (a UTM is appended per-slug). */
  ctaHref: string
  ctaLabel: string
  load: () => Promise<{ default: ComponentType<Record<string, unknown>> }>
}

const L = (fn: () => Promise<{ default: ComponentType<never> }>) =>
  fn as unknown as () => Promise<{ default: ComponentType<Record<string, unknown>> }>

export const PLAY_EXPERIENCES: PlayExperience[] = [
  {
    slug: 'guess-the-genre',
    title: 'Same four chords. Guess the genre.',
    tagline: 'One progression — C, G, Am, F — played five ways. Can your ear name each one?',
    description: 'The same four chords in five genres. Listen and guess — pop, neo-soul, cinematic, blues, or electronic. The chords never change; only the arrangement does.',
    emoji: '🎧',
    ctaHref: '/create',
    ctaLabel: 'Make your own →',
    load: L(() => import('@/components/play/PlayGuessGenre')),
  },
  {
    slug: 'hear-the-difference',
    title: 'Can you hear the difference?',
    tagline: 'Two clips, one tiny change. Trust your ears and pick the treated one.',
    description: 'A blind listening test. Same beat, one production move applied to one version. Can you hear which? Trains the ear the only way that works.',
    emoji: '👂',
    ctaHref: '/create',
    ctaLabel: 'Try it yourself →',
    load: L(() => import('@/components/play/PlayHearDifference')),
  },
  {
    slug: 'build-a-beat',
    title: 'Make a beat in ten seconds.',
    tagline: 'Tap the squares. Hit play. That is a drum machine — in a web page.',
    description: 'A tiny drum machine. Tap squares to place kick, snare, and hats, then press play. No download, no account — this is what making music in the browser feels like.',
    emoji: '🥁',
    ctaHref: '/create',
    ctaLabel: 'Build the full thing →',
    load: L(() => import('@/components/play/PlayBuildABeat')),
  },
]

export const playBySlug = (slug: string): PlayExperience | undefined =>
  PLAY_EXPERIENCES.find(e => e.slug === slug)

/** The product link with a per-experience UTM so social traffic is trackable. */
export const playCtaHref = (e: PlayExperience): string => {
  const sep = e.ctaHref.includes('?') ? '&' : '?'
  return `${e.ctaHref}${sep}utm_source=play&utm_medium=bio&utm_campaign=${e.slug}`
}
