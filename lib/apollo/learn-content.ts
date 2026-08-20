// Learn-mode knowledge base for Apollo. Every control and every synthesis
// concept gets an entry: `short` is the hover blurb, `body` the detail card.
// [[term]] (or [[term|shown text]]) in a body renders as a highlighted link
// that opens that entry in a NEW card on top of the current one — so a user
// can chain from "Cutoff" → "filter" → "resonance" without losing their place.
//
// Matching: controls are identified by their data-learn attribute / label /
// title text, normalized (lowercased, numbers stripped: "Filter 1" → filter).

export interface LearnEntry {
  key: string
  title: string
  short: string
  body: string
  aliases?: string[]
}

const E = (key: string, title: string, short: string, body: string, aliases: string[] = []): LearnEntry =>
  ({ key, title, short, body, aliases })

export const LEARN_ENTRIES: LearnEntry[] = [
  // ── Concepts (glossary — mostly reached through highlighted links) ─────────
  E('synth', 'Synthesizer', 'An instrument that generates sound electronically.',
    'Apollo is a synthesizer: it builds sound from scratch (or from a sample you give it) instead of playing back recordings. The signal starts at the [[oscillator]]s, passes through [[filter]]s that shape its tone, is contoured by [[envelope]]s, animated by [[lfo|LFOs]] and the [[modulation]] system, then polished by the effects rack.'),
  E('oscillator', 'Oscillator', 'The sound source — where a note’s raw tone is generated.',
    'An oscillator generates the raw waveform of your sound. Apollo has three (A, B and C), and each can run a different engine: [[wavetable]] (morphing digital waveforms), sample (a recording you load), multisample (a full instrument with one recording per range of keys), [[granular]] (a cloud of tiny sample slices) or [[spectral]] (resynthesizing a sound from its frequency analysis). Layering two or three oscillators is how big, complex tones are made.', ['osc', 'osc a', 'osc b', 'osc c', 'oscillators']),
  E('wavetable', 'Wavetable', 'A stack of single-cycle waveforms you can morph between.',
    'A wavetable is a series of tiny one-cycle waveforms lined up in a row (the frames). The [[wt-pos|Position]] control chooses which frame plays — sweep it and the tone morphs smoothly from one shape to the next. Modulating position with an [[lfo|LFO]] or [[envelope]] is the signature "moving" wavetable sound. You can draw and edit your own tables in the WT Editor.'),
  E('sample', 'Sample', 'A recorded sound used as an oscillator’s source.',
    'A sample is any piece of recorded audio. In the sample engine, the recording is pitched up and down across the keyboard (unless Const Pitch is on). Load one from your Sound Library or drop in an audio file — then filter, stretch, loop, slice and modulate it like any synthesized tone.'),
  E('granular', 'Granular synthesis', 'Rebuilds a sound from tiny overlapping slices called grains.',
    'Granular synthesis chops a [[sample]] into tiny pieces (grains, often 20–200 ms), then plays dozens of them overlapping. Because the grains are independent, you can freeze time, stretch a sound without changing pitch, scatter grains randomly for texture, or scrub through the sample by hand. Density = how many grains per second; Length = each grain’s size; Spray = random position scatter.'),
  E('spectral', 'Spectral synthesis', 'Plays a sound from its frequency analysis instead of its waveform.',
    'The spectral engine analyzes a [[sample]] into hundreds of frequency bands (a spectrogram), then resynthesizes it from that analysis. Since time and pitch are separated, you can freeze a single instant forever, play the sound at 5% speed with no pitch change, shift [[formant]]s, blur the spectrum (Smear), or gate out quiet partials for a glassy effect.'),
  E('filter', 'Filter', 'Removes or emphasizes frequencies to shape the tone.',
    'A filter sculpts the tone by cutting some frequencies and keeping others. A low-pass filter (LP) removes highs and makes things darker/warmer; high-pass (HP) removes lows; band-pass (BP) keeps only a middle band; notch removes a band. The [[cutoff]] sets where it acts and [[resonance]] adds emphasis right at that point. Sweeping cutoff with an [[envelope]] or [[lfo|LFO]] is the most important move in subtractive synthesis.', ['filters', 'filter 1', 'filter 2']),
  E('cutoff', 'Cutoff', 'The frequency where the filter starts working.',
    'Cutoff is the corner frequency of the [[filter]]. On a low-pass filter, everything above the cutoff is progressively removed — turn it down for dark and muffled, up for bright and open. It is the most-modulated destination in synthesis: route an [[envelope]] to it for plucks that open and close, or an [[lfo|LFO]] for wobble.'),
  E('resonance', 'Resonance', 'A peak of emphasis right at the cutoff frequency.',
    'Resonance (Res) boosts a narrow band right at the [[cutoff]], making the filter "sing". A little adds presence and character; a lot produces a whistling peak, and on many analog-style filters extreme resonance self-oscillates into a pure tone. Resonant sweeps are the classic acid/squelch sound.', ['res']),
  E('envelope', 'Envelope', 'A one-shot shape triggered by each note — how the sound evolves over time.',
    'An envelope is a control shape that runs once per note: [[attack]] (fade-in time), Hold, [[decay]] (fall time), [[sustain]] (held level) and [[release]] (fade-out after you let go) — ADSR. Env 1 always controls loudness; Env 2–4 are free to modulate anything via the [[matrix|mod matrix]] — most classically, filter [[cutoff]].', ['env', 'envelopes', 'env 1', 'env 2', 'env 3', 'env 4', 'adsr']),
  E('attack', 'Attack', 'How long the sound takes to fade in when a key is pressed.',
    'Attack is the first stage of an [[envelope]]: the time from key-down to full level. Instant attack (≈2 ms) gives plucks and percussion; long attacks (0.5 s+) give pads and swells that bloom in.'),
  E('decay', 'Decay', 'How fast the sound falls from its peak to the sustain level.',
    'Decay is the [[envelope]] stage after [[attack]]: the fall from maximum to the [[sustain]] level. With sustain at zero, decay alone defines the length of a pluck.'),
  E('sustain', 'Sustain', 'The level held for as long as the key stays down.',
    'Sustain is a LEVEL, not a time: where the [[envelope]] rests while you hold the key. Full sustain = organ-like held notes; zero sustain = the sound dies away even while held (plucks, keys, mallets).'),
  E('release', 'Release', 'How long the sound rings out after the key is let go.',
    'Release is the fade-out time after key-up. Short = tight and dry; long = notes overlap and smear together like a pedaled piano. Long releases eat [[polyphony]] — each ringing tail still occupies a voice.'),
  E('lfo', 'LFO', 'A repeating shape that wiggles parameters automatically.',
    'A Low-Frequency Oscillator is like an invisible hand turning a knob in a loop. Route it (drag its chip onto any knob, or add a row in the [[matrix]]) to make vibrato (LFO → pitch), wobble (LFO → [[cutoff]]), tremolo (LFO → volume) or motion (LFO → [[wt-pos|wavetable position]]). Apollo’s LFOs are drawable — click the grid to shape your own curve — and can [[bpm-sync|sync to tempo]]. Chaos mode replaces the loop with never-repeating math; Path mode outputs X and Y at once.', ['lfos', 'lfo 1', 'lfo 2', 'lfo 3']),
  E('modulation', 'Modulation', 'One thing automatically controlling another.',
    'Modulation means using a moving source ([[lfo|LFO]], [[envelope]], [[velocity]], [[macro]], mod wheel…) to control a parameter instead of your hand. It is what makes a patch feel alive. In Apollo: drag a source chip from the MOD SOURCES strip onto any knob, or build routes in the [[matrix|mod matrix]]. Modulated knobs show a colored ring — drag the ring itself to adjust the amount.'),
  E('matrix', 'Mod Matrix', 'The patchbay listing every modulation connection.',
    'The mod matrix is a table of [[modulation]] routes: each row says SOURCE (what moves) → DEST (what it moves) with an AMOUNT. Bipolar makes it push both directions; Aux scales one route by a second source (e.g. mod wheel controls vibrato depth); Curve reshapes the response. Everything you drag-and-drop onto knobs shows up here too.', ['mod matrix', '+add', 'add route']),
  E('macro', 'Macro', 'One big knob that turns many small ones.',
    'A macro is a user-assignable super-knob: route it to several destinations in the [[matrix]] and one twist changes them all — e.g. a "Brightness" macro that opens the [[cutoff]], adds [[unison]] width and raises reverb mix together. Presets use the 8 macros as their main performance controls.', ['macros', 'macro 1', 'macro 2']),
  E('unison', 'Unison', 'Stacks detuned copies of the oscillator for a thick sound.',
    'Unison plays several slightly-[[detune|detuned]] copies of the same oscillator at once. 1 voice = clean and focused; 7 = the huge super-saw sound of trance and EDM. Width spreads the copies across the stereo field; Blend balances the center voice against the detuned ones.'),
  E('detune', 'Detune', 'How far apart the unison voices drift in pitch.',
    'Detune sets the pitch spread between [[unison]] voices. Tiny amounts (a few cents) give gentle chorus-like shimmer; large amounts get grainy and aggressive. A cent is 1/100 of a [[semitone]].'),
  E('semitone', 'Semitone & cent', 'The steps of pitch: 12 semitones per octave, 100 cents per semitone.',
    'A semitone is the distance between two adjacent piano keys; twelve of them make an octave (a doubling of frequency). A cent is 1/100 of a semitone — used for fine tuning. Osc pitch controls: Octave (±12 st jumps), Semi (single steps), Fine (cents).', ['semi', 'fine', 'octave', 'cents']),
  E('fm', 'FM (frequency modulation)', 'One oscillator wobbles another’s pitch at audio speed — creating new tones.',
    'When the modulating signal is fast enough (audio rate), wiggling an oscillator’s frequency stops sounding like vibrato and creates entirely new frequencies — bells, electric pianos, metallic basses. In Apollo each oscillator can be FM’d by another (choose the source, turn up the amount in the Warp section). A muted oscillator still works as a silent modulator.', ['fm source', 'fm amt', 'fm amount']),
  E('warp', 'Warp', 'Real-time distortion of the oscillator’s waveform shape.',
    'Warp bends the waveform itself before anything else happens: Sync mimics hard-syncing to a faster oscillator, PWM narrows pulses, Bend/Asym/Mirror/Squeeze reshape the cycle, Saturate thickens it, and FM/PD/AM/RM modes use another oscillator as the modifier. Two warps can stack. Small amounts change character; large amounts change species.', ['warp 1', 'warp 2']),
  E('wt-pos', 'Wavetable Position', 'Which frame of the wavetable is playing.',
    'Position scans through the [[wavetable]]’s frames. Static, it is a tone selector; modulated by an [[envelope]] or [[lfo|LFO]] it becomes the moving, evolving timbre wavetable synths are famous for. The yellow frame in the 3D stack is the one you’re hearing.', ['wt pos', 'pos', 'position']),
  E('sub', 'Sub oscillator', 'A simple low oscillator that adds solid bass under the main sound.',
    'The sub is a clean, simple waveform (usually a sine) pitched an octave or two below the main oscillators. It adds weight and low-end you can feel without muddying the character. "Direct" bypasses the [[filter]]s so the bass stays full even when the filter closes.'),
  E('noise', 'Noise', 'An unpitched sound layer — breath, hiss, snap, texture.',
    'The noise generator plays an unpitched sample (hiss, crackle, air). A short one-shot of noise glued to the [[attack]] of a note gives it a physical "chiff" (like a hammer or pick); sustained noise adds breath and texture. Keytrack makes its color follow the keyboard.'),
  E('velocity', 'Velocity', 'How hard you hit the key (1–127).',
    'Velocity is the strike strength your keyboard sends with each note. By default it scales loudness; route it in the [[matrix]] to [[cutoff]] so harder playing is also brighter — the single best trick for making a patch feel expressive.'),
  E('polyphony', 'Polyphony', 'How many notes can sound at once.',
    'Polyphony is the number of simultaneous [[voice]]s. When you exceed it, the engine steals the oldest/most-finished voice to make room. Long [[release]] tails count — 8 held notes with long releases can occupy far more voices than 8.', ['poly']),
  E('voice', 'Voice', 'One playing note — its own oscillators, filters and envelopes.',
    'Each note you play gets a voice: a private copy of the [[oscillator]]s, [[filter]]s and [[envelope]]s. Voices are expensive (a 7-[[unison]] osc renders 7 waveforms per voice), which is why [[polyphony]] is capped.'),
  E('glide', 'Glide (portamento)', 'Notes slide smoothly into each other instead of jumping.',
    'Glide (portamento) makes pitch travel from the previous note to the new one over time instead of changing instantly — the classic 303/lead slide. "Legato only" glides only when notes overlap, so detached playing stays in tune.', ['portamento', 'glide legato']),
  E('mono', 'Mono / Legato mode', 'One note at a time, like a solo instrument.',
    'Mono mode allows a single [[voice]]: new notes cut the previous one, and releasing a key falls back to the one still held — great for basses and leads. Legato is mono without retriggering the [[envelope]]s when notes overlap, so phrases connect smoothly. Poly is the normal many-notes mode.', ['legato', 'poly mode', 'mode']),
  E('pitch-bend', 'Pitch bend', 'The wheel that bends notes up or down.',
    'The pitch wheel bends every sounding note smoothly. PB Range sets how far full deflection goes, in [[semitone]]s — 2 is standard, 12 lets you bend a whole octave.', ['pb range', 'pitch bend range']),
  E('mpe', 'MPE', 'Per-finger expression from controllers like Seaboard or LinnStrument.',
    'MIDI Polyphonic Expression puts each note on its own MIDI channel so every finger gets independent pitch slide and pressure. With an MPE controller connected, enable the MPE button and each note responds to its own bend (±48 st) and [[aftertouch]].'),
  E('aftertouch', 'Aftertouch', 'Pressure on a key after it’s already down.',
    'Aftertouch is the pressure signal a keyboard sends while you lean into a held key. Route it in the [[matrix]] to vibrato depth, [[cutoff]] or volume for expressive swells without touching a knob.'),
  E('bpm-sync', 'BPM sync', 'Locks a time-based control to the song tempo.',
    'When sync is on, rates are set in musical divisions (1/4, 1/8, 1/16…) instead of Hz or ms, and follow the project tempo. Synced [[lfo|LFOs]], delays and the [[arp]] stay locked to the beat even when the tempo changes.', ['sync']),
  E('swing', 'Swing', 'Delays every off-beat for a shuffled, human groove.',
    'Swing pushes each even-numbered step slightly late, turning a rigid grid into a shuffle. Subtle (10–20%) = groove; heavy (50%+) = triplet feel.'),
  E('midi', 'MIDI', 'The language keyboards and controllers use to talk to instruments.',
    'MIDI carries notes ([[velocity]], pitch), knob movements ([[cc|CC messages]]), pedal and wheel data from your hardware into Apollo. Click the MIDI button to connect a keyboard; right-click any knob to MIDI-Learn a hardware control onto it.'),
  E('cc', 'MIDI CC', 'A numbered control message — knobs, pedals, mod wheel.',
    'Control Change messages are the numbered knob signals of [[midi|MIDI]] (CC1 = mod wheel, CC64 = [[sustain-pedal|sustain pedal]]). Right-click any Apollo knob → MIDI Learn, twist a hardware knob, and that CC drives the knob from then on.', ['midi learn', 'midi cc']),
  E('sustain-pedal', 'Sustain pedal', 'Holds notes after the keys are released.',
    'The sustain pedal (CC64) keeps notes ringing after key-up, exactly like a piano’s damper pedal. Releases only happen once the pedal comes up.'),
  E('oversampling', 'Oversampling', 'Rendering at a higher sample rate internally for cleaner highs.',
    'Digital oscillators can alias — spraying harsh, out-of-tune frequencies — when their harmonics exceed what the sample rate can represent. High quality mode renders everything at 2× the rate and filters back down, removing most aliasing at some CPU cost. Draft does the opposite: cheaper rendering for weak devices.', ['quality', 'draft', 'high']),
  E('feedback', 'Feedback', 'Sending an effect’s output back into its input.',
    'Feedback loops a portion of the output back to the input. In a delay it creates repeating echoes (more feedback = more repeats); in a flanger or comb filter it sharpens the resonant peaks; at 100% things ring forever or run away.'),
  E('wet-dry', 'Mix (wet/dry)', 'Balance between the processed and untouched signal.',
    'Every effect’s Mix knob blends the dry (original) signal with the wet (processed) one. 0% = effect bypassed, 100% = only the effect. Parallel character — like huge reverb behind a still-punchy dry note — lives in the middle.', ['mix']),
  E('stereo-width', 'Stereo width', 'How far the sound spreads between the speakers.',
    'Width controls the spread between left and right channels. 0 = mono (safe, focused, great for bass), 100% = natural stereo, beyond = exaggerated space (check it in mono — extreme width can cancel out).', ['width']),
  E('root-key', 'Root key', 'The key at which a sample plays back unchanged.',
    'The root key tells the engine which note the recording IS. Play the root and you hear the sample at its original pitch; other keys transpose it relative to that. Wrong root = whole keyboard out of tune.', ['root']),
  E('formant', 'Formant', 'The fixed resonances that give a sound its vowel/body character.',
    'Formants are resonant peaks that stay put regardless of pitch — they’re why your voice sounds like you whether you sing high or low. Shifting formants up gives "chipmunk", down gives "giant", without changing the note. The formant filter shapes sound into vowels (A/E/I/O/U).', ['vowel']),
  E('voice-stealing', 'Voice stealing', 'Recycling the oldest note to make room for a new one.',
    'When every [[voice]] is busy and you play another note, the engine silently ends the oldest or most-faded voice and reuses it. Good stealing is inaudible; the alternative would be new notes refusing to play.'),
  E('limiter', 'Limiter', 'A ceiling that stops the output from clipping.',
    'Apollo’s master limiter watches the final output and instantly ducks anything that would exceed the ceiling, so ten-note chords stay loud-but-clean instead of harshly clipping your speakers. Transparent below the ceiling.'),

  // ── Header / global controls ────────────────────────────────────────────
  E('tab-osc', 'OSC tab', 'The sound-design page: oscillators, filters, envelopes, LFOs.',
    'The main synthesis page. Left column: the three [[oscillator]]s, [[sub]]/[[noise]], and the [[filter]]s. Right: [[envelope]]s, [[lfo|LFOs]], [[macro]]s and the scope.', ['osc tab']),
  E('tab-mix', 'MIX tab', 'Levels and routing for every sound source.',
    'The mixer page: per-source levels and pans, which [[filter]] each source feeds, and which FX bus everything lands on.', ['mix tab']),
  E('tab-fx', 'FX tab', 'The effects rack — the polish chain.',
    'The effects page: up to three lanes (Main + two [[bus|busses]]) of chained effects — reverb, delay, distortion, compression and more. Order matters: distortion before reverb sounds different than after.', ['fx tab', 'fx']),
  E('tab-matrix', 'MATRIX tab', 'Every modulation route in one table.',
    'The [[matrix|mod matrix]] page — see, edit and add every [[modulation]] connection, plus the [[macro]] knobs and extra [[envelope]]/[[lfo|LFO]] panels for editing while you route.', ['matrix tab']),
  E('tab-seq', 'SEQ tab', 'Arpeggiator and clip sequencer.',
    'The performance page: the [[arp|arpeggiator]] turns held chords into patterns; the clip sequencer plays back short phrases you draw, right inside the synth.', ['seq tab', 'seq']),
  E('tab-global', 'GLOBAL tab', 'Voicing, tuning and engine settings.',
    'Engine-wide settings: [[polyphony]], [[mono|voice mode]], [[glide]], [[pitch-bend|bend range]], [[oversampling|quality]], scale lock and [[tuning|microtuning]].', ['global tab', 'global']),
  E('preset', 'Presets', 'Saved sounds — browse with the arrows, save your own.',
    'A preset is a complete saved patch: every knob, route and effect. Browse factory and saved sounds with the ◀ ▶ arrows, type a name and Save to keep your own, or Share to publish it (with an audio preview) to the Community.', ['presets', 'save', 'preset name']),
  E('init', 'Init', 'Resets the synth to a clean starting patch.',
    'Init(ialize) wipes the current sound back to a simple single-oscillator starting point — the blank canvas for designing from scratch. Your previous state stays in undo.'),
  E('randomize', 'Random', 'Rolls dice on the core parameters for a surprise patch.',
    'Randomize generates a fresh sound by rolling the oscillator, [[filter]], [[envelope]] and FX settings within musical limits. Great for inspiration — roll until something sparks, then refine it.', ['random']),
  E('mutate', 'Mutate', 'Small random nudges to the current sound.',
    'Mutate keeps your patch’s identity but nudges several parameters slightly — like breeding variations. Repeated mutations drift further from home.'),
  E('bounce', 'Bounce', 'Renders the current sound to audio — into your library or a WAV file.',
    'Bounce plays the patch (a note, or the active clip) through an offline render and saves the result: into your 100Lights Sound Library (usable in the studio) or as a downloadable WAV. If you opened a library sound in Apollo, Bounce can also Replace the original in place.', ['⭳ bounce']),
  E('share', 'Share', 'Publishes this patch to the Community with an audio preview.',
    'Share renders a short preview of your patch and posts it to the 100Lights Community — anyone can listen, and one click installs it into their own Apollo.'),
  E('ab', 'A/B compare', 'Two slots for flipping between versions of a sound.',
    'A/B keeps two versions of the patch in memory. Tweak on A, flip to B to compare, copy one into the other when you’ve decided. Essential for honest "is this better?" checks.', ['a/b', 'a', 'b']),
  E('undo', 'Undo / Redo', 'Steps backward and forward through your edits.',
    'Every structural change is recorded — ↩ (Cmd+Z) steps back, ↪ (Shift+Cmd+Z) forward. Fearless sound design: nothing is ever lost.', ['↩', '↪', 'redo']),
  E('wt-editor', 'WT Editor', 'Draw and edit your own wavetables.',
    'The wavetable editor lets you draw waveforms by hand, generate them from math formulas, or import audio — then saves the result as a [[wavetable]] your oscillators can morph through. Export as a standard .wav that other synths read too.', ['wt editor']),
  E('skin', 'Skin', 'Alternate looks for the same synth.',
    'Skins swap Apollo’s visual shell — same engine, same sound, different look. Experimental designs live under Amber Console, Porcelain and Neon Grid.'),
  E('midi-btn', 'MIDI button', 'Connects your hardware keyboard.',
    'Click to connect [[midi|MIDI]] keyboards and controllers plugged into your computer. Once lit, play notes on hardware; right-click knobs to map hardware controls to them.', ['midi']),
  E('main', 'Main', 'The master output volume.',
    'The final volume after everything else. The bar next to it is the output meter; Apollo’s [[limiter]] sits at the very end so heavy chords can’t clip.', ['master', 'main volume', 'mastergain']),
  E('learn', 'Learn mode', 'You’re using it! Hover to identify, click to read.',
    'Learn mode turns the cursor into a magnifying glass: hover anything to see what it is, click it to read the full story (the control does NOT activate). Highlighted words open further cards. Click the Learn button again (or press Esc) to go back to playing.', ['?', 'learn mode']),

  // ── Oscillator panel controls ───────────────────────────────────────────
  E('spec-warp', 'Spectral warp', 'Reshapes the frame’s harmonics directly — stretch, shift, smear.',
    'Unlike the time-domain [[warp]]s, spectral warp operates on the [[wavetable]] frame’s harmonics themselves: Stretch spreads them apart (inharmonic, bell-like), Shift slides the whole spectrum, Smear blurs it, Spec LP removes highs surgically, Even/Odd tilts the tone hollow, Inharmonic scatters partials. The Amount is modulatable — sweep it with an [[lfo|LFO]] for evolving harmonic motion.', ['spectral warp — reshapes the frame’s harmonics', 'spec lp']),
  E('follower', 'Envelope follower', 'A mod source that follows the sound’s own loudness.',
    'The follower listens to Apollo’s output and turns its level into a [[modulation]] source: loud moments push routed knobs further. Route it to [[cutoff]] for auto-wah, to reverb mix for blooming tails. Attack/Release (on the GLOBAL page) set how fast it reacts; drag its chip from MOD SOURCES like any other source.'),
  E('filter-display', 'Filter display', 'The filter’s response curve — drag it to play the filter.',
    'The curve shows what the [[filter]] does to each frequency; the green shadow behind it is the live output spectrum. Drag on the display: left/right moves the [[cutoff]], up/down the [[resonance]] — same parameters as the knobs, so [[modulation]] and MIDI mapping still apply.', ['filter display']),
  E('eq-curve', 'EQ curve', 'Drag the two handles to shape the tone; scroll for width.',
    'The EQ’s two bands drawn as one response curve over the live spectrum. Drag a numbered handle: left/right picks the frequency, up/down boosts or cuts; the scroll wheel narrows or widens that band (Q). The band type (shelf/peak) stays on the selectors below.', ['eq curve']),
  E('upward', 'Upward compression', 'Lifts quiet material up toward the threshold (the OTT sound).',
    'Normal [[fx-compressor|compression]] turns loud parts down. Upward compression also turns QUIET parts up toward the threshold — both at once is the dense, in-your-face “OTT” sound of modern electronic music. The meter shows red when reducing, green when lifting.', ['ott']),
  E('gain-reduction', 'Gain reduction', 'How much the compressor is changing the level right now.',
    'The GR meter shows the [[fx-compressor|compressor]] working in real time: red bars mean the level is being pulled down, green bars ([[upward]] compression) mean it’s being lifted. In multiband mode each band meters separately.', ['gr']),
  E('engine', 'Engine', 'Which synthesis method this oscillator uses.',
    'Each [[oscillator]] can be a [[wavetable]] (morphing waveforms), Sample (a recording), Multisample (an instrument with several recordings mapped across the keys), [[granular|Granular]] (grain cloud) or [[spectral|Spectral]] (frequency-analysis resynthesis). Different engines expose different controls below.'),
  E('level', 'Level', 'This source’s volume in the mix.', 'How loud this [[oscillator]] (or sub/noise) is relative to the others. Balancing levels between layered oscillators is most of the art of a good patch.'),
  E('pan', 'Pan', 'Position between left and right speakers.', 'Pans this source in the stereo field. Small opposite pans on two oscillators widen a sound instantly.'),
  E('blend', 'Blend', 'Center voice vs. detuned voices in the unison stack.', 'With [[unison]] active, Blend balances the in-tune center voice against the [[detune|detuned]] side voices. Low = clean center with a halo; high = the full detuned wash.'),
  E('phase', 'Phase', 'Where in its cycle the waveform starts on each note.', 'The start point of the waveform each time a note fires. With Rand up, every note starts at a random phase (natural, analog-ish); with Rand down and phase fixed, attacks are identical every time (punchy, clicky).'),
  E('rand', 'Rand', 'Randomizes the start phase per note.', 'How much the start [[phase]] varies from note to note. Full = every attack subtly different (organic); zero = perfectly consistent attacks (tight, electronic).'),
  E('stereo', 'Stereo', 'Spread of unison voices across the stereo image.', 'Widens the [[unison]] stack across left/right. 0 keeps all voices centered (mono-safe); up spreads them into the wide "wall of sound".'),
  E('const-pitch', 'Const Pitch', 'Sample plays at its original pitch on every key.', 'When on, the keyboard no longer transposes the [[sample]] — every key plays it as recorded. Perfect for drums, textures and one-shots where re-pitching is unwanted.', ['const pitch', 'keytrack pitch']),
  E('interp', 'Interp', 'How the wavetable blends between frames.', 'Smooth crossfades between [[wavetable]] frames continuously; Step jumps hard from frame to frame — digital and glitchy on purpose.'),

  // Sample engine
  E('start-end', 'Start / End', 'Trims which part of the sample plays.', 'Start and End trim the playback region of the [[sample]] — cut silence off the front, or isolate one hit from a longer recording.', ['start', 'end']),
  E('loop', 'Loop', 'Repeats a region so held notes sustain forever.', 'Loop modes repeat a section of the [[sample]] while the key is held: Forward loops normally, Ping-Pong bounces back and forth, and the crossfade (Xfade) smooths the seam. Zero-crossing snap keeps loop points click-free.', ['loop mode', 'loop start', 'loop end', 'xfade']),
  E('rate', 'Rate', 'Playback speed (and pitch) of the sample.', 'Speeds up or slows down [[sample]] playback like a tape machine — pitch and speed change together. For speed WITHOUT pitch change, use the [[granular]] or [[spectral]] engine.'),
  E('slices', 'Slices', 'Chops the sample at transients and maps pieces to keys.', 'Slice mode detects the hits in a [[sample]] (say, a drum loop) and maps each slice to its own key — play the loop’s pieces like an instrument, reorder them, or fire them from the [[arp]].', ['slice map']),

  // Granular
  E('density', 'Density', 'How many grains play per second.', 'Grains per second in the [[granular]] cloud. Low density = sparse, stuttering pointillism; high = a smooth, thick texture.'),
  E('grain-length', 'Length', 'The size of each grain.', 'Each grain’s duration in the [[granular]] engine. Short grains (<40 ms) sound buzzy and pitched; long ones keep more of the source’s character.', ['length']),
  E('scan', 'Scan', 'How fast the grain cloud moves through the sample.', 'The playhead speed through the [[sample]]: 1 = natural time, 0 = frozen in place (infinite sustain from one instant), negative = backwards.'),
  E('spray', 'Spray', 'Random scatter of where grains are taken from.', 'Randomizes each grain’s position around the playhead. None = focused and clean; lots = a smeared cloud where the source becomes texture.'),
  E('window', 'Window', 'The volume shape of each grain.', 'Each grain fades in and out under a "window" shape. Soft windows = smooth clouds; hard ones = choppier, buzzier grains. Skew tilts the shape toward attack or tail.', ['window shape', 'window skew']),

  // Spectral
  E('speed', 'Speed', 'Playback rate through the analysis — without changing pitch.', 'How fast the [[spectral]] engine moves through the analyzed frames. 0.1 = ten-times slow motion at full pitch; 0 = frozen. Time and pitch are fully independent here.'),
  E('freeze', 'Freeze', 'Holds the current instant of the sound forever.', 'Stops the [[spectral]] playhead so the current spectrum sustains indefinitely — turn any moment of any sound into an infinite pad.'),
  E('smear', 'Smear', 'Blurs the spectrum over time.', 'Averages each [[spectral]] frame with its neighbors, washing transients into a smooth, reverb-like blur without any actual reverb.'),
  E('shift', 'Shift', 'Slides every frequency up or down by a fixed amount.', 'Moves all partials by a fixed number of Hz — unlike pitch shifting, this breaks the harmonic relationships, giving bell-like, metallic, inharmonic colors.'),
  E('transients', 'Transients', 'How strongly note attacks are preserved.', 'Balances the analyzed attacks (consonants, drum hits) against the sustained body. Up = snappier and more articulate; down = softer, washier.'),
  E('spectral-gate', 'Gate', 'Drops quiet frequency bands, keeping only the strong ones.', 'A [[spectral]] gate silences every analysis band below a threshold — quiet noise disappears and only the loudest partials survive, giving a glassy, skeletal version of the sound.', ['gate']),

  // Filter panel
  E('drive', 'Drive', 'Pushes the signal harder into the filter for grit.', 'Overloads the [[filter]] input so it saturates — from gentle warmth to snarling distortion. Drive interacts with [[resonance]]: together they’re where analog-style aggression lives.'),
  E('fat', 'Fat / Morph', 'The filter’s extra character control — depends on the type.', 'A per-type bonus control: on Morph filters it sweeps between LP/BP/HP responses, on the [[formant]] filter it picks the vowel, on Ring Mod it sets the blend — on standard types it thickens the response ("Fat").', ['morph']),
  E('keytrack', 'Key (keytrack)', 'The filter opens as you play higher notes.', 'Keytracking links [[cutoff]] to the note you play: high notes open the filter more so the top of the keyboard isn’t muffled while the bass stays controlled. 100% = the filter follows pitch exactly (resonance plays melodies).', ['key']),
  E('serial', 'Serial', 'Filter 1 feeds into Filter 2 — one after the other.', 'Serial routing chains the [[filter]]s: sound passes through Filter 1, then Filter 2. Great for combinations like LP into [[formant]], or stacking two 12 dB slopes into a steeper one.'),
  E('parallel', 'Parallel', 'Both filters process the sound side-by-side.', 'Parallel routing splits the signal into both [[filter]]s at once and sums the results — e.g. a low-pass keeping the body plus a band-pass adding a vocal peak.'),
  E('sabcn', 'S A B C N routing', 'Chooses which sources feed this filter.', 'The five buttons stand for [[sub|Sub]], oscillators A, B, C, and [[noise|Noise]]. Lit = that source runs through this [[filter]]; unlit = it bypasses. Splitting sources between filters (bass osc → clean LP, lead osc → screaming resonance) is a powerful layering trick.', ['s', 'a', 'b', 'c', 'n']),
  E('bus', 'Bus (FX lane)', 'Which effects lane this signal is sent to.', 'Apollo has three FX lanes: Main, Bus 1 and Bus 2 — each its own chain of effects — plus Direct (no effects at all). Route the filter output or individual sources to different lanes: e.g. dry punchy drums on Direct while the pad drowns in Bus 1’s reverb.', ['bus 1', 'bus 2', 'direct', 'bus1 return', 'bus2 return', "fx lane for this filter's output", 'fx lane for this filter’s output']),

  // Envelope / LFO panel extras
  E('hold', 'Hold', 'Stays at full level between attack and decay.', 'A pause at maximum level after the [[attack]] before [[decay]] begins — adds body to plucks and percussive sounds.'),
  E('env-legato', 'Legato (env)', 'Overlapping notes don’t restart the envelope.', 'When on, playing a new note while another is held continues the [[envelope]] mid-flight instead of restarting it — smooth connected phrases.'),
  E('trig', 'Trig mode', 'What restarts the LFO.', 'Trig restarts the [[lfo|LFO]] on every note (tight, predictable), Free lets it run continuously (every note lands somewhere different — organic), Hold latches its current value, and Env makes it run once like an envelope.', ['trig mode', 'free', 'env mode']),
  E('rise', 'Rise', 'The LFO fades in gradually.', 'Delays the [[lfo|LFO]]’s full depth, fading it in over time — the classic delayed vibrato that starts straight and grows expressive.'),
  E('grid', 'Grid', 'Snap resolution for drawing LFO points.', 'Sets the X/Y snapping of the drawable [[lfo|LFO]] editor — coarse grids for rhythmic steps, fine for smooth curves.', ['grid x', 'grid y']),
  E('chaos', 'Chaos', 'A never-repeating LFO from chaotic math.', 'Replaces the looping shape with a chaotic system (Lorenz/Rössler attractors or sample-and-hold randomness) — [[modulation]] that never repeats exactly. Perfect for analog-style drift and evolving pads.', ['lorenz', 'rossler', 's&h']),

  // Matrix columns
  E('source', 'Source', 'What drives this modulation route.', 'The moving signal: an [[envelope]], [[lfo|LFO]], [[macro]], [[velocity]], key position, mod wheel, [[aftertouch]]… The source’s motion is copied onto the destination.'),
  E('dest', 'Dest', 'What this route controls.', 'The parameter being moved — almost any knob in Apollo can be a destination, including effect knobs. Drag a source chip directly onto a knob for the same result.'),
  E('amount', 'Amount', 'How strongly the source moves the destination.', 'The depth of the route. Small = subtle motion, large = dramatic sweeps. On modulated knobs, drag the outer ring to edit this without opening the [[matrix]].'),
  E('bipolar', 'Bipolar', 'Modulates in both directions around the knob’s value.', 'Off (unipolar): the source only pushes the value up. On: it swings both above and below the knob’s setting — right for vibrato and anything that should oscillate around center.', ['bi']),
  E('aux', 'Aux', 'A second source that scales this route.', 'Aux multiplies the route by another source — e.g. LFO→pitch scaled by mod wheel gives you a vibrato whose depth lives on the wheel. This is how expressive control layers are built.', ['aux amount']),
  E('curve', 'Curve', 'Reshapes the modulation response.', 'A drawable transfer curve applied to the route: make the response ease in, snap, or step. A straight line = unchanged.'),

  // Arp / seq
  E('arp', 'Arpeggiator', 'Turns held chords into rhythmic note patterns.', 'Hold a chord and the arpeggiator plays its notes one at a time in a pattern — Up, Down, Up/Down, random, or your own step pattern — locked to the tempo. Octaves extends the pattern upward; [[gate-arp|Gate]] sets note length; Hold keeps it running after you let go.', ['arpeggiator']),
  E('gate-arp', 'Gate (arp)', 'How long each arp note lasts.', 'The length of each [[arp]] step as a fraction of the beat — short gate = staccato blips, full = notes that touch.'),
  E('octaves', 'Octaves', 'How many octaves the arp climbs.', 'Repeats the [[arp]] pattern into higher octaves before starting over — 1 stays put, 3 spans a big climb.'),
  E('clip', 'Clip sequencer', 'A little piano-roll phrase player inside the synth.', 'Clips are short note phrases you draw and loop right in Apollo — audition melodies and grooves without opening the studio. The active clip can also be [[bounce|bounced]] to audio.', ['clips', 'clip']),

  // Global panel
  E('scale-lock', 'Scale lock', 'Every note you play is snapped into the chosen scale.', 'With scale lock on, any key you hit is pulled to the nearest note of the selected scale and root — no wrong notes, ever. Great for jamming and for players who don’t know theory yet.', ['scale', 'scale root']),
  E('tuning', 'Microtuning', 'Load alternative tuning systems (.scl / .tun files).', 'Replaces standard 12-tone equal temperament with any tuning: historical temperaments, just intonation, non-western scales. Load a Scala (.scl) or .tun file and the whole keyboard retunes.', ['.scl', 'tun', 'master tune']),
  E('bpm', 'BPM', 'The tempo everything synced follows.', 'Beats per minute — the clock for [[bpm-sync|synced]] [[lfo|LFOs]], delays, the [[arp]] and clips. When Apollo runs inside the studio it follows the project tempo automatically.'),

  // Mixer & misc panels
  E('scope', 'Scope', 'Live view of the actual output waveform.', 'An oscilloscope drawing the sound as it plays — watch [[filter]] sweeps round off the corners, [[unison]] thicken the trace, and effects reshape it. Seeing sound move is half of understanding it.'),
  E('keyboard', 'Keyboard', 'Play notes with your mouse or computer keys.', 'The on-screen keyboard — click or drag across keys to play. A hardware [[midi|MIDI]] keyboard (the MIDI button up top) is far more expressive when you have one.'),
  E('meter', 'Output meter', 'Shows the final output level.', 'The bar beside the Main knob shows how loud the final output is. The built-in [[limiter]] keeps it from clipping, but if it’s pinned at the top constantly, pull Main down for cleaner sound.'),
  E('mod-sources', 'Mod sources', 'Drag these chips onto any knob to create modulation.', 'Each chip is a [[modulation]] source ([[envelope]]s, [[lfo|LFOs]], [[macro]]s…). Drag one onto any knob and drop it: a route is created instantly, shown as a colored ring on the knob. The same routes appear in the [[matrix]].', ['mod sources', 'sources']),

  // FX units (the 16)
  E('fx-reverb', 'Reverb', 'The sound of a space — room, hall, or endless wash.', 'Reverb simulates reflections of a physical space. Size sets the room, Decay how long it rings, Damp rolls highs off the tail, Pre-delay separates the dry hit from the wash. A little glues; a lot drowns — use the [[wet-dry|Mix]] knob.', ['reverb']),
  E('fx-delay', 'Delay', 'Echoes, synced to the beat.', 'Delay repeats the signal after a set time — usually [[bpm-sync|synced]] (1/4, 1/8 dotted…). [[feedback|Feedback]] sets how many repeats; Ping-Pong bounces them left/right; the filters and Tape control darken each successive echo.', ['delay']),
  E('fx-chorus', 'Chorus', 'Detuned copies that make one voice sound like several.', 'Chorus mixes slightly delayed, slowly-wobbling copies with the original — instant width and shimmer, the sound of 80s pads and clean guitars.', ['chorus']),
  E('fx-flanger', 'Flanger', 'A sweeping jet-engine comb effect.', 'A very short modulated delay mixed with the dry signal creates a moving [[feedback|comb-filter]] sweep — the "jet flyby". Feedback sharpens it into metallic territory.', ['flanger']),
  E('fx-phaser', 'Phaser', 'Swooshing notches sweeping through the sound.', 'All-pass filters create moving notches in the spectrum — a softer, swirlier cousin of the flanger. Stages sets how many notches; feedback deepens them.', ['phaser']),
  E('fx-distortion', 'Distortion', 'From warm saturation to total destruction.', 'Distortion clips and saturates the signal, adding harmonics — warmth at low drive, aggression at high. The built-in filter can confine the damage to part of the spectrum.', ['distortion']),
  E('fx-compressor', 'Compressor', 'Evens out loud and quiet — adds punch and glue.', 'A compressor turns loud moments down automatically: Threshold is where it starts, Ratio how hard, Attack/Release how fast it reacts, Makeup restores the volume. Fast attack tames peaks; slow attack lets the punch through then squeezes the tail. Multiband mode compresses lows/mids/highs independently.', ['compressor']),
  E('fx-eq', 'EQ', 'Tone control — boost or cut chosen frequencies.', 'A parametric equalizer: pick a frequency, boost or cut it, set Q (how narrow). Cut mud around 200–400 Hz, add air above 10 kHz — small moves, big results.', ['eq']),
  E('fx-filter', 'Filter (FX)', 'A filter at the end of the chain — for the whole mix of this lane.', 'The same [[filter]] types as the voice filters, but applied post-FX to everything on the lane. Automate its [[cutoff]] via the [[matrix]] for DJ-style sweeps over the finished sound.', ['filter fx']),
  E('fx-utility', 'Utility', 'Gain, pan and width — the boring essentials.', 'Simple level trim, pan and [[stereo-width|width]] wherever you need it in the chain.', ['utility']),
  E('fx-bitcrush', 'Bitcrush', 'Lo-fi digital destruction.', 'Reduces bit depth (adds gritty quantize noise) and sample rate (adds metallic aliasing) — the sound of old samplers, video games and broken machines.', ['bitcrush']),
  E('fx-octaver', 'Octaver', 'Adds octaves below and above.', 'Generates a copy an octave down (Sub — instant heft) and an octave up (Up — brightness) and blends them with the dry signal.', ['octaver']),
  E('fx-hyper', 'Hyper', 'Instant supersaw — unison as an effect.', 'Hyper clones the incoming signal into a detuned [[unison]] swarm after the fact, with Dimension adding short-delay width. Turns thin sounds huge without touching the oscillators.', ['hyper']),
  E('fx-echobode', 'Echobode', 'A frequency-shifting delay — metallic, spiraling echoes.', 'A delay whose [[feedback]] loop passes through a frequency [[shift|shifter]], so every repeat slides further from harmonic reality. Small shifts = phasey chorus-delays; large = alien spirals.', ['echobode']),
  E('fx-convolve', 'Convolve', 'Real-space reverb from impulse responses.', 'Convolution reverb multiplies your sound with the fingerprint (impulse response) of a real space or device — halls, plates, springs. Denser and more "photographic" than the algorithmic [[fx-reverb|reverb]].', ['convolve', 'convolution']),
  E('fx-split', 'Splitters (LH / LMH / MS)', 'Split the signal into parts, effect each differently.', 'Splitters divide the lane — by frequency into Low/High or Low/Mid/High bands, or into Mid/Side (center vs. edges of the stereo image) — and give each part its own mini-chain. Compress just the lows, chorus just the sides, distort just the mids.', ['splitlh', 'splitlmh', 'splitms', 'split']),
]

// ── Resolver ────────────────────────────────────────────────────────────────

const index = new Map<string, LearnEntry>()
for (const e of LEARN_ENTRIES) {
  index.set(e.key, e)
  index.set(e.title.toLowerCase(), e)
  for (const a of e.aliases ?? []) index.set(a.toLowerCase(), e)
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[▾▸◀▶✕⭳…]+/g, ' ')
    .replace(/\s*\d+\s*$/, '')       // "filter 1" → "filter", "macro 3" → "macro"
    .replace(/\s+/g, ' ')
    .trim()
}

/** Look up the entry for a control, from its data-learn label and/or title. */
export function resolveLearn(label: string | null, title: string | null): LearnEntry | null {
  for (const raw of [label, title]) {
    if (!raw) continue
    const lower = raw.toLowerCase().trim()
    if (index.has(lower)) return index.get(lower)!
    const norm = normalize(raw)
    if (index.has(norm)) return index.get(norm)!
  }
  // last resort: a contains-scan on the label (catches "FILTER 1", "LFO 4 rate")
  const norm = normalize(label || title || '')
  if (norm.length >= 3) {
    for (const [k, e] of index) {
      if (k.length >= 3 && (norm === k || norm.startsWith(k + ' ') || norm.endsWith(' ' + k))) return e
    }
  }
  return null
}

/** Fallback entry when a control has no authored article — the hover title text
 *  still teaches something. */
export function fallbackEntry(label: string, title: string | null): LearnEntry {
  return {
    key: 'fallback:' + label,
    title: label,
    short: title || 'Part of the current panel.',
    body: (title && title !== label ? title + '.' : `“${label}” belongs to the panel it sits in — its tooltip and neighbors are the best guide.`) +
      ' No detailed article exists for this control yet.',
  }
}
