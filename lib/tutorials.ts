// Feature tutorials — the single source of truth for /tutorial/[slug].
//
// Each tutorial's steps drive THREE things so they can never drift apart:
//   1. the illustrated page (app/tutorial/[slug]/page.tsx) — text + a generated
//      red-circled screenshot per step (public/tutorial/<slug>/<n>.png),
//   2. the live "Do it in the studio" mode (components/editor/StudioGuide.tsx) —
//      which glows each step's control via the Help system, and
//   3. the capture script (scripts/capture-tutorials.mjs) — which knows, from a
//      step's helpId, which control to photograph.
//
// A step's `helpId` is a data-help-id present in the editor (see the registry in
// components/editor/daw/HelpButton.tsx). Steps without a helpId are text-only
// (no screenshot, no glow). To add a tutorial: add an entry here, add a driver
// for its slug in scripts/capture-tutorials.mjs, then `npm run capture-tutorials`.

export interface TutorialStep {
  text: string
  /** data-help-id of the control this step points at. Omit for a text-only step. */
  helpId?: string
}

export interface Tutorial {
  slug: string
  title: string
  description: string
  /** One-line summary — index card + page subtitle. */
  tagline: string
  steps: TutorialStep[]
}

export const TUTORIALS: Tutorial[] = [
  {
    slug: 'fx',
    title: 'Add and Use an Effect',
    description: 'Add an effect to a track in the 100Lights studio, then use Bypass to hear it on versus off — the fastest way to learn what any effect actually does.',
    tagline: 'Put an effect on a track and A/B it by ear.',
    steps: [
      { text: 'Add a track to hold your sound. Every effect lives on a track, so you need one first.', helpId: 'add-track' },
      { text: "Open that track's devices with its gear (⚙) button. This is where effects stack up in a chain.", helpId: 'track-settings' },
      { text: 'Add an effect to the chain, and pick one — try an EQ, a reverb, or a compressor.', helpId: 'add-device' },
      { text: 'Now play the track and toggle the effect’s Bypass on and off. That instant before-and-after is how you learn what an effect really does — the same blind-test idea, on your own sound.' },
    ],
  },
]

export function getTutorial(slug: string): Tutorial | undefined {
  return TUTORIALS.find(t => t.slug === slug)
}

/** Public path of a step's generated screenshot (1-based file naming). */
export function stepImagePath(slug: string, stepIndex: number): string {
  return `/tutorial/${slug}/${stepIndex + 1}.png`
}
