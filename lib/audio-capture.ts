/**
 * Modular audio input capture.
 * Returns a MediaStream for whichever source the user selects.
 * Reusable across tuner, voice MIDI, and any future feature that needs live audio.
 */

// 'system' = computer audio via getDisplayMedia
// 'mic'    = default microphone (legacy / fallback)
// any other string = a specific deviceId from enumerateDevices
export type AudioInputSource = 'mic' | 'system' | string

export const AUDIO_INPUT_LABELS: Record<string, string> = {
  mic:    'Microphone',
  system: 'Computer Audio',
}

export interface AudioDevice {
  id:    string   // 'mic' for default, 'system' for computer audio, or a raw deviceId
  label: string
  /** 'loopback' = a virtual device carrying what the computer is PLAYING. */
  kind?: 'microphone' | 'loopback'
}

// ── Capturing what the computer is playing, without sharing a screen ─────────
//
// A browser cannot record system audio. There is no API for it and that is
// deliberate: a page that could silently listen to everything you play would be
// a surveillance device. The only route the web platform offers is
// getDisplayMedia — the screen-share picker — because sharing audio is then
// something you visibly consented to.
//
// So "share computer audio without sharing my screen" cannot be solved by
// asking the browser differently. It is solved by giving the browser something
// that is already, legitimately, an INPUT device: a virtual loopback driver.
// BlackHole, Loopback, VB-Cable, Stereo Mix and PulseAudio monitor sources all
// do the same thing — they present whatever is playing as a microphone. Those
// appear in enumerateDevices like any other input, and getUserMedia takes them
// with no picker, no screen, and no video track ever being created.
//
// They were already showing up in our device list, as "BlackHole 2ch" sitting
// anonymously among the microphones, with nothing to say what it was or why you
// would pick it. Recognising them is the whole feature.
const LOOPBACK_PATTERNS: RegExp[] = [
  /blackhole/i,             // macOS, free, the common choice
  /loopback audio/i,        // Rogue Amoeba Loopback
  /soundflower/i,           // macOS, older
  /ishowu audio/i,          // macOS, shipped with iShowU
  /existential audio/i,     // BlackHole's vendor name on some systems
  /stereo mix/i,            // Windows, built into many drivers
  /what ?u ?hear/i,         // Windows, Creative cards
  /cable output/i,          // VB-Audio Virtual Cable
  /voicemeeter/i,           // VB-Audio Voicemeeter
  /virtual audio cable/i,   // Windows VAC
  /^monitor of /i,          // PulseAudio / PipeWire monitor source (Linux)
  /\bmonitor\b.*\b(sink|output|built-?in)\b/i,
]

/** Is this device label a virtual loopback rather than a real microphone? */
export function classifyAudioDevice(label: string): 'microphone' | 'loopback' {
  return LOOPBACK_PATTERNS.some(re => re.test(label)) ? 'loopback' : 'microphone'
}

/**
 * How computer audio will actually be captured on this machine, right now.
 *
 * The UI needs this BEFORE the user commits to anything, because the three
 * routes feel completely different — one is silent and instant, one throws up a
 * system picker — and a control that says only "Computer Audio" while sometimes
 * hijacking the screen is the thing being complained about.
 */
export type SystemAudioRoute =
  /** A loopback driver is installed: plain getUserMedia, no picker at all. */
  | { kind: 'loopback'; deviceId: string; deviceLabel: string }
  /** The desktop app captures OS audio directly, no picker. */
  | { kind: 'desktop-app' }
  /** Browser fallback: the screen-share picker, with audio riding along. */
  | { kind: 'screen-share'; tabAudioOnly: boolean }

export async function resolveSystemAudioRoute(): Promise<SystemAudioRoute> {
  if (typeof navigator === 'undefined') return { kind: 'screen-share', tabAudioOnly: false }
  if (typeof window !== 'undefined' && (window as Window & { electronAPI?: unknown }).electronAPI) {
    return { kind: 'desktop-app' }
  }
  const loop = await findLoopbackDevice()
  if (loop) return { kind: 'loopback', deviceId: loop.id, deviceLabel: loop.label }
  // Chrome on macOS can only attach audio to a TAB share; Windows and Linux can
  // also do the whole screen. Worth saying, because on a Mac choosing "Entire
  // Screen" silently produces no audio at all.
  return { kind: 'screen-share', tabAudioOnly: isMacPlatform() }
}

/** The first installed loopback device, if any. */
export async function findLoopbackDevice(): Promise<AudioDevice | null> {
  try {
    const devices = await listAudioInputDevices(false)
    // Labels are hidden until microphone permission has been granted once, so a
    // loopback device can be present and unnameable. Ask, then look again —
    // this is the difference between "you have no loopback" and "we can't read
    // its name yet", which are very different things to tell someone.
    const named = devices.some(d => d.label && !/^(default|microphone)$/i.test(d.label))
    const list = named ? devices : await listAudioInputDevices(true)
    return list.find(d => d.kind === 'loopback') ?? null
  } catch { return null }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /mac/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent)
}

/** What to tell someone who wants computer audio and has no loopback device. */
export function systemAudioSetup(): { title: string; steps: string[]; install?: string } {
  if (isMacPlatform()) {
    return {
      title: 'Capture computer audio without sharing your screen',
      install: 'brew install blackhole-2ch',
      steps: [
        'Install BlackHole — it is free and open source. Either run the command above, or download it from existential.audio/blackhole.',
        'Open Audio MIDI Setup (in Applications → Utilities).',
        'Click + at the bottom left → Create Multi-Output Device.',
        'Tick both your speakers and BlackHole 2ch, so you still HEAR what you are recording.',
        'Set that Multi-Output Device as your Mac’s sound output.',
        'Come back here and choose BlackHole as the input — no screen sharing from then on.',
      ],
    }
  }
  return {
    title: 'Capture computer audio without sharing your screen',
    steps: [
      'Open Sound settings → Recording.',
      'Right-click in the list and turn on “Show Disabled Devices”.',
      'If you see “Stereo Mix”, enable it — that is your computer’s own output as an input.',
      'No Stereo Mix? Install VB-Audio Virtual Cable (free) from vb-audio.com and set it as your output.',
      'Come back here and pick it as the input — no screen sharing from then on.',
    ],
  }
}

/**
 * Enumerate available audio input devices.
 * Pass requestPermission=true to briefly call getUserMedia so the browser
 * unlocks real device labels (otherwise labels may be empty strings).
 */
export async function listAudioInputDevices(requestPermission = true): Promise<AudioDevice[]> {
  if (requestPermission) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
    } catch { /* permission denied — labels may be generic */ }
  }

  const all = await navigator.mediaDevices.enumerateDevices()
  const seen = new Set<string>()
  const result: AudioDevice[] = []

  for (const d of all) {
    if (d.kind !== 'audioinput' || !d.deviceId || seen.has(d.deviceId)) continue
    seen.add(d.deviceId)
    const label = d.label || (d.deviceId === 'default' ? 'Default Microphone' : 'Microphone')
    result.push({
      id:    d.deviceId === 'default' ? 'mic' : d.deviceId,
      label,
      kind:  classifyAudioDevice(label),
    })
  }

  return result
}

/**
 * Acquire a MediaStream from the selected input source.
 *
 * 'system' — In Electron: getDisplayMedia intercepted by the main process
 *             (screen source + OS loopback audio) — no picker; works on
 *             Windows and macOS 13+. Legacy binaries fall back to the
 *             desktopCapturer path (audio on Windows only).
 *             In browsers: getDisplayMedia with guidance — macOS browsers can
 *             only capture tab audio; Windows can capture the whole screen.
 * 'mic'    — getUserMedia with the default device.
 * other    — getUserMedia with that exact deviceId.
 *
 * Throws a descriptive Error if the user denies permission or the browser
 * does not support the requested source.
 */
export async function captureAudioInput(source: string): Promise<MediaStream> {
  if (source === 'system') {
    type ElectronBridge = { getDesktopSources?: () => Promise<Array<{ id: string; name: string }>> }
    const electronAPI = (typeof window !== 'undefined' && (window as Window & { electronAPI?: ElectronBridge }).electronAPI) || null
    const isMac = isMacPlatform()

    // A loopback driver wins over everything else, including the desktop app's
    // OS capture: it is a plain input device, so there is no picker, no screen,
    // no video track, no permission dialog beyond the microphone one already
    // granted — and the audio is the bit-exact output rather than a re-capture.
    if (!electronAPI) {
      const loop = await findLoopbackDevice()
      if (loop) {
        return navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: loop.id },
            // Every one of these would damage a loopback signal. They exist to
            // stop a microphone hearing its own speakers; here the "echo" is
            // the actual material being recorded.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints,
        })
      }
    }

    if (electronAPI) {
      // Desktop app: getDisplayMedia is intercepted by the main process
      // (setDisplayMediaRequestHandler → screen source + OS loopback audio),
      // so no picker appears and real system audio comes back on Windows and
      // macOS 13+. Older binaries without the handler reject immediately —
      // fall through to the legacy chromeMediaSource path (audio on Windows).
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        stream.getVideoTracks().forEach(t => t.stop())
        if (stream.getAudioTracks().length > 0) return stream
        stream.getTracks().forEach(t => t.stop())
        throw new Error(
          isMac
            ? 'System audio unavailable. Allow Screen & System Audio Recording for 100Lights in System Settings → Privacy & Security, then restart the app. (Requires macOS 13 or later.)'
            : 'System audio unavailable. Check that another app isn’t exclusively holding the audio device.'
        )
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('System audio unavailable')) throw err
        // Old binary: no display-media handler — legacy desktopCapturer path
        if (!electronAPI.getDesktopSources) throw err
      }

      const sources = await electronAPI.getDesktopSources()
      const screen = sources[0]
      if (!screen) throw new Error('No screen source found for audio capture.')

      type DesktopConstraints = MediaTrackConstraints & { mandatory: Record<string, string | number> }
      const audioConstraint: DesktopConstraints = {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id },
      }
      const videoConstraint: DesktopConstraints = {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id, maxWidth: 1, maxHeight: 1 },
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        })
        stream.getVideoTracks().forEach(t => t.stop())
      }

      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(t => t.stop())
        throw new Error(
          isMac
            ? 'This version of the desktop app can’t capture system audio on macOS — update 100Lights to the latest version.'
            : 'System audio unavailable. On Windows, check that audio playback is active and try again.'
        )
      }

      return stream
    }

    // ── Browser path ─────────────────────────────────────────────────────────
    // Chrome on macOS can only deliver audio from a *tab* (“Also share tab
    // audio”); Windows Chrome/Edge can also do it for the entire screen.
    // Ask for a real video surface (a 1×1 request skews the picker), exclude
    // our own tab, and guide the user to the option that actually has audio.
    const constraints = {
      audio: {
        // Non-standard hints, safely ignored where unsupported
        systemAudio: 'include',
        suppressLocalAudioPlayback: false,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
      video: true as const,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    }

    let stream: MediaStream
    try {
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: typeof constraints): Promise<MediaStream>
      }).getDisplayMedia(constraints)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        throw new Error(
          isMac
            ? 'Screen sharing was cancelled. Browsers only hand over computer audio as part of a share — to skip that step entirely, install BlackHole (brew install blackhole-2ch) and pick it as your input.'
            : 'Screen sharing was cancelled. Browsers only hand over computer audio as part of a share — to skip that step entirely, enable Stereo Mix in your sound settings and pick it as your input.'
        )
      }
      throw err
    }

    stream.getVideoTracks().forEach(t => t.stop())

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop())
      throw new Error(
        isMac
          ? 'That share had no audio. On macOS, browsers can only capture audio from a tab: choose the “Chrome Tab” option in the picker, pick the tab that’s playing, and turn on “Also share tab audio”. To record audio from other apps, use the 100Lights desktop app.'
          : 'That share had no audio. Choose “Entire Screen” and enable “Also share system audio” (Chrome/Edge), or pick a tab with “Also share tab audio”.'
      )
    }

    return stream
  }

  // Microphone — specific device or default
  const deviceId = source === 'mic' ? undefined : source
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation:  false,
      noiseSuppression:  false,
      autoGainControl:   false,
      // ask for the smallest input buffering the platform allows — matters
      // for live monitoring, harmless elsewhere
      latency: 0,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    } as MediaTrackConstraints,
  })
}
