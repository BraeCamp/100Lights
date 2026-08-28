// ============================================================================
//  The plug-ins 100Lights sells.
//
//  Kept as data rather than markup so the store page, the product page and
//  anything that needs a price all read from one place. Prices are in cents to
//  avoid the classic floating point rounding embarrassment at checkout.
// ============================================================================

export type PluginFormat = 'AU' | 'VST3' | 'CLAP' | 'Standalone'
export type PluginPlatform = 'macOS' | 'Windows'

export interface PluginDemo {
  /** Patch name, matching the factory bank. */
  name: string
  category: string
  /** Served from /demos/<file>. MP3: the WAVs are ~20x larger. */
  file: string
  blurb: string
}

export interface PluginProduct {
  slug: string
  name: string
  tagline: string
  /** One paragraph, the thing a buyer reads first. */
  summary: string
  version: string
  priceCents: number
  /** Shown struck through when set, for launch pricing. */
  compareAtCents?: number
  currency: 'usd'
  formats: PluginFormat[]
  platforms: PluginPlatform[]
  seats: number
  /** What the demo actually does, stated plainly rather than hidden. */
  demoTerms: string
  requirements: string[]
  highlights: Array<{ title: string; body: string }>
  demos: PluginDemo[]
  /** Set once the Stripe product exists; until then the button explains itself. */
  stripePriceId?: string
  /** Where the signed, notarized installer lives. The product page and the
   *  purchase email both read this, so they can never disagree. */
  downloadUrl?: string
  /** sha256 of the installer at downloadUrl. Publish it so a careful buyer can
   *  check what they downloaded is what we built. Must be updated together
   *  with downloadUrl — a stale checksum is worse than none, because it makes
   *  an honest file look tampered with. */
  checksum?: string
  available: boolean
}

export const LUZ: PluginProduct = {
  slug: 'luz',
  name: 'Luz',
  tagline: 'A synthesiser that listens',
  summary:
    'Play it from a keyboard, or plug a guitar, a bass or a microphone into your interface and Luz turns what you play into notes — for its own engine, and for everything else in your session. Three plug-ins, one engine.',
  version: '1.0.0',
  priceCents: 6900,
  currency: 'usd',
  formats: ['AU', 'VST3', 'CLAP', 'Standalone'],
  platforms: ['macOS'],
  seats: 3,
  demoTerms:
    'The demo is not time limited and nothing is disabled. Every feature works and your patches are yours to keep. The only difference is that the output dips for half a second every 45 seconds.',
  requirements: [
    'macOS 11 or later',
    'Apple silicon or Intel',
    'Any AU, VST3 or CLAP host — Logic, Ableton Live, Reaper, Bitwig, Cubase, Studio One, FL Studio',
    'Runs standalone too, no DAW required',
  ],
  highlights: [
    {
      title: 'Three plug-ins, one engine',
      body:
        'Luz is the instrument. Luz FX is the same engine as an audio effect, so it can hear your interface. Luz MIDI is the arpeggiator on its own, for driving whatever else is in your rack.',
    },
    {
      title: 'It turns playing into MIDI',
      body:
        'Put Luz FX on a guitar or vocal track and it tracks the pitch, plays its own voices from it, and hands your DAW real MIDI notes with pitch bend. Latency is reported to the host, so recorded notes land where you played them.',
    },
    {
      title: 'The Aurora engine',
      body:
        'Three oscillators per voice — analog, wavetable, FM, noise or live sampler — into two filters including a saturating ladder and a five-vowel formant. Three envelopes, three LFOs, a sixteen-slot modulation matrix, and MPE.',
    },
    {
      title: 'Effects worth using',
      body:
        'Drive, chorus through rotary, tempo-synced delay, and a feedback-network reverb with a shimmer mode. Then EQ, a compressor, and a lookahead limiter so a wild patch never spits at your master bus.',
    },
    {
      title: '363 automatable parameters',
      body:
        'Every control is a real host parameter with a stable ID, so a session that automates Filter 1 Cutoff today still automates it after an update.',
    },
    {
      title: 'It also runs in the browser',
      body:
        'The same engine, compiled to WebAssembly, is a Beacon plug-in. Sketch in the browser, finish in your DAW — identical DSP on both sides.',
    },
  ],
  demos: [
    { name: 'Round Bass', category: 'Bass', file: 'Round Bass.mp3',
      blurb: 'Ladder filter, sub oscillator, mono with legato glide.' },
    { name: 'Wide Saw Lead', category: 'Lead', file: 'Wide Saw Lead.mp3',
      blurb: 'Seven-voice unison, detuned symmetrically so it stays in tune.' },
    { name: 'Warm Pad', category: 'Pad', file: 'Warm Pad.mp3',
      blurb: 'Wavetable scanning under an ensemble, into a hall.' },
    { name: 'Tine Keys', category: 'Keys', file: 'Tine Keys.mp3',
      blurb: 'FM electric piano; velocity opens the index.' },
    { name: 'Glass Cathedral', category: 'Pad', file: 'Glass Cathedral.mp3',
      blurb: 'Shimmer reverb feeding an octave back into the tank.' },
    { name: 'Arp Music Box', category: 'Arp', file: 'Arp Music Box.mp3',
      blurb: 'Ratcheting arpeggiator with a velocity pattern.' },
  ],
  downloadUrl: 'https://pub-a048d0d7221c44e5936bf3fc9f55a0fe.r2.dev/Luz-1.0.0.pkg',
  checksum: '3592d4baba07bb446c31b2b14c48e0b39d6e0f5431830c0874b85ad128ab02e6',
  available: false,
}

export const PLUGINS: PluginProduct[] = [LUZ]

export function pluginBySlug(slug: string): PluginProduct | undefined {
  return PLUGINS.find(p => p.slug === slug)
}

export function formatPrice(cents: number, currency: 'usd' = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}
