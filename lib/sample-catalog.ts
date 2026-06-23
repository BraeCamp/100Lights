import type { LibraryCategory } from './sound-library'

export interface SampleEntry {
  id: string
  name: string
  category: LibraryCategory
  duration: number  // seconds (approximate)
  url: string       // served from /public/samples/100lights/ — add audio files there
}

// Place audio files in /public/samples/100lights/<filename>
// They are served at /samples/100lights/<filename> in the browser.
export const SAMPLE_CATALOG: SampleEntry[] = [
  // ── Kicks ──────────────────────────────────────────────────────────────────
  { id: 'kick-classic',  name: 'Classic Kick',   category: 'kick',        duration: 0.45, url: '/samples/100lights/kick-classic.wav'  },
  { id: 'kick-deep',     name: 'Deep Kick',       category: 'kick',        duration: 0.55, url: '/samples/100lights/kick-deep.wav'     },
  { id: 'kick-punchy',   name: 'Punchy Kick',     category: 'kick',        duration: 0.40, url: '/samples/100lights/kick-punchy.wav'   },

  // ── Snares ─────────────────────────────────────────────────────────────────
  { id: 'snare-crisp',   name: 'Crisp Snare',     category: 'snare',       duration: 0.30, url: '/samples/100lights/snare-crisp.wav'   },
  { id: 'snare-fat',     name: 'Fat Snare',        category: 'snare',       duration: 0.38, url: '/samples/100lights/snare-fat.wav'    },
  { id: 'snare-rimshot', name: 'Rimshot',          category: 'rim',         duration: 0.20, url: '/samples/100lights/snare-rimshot.wav'},

  // ── Hi-Hats ────────────────────────────────────────────────────────────────
  { id: 'hihat-tight',   name: 'Tight Hi-Hat',    category: 'hihat',       duration: 0.10, url: '/samples/100lights/hihat-tight.wav'  },
  { id: 'hihat-loose',   name: 'Loose Hi-Hat',    category: 'hihat',       duration: 0.18, url: '/samples/100lights/hihat-loose.wav'  },
  { id: 'hihat-open',    name: 'Open Hi-Hat',     category: 'open-hihat',  duration: 0.45, url: '/samples/100lights/hihat-open.wav'   },

  // ── Percussion ─────────────────────────────────────────────────────────────
  { id: 'clap-sharp',    name: 'Sharp Clap',      category: 'clap',        duration: 0.22, url: '/samples/100lights/clap-sharp.wav'   },
  { id: 'clap-room',     name: 'Room Clap',       category: 'clap',        duration: 0.30, url: '/samples/100lights/clap-room.wav'    },
  { id: 'tom-low',       name: 'Low Tom',         category: 'tom',         duration: 0.42, url: '/samples/100lights/tom-low.wav'      },
  { id: 'tom-high',      name: 'High Tom',        category: 'tom',         duration: 0.30, url: '/samples/100lights/tom-high.wav'     },
  { id: 'crash-soft',    name: 'Soft Crash',      category: 'crash',       duration: 1.20, url: '/samples/100lights/crash-soft.wav'   },

  // ── Instruments ────────────────────────────────────────────────────────────
  { id: 'guitar-clean',  name: 'Clean Guitar',    category: 'guitar-acoustic', duration: 1.5, url: '/samples/100lights/guitar-clean.wav' },
  { id: 'piano-note',    name: 'Grand Piano C4',  category: 'piano-grand',     duration: 2.0, url: '/samples/100lights/piano-c4.wav'     },
  { id: 'synth-lead-1',  name: 'Lead Synth',      category: 'synth-lead',      duration: 1.0, url: '/samples/100lights/synth-lead.wav'   },
  { id: 'synth-bass-1',  name: 'Bass Synth',      category: 'synth-bass',      duration: 0.8, url: '/samples/100lights/synth-bass.wav'   },
]

// IndexedDB entry id for a catalog sample
export function catalogEntryId(sampleId: string): string {
  return `100l_${sampleId}`
}
