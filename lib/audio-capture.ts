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
 * 'system' — In Electron: desktopCapturer IPC → getUserMedia with
 *             chromeMediaSource:'desktop' — no screen picker shown.
 *             In browsers: getDisplayMedia fallback (requires sharing dialog).
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

    if (electronAPI?.getDesktopSources) {
      // Electron path: get screen source ID from main process, then capture
      // audio directly without showing any screen picker UI.
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

      // Try audio-only first (works in Electron 28+ / Chromium 116+).
      // Fall back to requesting a 1×1 video alongside audio and dropping it.
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
          'System audio unavailable. On macOS, allow Screen & System Audio Recording in System Settings > Privacy & Security.'
        )
      }

      return stream
    }

    // Browser fallback: getDisplayMedia (requires the screen sharing dialog)
    const constraints = {
      audio: { systemAudio: 'include' } as MediaTrackConstraints,
      video: { width: 1, height: 1 }   as MediaTrackConstraints,
    }

    let stream: MediaStream
    try {
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: typeof constraints): Promise<MediaStream>
      }).getDisplayMedia(constraints)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        throw new Error('Screen sharing was denied. Allow it to capture computer audio.')
      }
      throw err
    }

    stream.getVideoTracks().forEach(t => t.stop())

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop())
      throw new Error(
        'No audio track captured. In the sharing dialog, make sure to check "Share system audio" (Chrome) or "Share audio" (Edge/Safari).'
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
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  })
}
