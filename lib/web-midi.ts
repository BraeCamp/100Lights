/**
 * Web MIDI input — hardware keyboards and pad controllers.
 *
 * One shared MIDIAccess for the whole app. Every connected input is listened
 * to automatically (hot-plug included via statechange), and note-on/note-off
 * events fan out to subscribers. Chrome and Electron support the API;
 * elsewhere `supported` is false and everything is a no-op.
 */

export interface MidiNoteEvent {
  type: 'on' | 'off'
  pitch: number        // 0–127
  velocity: number     // 1–127 for 'on' (0-velocity note-on arrives as 'off')
  deviceName: string
}

type NoteListener = (e: MidiNoteEvent) => void
type DevicesListener = (names: string[]) => void

export const webMidiSupported =
  typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

let access: MIDIAccess | null = null
let starting: Promise<boolean> | null = null
const noteListeners = new Set<NoteListener>()
const deviceListeners = new Set<DevicesListener>()

function deviceNames(): string[] {
  if (!access) return []
  return [...access.inputs.values()].map(i => i.name || 'MIDI device')
}

function handleMessage(deviceName: string) {
  return (e: MIDIMessageEvent) => {
    const data = e.data
    if (!data || data.length < 3) return
    const status = data[0] & 0xf0
    const pitch = data[1]
    const velocity = data[2]
    if (status === 0x90 && velocity > 0) {
      for (const l of noteListeners) l({ type: 'on', pitch, velocity, deviceName })
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      for (const l of noteListeners) l({ type: 'off', pitch, velocity: 0, deviceName })
    }
  }
}

function wireInputs(): void {
  if (!access) return
  for (const input of access.inputs.values()) {
    // Assigning onmidimessage is idempotent — rewiring on every statechange is safe
    input.onmidimessage = handleMessage(input.name || 'MIDI device')
  }
  const names = deviceNames()
  for (const l of deviceListeners) l(names)
}

/** Start MIDI access (idempotent). Resolves false when unsupported or denied. */
export async function startWebMidi(): Promise<boolean> {
  if (!webMidiSupported) return false
  if (access) return true
  if (starting) return starting
  starting = navigator
    .requestMIDIAccess({ sysex: false })
    .then(a => {
      access = a
      a.onstatechange = () => wireInputs()
      wireInputs()
      return true
    })
    .catch(() => false)
    .finally(() => { starting = null })
  return starting
}

/** Subscribe to hardware note events. Returns an unsubscribe function. */
export function onMidiNote(listener: NoteListener): () => void {
  noteListeners.add(listener)
  return () => noteListeners.delete(listener)
}

/** Subscribe to the connected-device list (fires on hot-plug). */
export function onMidiDevices(listener: DevicesListener): () => void {
  deviceListeners.add(listener)
  if (access) listener(deviceNames())
  return () => deviceListeners.delete(listener)
}

export function getMidiDeviceNames(): string[] {
  return deviceNames()
}
