// Interactive guided tours for the /apps mini-apps. Instead of a static "how-to"
// sheet, the shell (AppChrome) spotlights a real element on screen and coaches the
// user through the basics one step at a time — auto-playing the first time an app
// opens. Steps point at elements by a `data-tour="<key>"` attribute the app puts on
// the thing being highlighted; a step with no target shows a centered message.
//
// This is intentionally simple data so tours are quick to edit and reorder as the
// apps change. Add a slug's steps here + `data-tour` keys in that app's component.

export interface TourStep {
  /** data-tour key of the element to spotlight. Omit for a centered message. */
  target?: string
  /** Optional bold lead-in. */
  title?: string
  /** The coaching line shown at the bottom of the screen. */
  body: string
}

export const APP_TOURS: Record<string, TourStep[]> = {
  beatmaker: [
    { body: 'Welcome to Beat Maker — let’s build a beat in a few taps.' },
    { target: 'play', body: 'This plays your beat on a loop. Try Play to start your beat.' },
    { target: 'grid', body: 'Each row is a drum and each column is a step in the bar. Tap the squares to add or remove hits.' },
    { target: 'bpm', body: 'BPM is the tempo the beat plays at — higher is faster. Try changing it now.' },
    { target: 'kit', body: 'A kit changes the sound of every drum at once. Pick one you like.' },
    { target: 'pads-tab', body: 'The Pads tab lets you tap the drums live — arm Record and your taps become a sequence here.' },
    { target: 'bars', body: 'Need a longer beat? Add bars here, then duplicate a section to build it out.' },
    { target: 'save', body: 'When it sounds good, Save it — your beats wait for you in History. That’s the basics!' },
  ],
}

export const tourFor = (slug?: string): TourStep[] | null =>
  (slug && APP_TOURS[slug]) || null
