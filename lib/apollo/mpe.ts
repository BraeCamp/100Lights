'use client'
// MPE input for Apollo: raw Web MIDI parsing with per-channel note-on/off,
// pitch bend (default MPE range ±48 semitones), and channel pressure.
// Not routed through lib/web-midi (which drops channel information).
//
// NOTE: implemented to the MPE spec but not yet verified against hardware.

import type { ApolloEngine } from '@/lib/apollo/engine-client'

const MPE_BEND_RANGE = 48

let access: MIDIAccess | null = null
let handlers: { input: MIDIInput; fn: (e: MIDIMessageEvent) => void }[] = []

export async function startMpe(engine: ApolloEngine): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) return false
  try {
    access = await navigator.requestMIDIAccess()
  } catch {
    return false
  }
  stopMpe()
  const fn = (e: MIDIMessageEvent) => {
    const d = e.data
    if (!d || d.length < 2) return
    const status = d[0] & 0xf0
    const ch = d[0] & 0x0f
    if (status === 0x90 && d[2] > 0) {
      void engine.node?.port.postMessage({ type: 'noteOn', note: d[1], vel: d[2] / 127, ch })
      engine.resume()
    } else if (status === 0x80 || (status === 0x90 && d[2] === 0)) {
      engine.node?.port.postMessage({ type: 'noteOff', note: d[1] })
    } else if (status === 0xe0) {
      const raw = (d[2] << 7) | d[1]
      engine.node?.port.postMessage({ type: 'chanBend', ch, semis: ((raw - 8192) / 8192) * MPE_BEND_RANGE })
    } else if (status === 0xd0) {
      engine.node?.port.postMessage({ type: 'chanPressure', ch, value: d[1] / 127 })
    } else if (status === 0xb0 && d[1] === 64) {
      engine.sustain(d[2] >= 64)
    }
  }
  for (const input of access.inputs.values()) {
    input.addEventListener('midimessage', fn)
    handlers.push({ input, fn })
  }
  return handlers.length > 0
}

export function stopMpe(): void {
  for (const h of handlers) h.input.removeEventListener('midimessage', h.fn)
  handlers = []
}
