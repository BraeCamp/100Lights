/**
 * Modular audio input capture.
 * Returns a MediaStream for whichever source the user selects.
 * Reusable across tuner, voice MIDI, and any future feature that needs live audio.
 */

export type AudioInputSource = 'mic' | 'system'

export const AUDIO_INPUT_LABELS: Record<AudioInputSource, string> = {
  mic:    'Microphone',
  system: 'Computer Audio',
}

/**
 * Acquire a MediaStream from the selected input source.
 *
 * 'mic'    — getUserMedia with raw audio (no echo cancel, no AGC).
 * 'system' — getDisplayMedia with systemAudio: 'include'. The browser shows
 *             its own sharing picker; the user must choose a tab/window/screen
 *             AND check "Share system audio" (Chrome) or "Share audio" (Edge).
 *             Video tracks are discarded immediately after acquisition.
 *             Works even when the output volume is muted — the capture bypasses
 *             the OS output stage and reads directly from the application's
 *             audio graph.
 *
 * Throws a descriptive Error if the user denies permission or the browser
 * does not support the requested source.
 */
export async function captureAudioInput(source: AudioInputSource): Promise<MediaStream> {
  if (source === 'mic') {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  }

  // System audio via screen-capture API.
  // Chrome/Edge: audio.systemAudio = 'include' adds a checkbox in the picker.
  // Safari: audio is exposed without that extension — try both paths.
  const constraints = {
    audio: { systemAudio: 'include' } as MediaTrackConstraints,
    video: { width: 1, height: 1 } as MediaTrackConstraints,
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

  // Discard video — we only needed it to satisfy the API requirement
  stream.getVideoTracks().forEach(t => t.stop())

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach(t => t.stop())
    throw new Error(
      'No audio track captured. In the sharing dialog, make sure to check "Share system audio" (Chrome) or "Share audio" (Edge/Safari).'
    )
  }

  return stream
}
