// Interleaved 16-bit PCM WAV — universally playable in <audio>. Used by the
// real-mix bounce (32-bit float -> 16-bit) and by section slicing.
//
// The encoder moved to lib/wav-codec, which owns both bit depths; this name is
// kept because the song-video pipeline imports it.
export { encodeWavPcm16 as encodeWav16 } from '../wav-codec'
