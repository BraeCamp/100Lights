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
    result.push({
      id:    d.deviceId === 'default' ? 'mic' : d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'Default Microphone' : 'Microphone'),
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
    const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

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
        throw new Error('Screen sharing was cancelled. Computer audio rides along with a screen or tab share — pick one and check its audio option.')
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
