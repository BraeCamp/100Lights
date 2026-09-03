// The one sample rate every offline render uses.
//
// Brae: "Let's see what we can do to make sure that the song never sounds
// different on another machine."
//
// ⚠️ THIS WAS THE HOLE. `ApolloEngine.renderToBuffer` rendered at
// `this.ctx?.sampleRate` — the DEVICE's rate. A laptop running its audio at
// 44.1 kHz and one at 48 kHz produced genuinely different audio for the same
// song, and `freezeStamp` (notes + patch + tempo) did not mention the rate, so
// those two renders shared a cache key. Locally that means a song can sound
// different on your desktop app than in your browser. With server loading it is
// worse: one machine's render is served to another and nothing can tell them
// apart.
//
// There were three policies at once — device rate in the engine, a hardcoded
// 48000 in the freeze cache's allocator, and a hardcoded 44100 in the
// song-video renderer. Three answers to a question that has exactly one.
//
// 48 kHz because it is what most hardware and most browsers actually run at, so
// the common case needs no resampling at all.
//
// ⚠️ A render at this rate played on a device running some other rate is
// resampled by WebAudio on playback. That is fine and it is the point: the
// resampling is a local, transient artifact of the output device, where the
// RENDER — the thing we cache, share and ship — is identical everywhere.
export const RENDER_SAMPLE_RATE = 48_000
