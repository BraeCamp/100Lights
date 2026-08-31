// What each command actually does, in a sentence or two.
//
// Brae: "please create a library of functions that can be done through Light,
// the vocal control program so that users can see what they can do... When the
// user hovers over one, it shows a summary of that function."
//
// ⚠️ Separate from commands.ts on purpose. The registry is code somebody has to
// read while working on the parser, and seventy-seven paragraphs of prose in
// the middle of it would bury the rules. Keyed by command id, so a command with
// no entry falls back to its one-line `what` rather than showing nothing — and
// the conformance suite checks the keys line up, so a renamed command cannot
// quietly lose its explanation.
//
// Written for somebody deciding whether to say it, which means each one answers
// the same three questions: what changes, what it affects if you do not say,
// and the thing that would surprise you.

export const COMMAND_SUMMARIES: Record<string, string> = {
  // ── Transport ────────────────────────────────────────────────────────────
  'transport.play': 'Starts playback from wherever the playhead is. "Go" on its own works, and so does "play it".',
  'transport.stop': 'Stops playing. The playhead stays where it is, so playing again carries on from there rather than from the top.',
  'transport.pause': 'The same as stopping — the studio keeps your place. Say "restart" if you want the beginning.',
  'transport.restart': 'Rewinds to bar 1 and plays. Useful at the end of a sentence: "loop the bass and then restart" is one breath.',
  'transport.locate': 'Moves the playhead to a bar without playing. "Go to bar 9", "take me to the last bar".',
  metronome: 'Turns the click on or off. It is studio state, not part of the song, so it is never saved with the project — and turning it on tells the studio you might be about to say a rhythm.',

  // ── Mixer ────────────────────────────────────────────────────────────────
  'set_track.mute': 'Silences one track, or brings it back. Muting is not the same as turning it down: an automated fade still runs underneath.',
  'set_track.solo': 'Hears one track on its own. Soloing a second track adds it rather than replacing the first, which is what "solo the bass as well" means.',
  'set_track.volume': 'Sets a track to an exact level, as a percentage. "Put the pad at 60 percent."',
  'set_track.volume.relative': 'Nudges a track up or down by a fixed step rather than to a number — "a bit louder" without deciding how much a bit is. Tone words like "warm up" and "more punch" are deliberately NOT this command.',
  'set_track.pan': 'Places a track in the stereo field. "Pan the guitar hard left", "put the keys slightly right", "centre the bass".',
  'set_all_tracks.mute': 'Mutes or unmutes everything at once. The fastest way back from a mix you have soloed into a corner.',
  'set_all_tracks.solo_off': 'Clears every solo. Say this when something is inaudible and you cannot remember what you soloed.',
  set_master_volume: 'Sets the level of the whole mix, after every track and effect. Use it for the room, not for balance.',
  add_effect: 'Puts a device on a track — reverb, delay, EQ, compressor, saturator and the rest. It goes on the end of the chain, which is where you almost always want it.',
  remove_effect: 'Takes a device off a track. Naming the type is enough; you do not have to say which one if there is only one.',
  set_effect: 'Changes how much of an effect a track has, as a percentage. "More reverb on the vocals", "halve the delay".',
  shape_tone: 'Tone in one word: brighter, darker, warmer, cleaner, punchier, fuller, thinner. Each is a small set of EQ or transient moves rather than a single band — "warmer" lifts the body AND takes the top down, because a low boost on its own is just mud. Saying it again does it again; it reuses the device already there instead of stacking another.',
  set_width: 'How far a track spreads across the stereo picture. Wider, narrower, or hard mono. Bass in mono is the commonest reason anybody asks for this.',
  duck_under: 'Makes one track step out of the way of another — the pump you hear when a pad breathes around a kick. Say which one gets quieter and which one it makes room for: "duck the pad under the kick".',

  balance_levels: 'Sets track levels by MEASURING them rather than by guessing. It renders each track on its own, works out how loud it actually sounds, and moves the faders to match — so it takes a few seconds and says so. ⚠️ Measured with K-weighting, not raw level: a bass and a hi-hat at the same RMS are nowhere near equally loud, and matching by raw level is what leaves the bass booming and the vocal buried.',
  crossfade: 'Fades one clip out as the next fades in, so the join is smooth instead of a click. If the two clips do not overlap, the second is pulled back to meet the first — there is no other way to make them cross. An overlap you already set up is honoured rather than overruled.',

  // ── Timing ───────────────────────────────────────────────────────────────
  set_tempo: 'Changes the song tempo in BPM, or adds a tempo change at a bar if you say where.',
  'set_tempo.relative': 'Speeds up or slows down by a step, for when you know it is wrong but not what it should be.',
  set_time_signature: 'Changes the meter. A change part way through starts a new bar there, so bar numbers after it move.',
  set_key_scale: 'Sets the key and scale the song is written in. It does not transpose anything — it tells the studio what to assume when you talk about notes and chords.',
  set_swing: 'Swings the offbeats, or straightens them out. "Add some swing" is a moderate amount; say a percentage for a specific one.',
  'set_loop_region.range': 'Loops a range of bars. "Loop bars 9 to 17."',
  'set_loop_region.first': 'Loops the opening stretch — "loop the first eight bars" — without needing to work out where it ends.',
  'set_loop_region.on': 'Turns looping on over whatever range is already set.',
  'set_loop_region.off': 'Turns looping off and lets the song run on.',
  time_feel: 'How a part sits against the beat. Half time and double time rewrite the note positions and stretch the clip to match. Humanize nudges each note slightly — the same way every time, so undoing and redoing does not give you a different performance. Ahead and behind push the whole part early or late.',

  apply_groove: 'Gives one part a named feel — shuffle, laid back, pushed, off-grid, straight — by moving its notes and shaping its accents. ⚠️ Not the same as swing: swing is one number applied to the whole song at playback time and only ever moves the offbeats. A groove is baked into the notes of one part, so you can see it in the piano roll, and it can move downbeats and change accents, which uniform swing cannot.',

  // ── Arrangement ──────────────────────────────────────────────────────────
  duplicate_clip: 'Repeats a clip back to back, as many times as you say. The copies follow on immediately rather than landing on top of each other.',
  move_clips: 'Shifts clips later or earlier by bars or beats. Nothing is ever moved before the start of the song.',
  insert_clip: 'Drops a single sound into the arrangement at a position — a crash on bar 17, a hit at the top.',
  split_clip: 'Cuts a clip in two at a bar, so the halves can be moved or deleted separately.',
  resize_clip: 'Makes a clip longer or shorter without moving where it starts.',
  remove_clip: 'Deletes a clip. Destructive, so it is read back before it happens.',
  rename_clip: 'Renames a clip. Worth doing: every other command finds things by name, so a well-named clip is an easier one to talk about.',
  add_marker: 'Names a place in the song — chorus, drop, bridge. Markers are what the section commands work from, so this is the setup for those.',
  remove_marker: 'Removes a named marker. The sections either side of it merge into one, because a section is simply the gap between two markers.',
  section: 'Works with a named part of the song rather than with bar numbers. Loop the chorus, jump to the drop, double the chorus. A section runs from its marker to the next one, so it stays right when you move things.',
  'automate_parameter.fade': 'Fades a track in or out across a stretch, by writing volume automation rather than by setting a level.',
  'automate_parameter.filter': 'Sweeps a filter open or closed over time — the descending filter into a drop, or the opening one out of an intro.',
  add_clip_effect: 'Dials a parameter in and out across a stretch of a clip, for movement inside a part rather than across the mix.',

  // ── Notes ────────────────────────────────────────────────────────────────
  transpose: 'Moves a part up or down in semitones. Twelve is an octave.',
  quantize: 'Pulls notes onto the grid. Say a strength below 100 to tighten a performance without flattening it — full strength is a snap, and it is not always what you want.',
  set_velocity: 'Makes a part play harder or softer. This is how hard the notes are struck, not the track fader, so the instrument changes character rather than just level.',
  note_length: 'How long the notes are held. Legato runs each note into the next — chords are handled properly, so the notes of a chord do not cut each other short. Staccato clips them.',
  dynamics_ramp: 'A crescendo or diminuendo across a part. It shapes the note velocities, so the part is genuinely played harder rather than turned up.',
  harmonize: 'Adds a second voice a third, fifth or octave away. It ADDS — the original part stays, which is the difference between harmonising and transposing.',
  reverse_notes: 'Plays a part backwards. The rhythm mirrors in time and the pitches stay as they were.',
  stutter: 'Chops notes into fast repeats — the roll on the last beat before a drop, or a snare going into a chorus. By default it takes only the last note or chord, which is the usual ask; say "every note" for the whole part. The repeats get quieter across the run, which is what makes it read as a roll rather than as a stuck note.',
  add_midi_effect: 'Shapes the notes before they reach the instrument — an arpeggiator, a chord builder, a scale corrector, a velocity shaper.',
  remove_midi_effect: 'Takes a note shaper back off, so the instrument plays what is actually written in the clip again.',
  make_beat: 'Say a rhythm out loud — "boom ka boom boom ka" — and get it as drums, placed in the timing you said it. If the studio could not hear when you said each syllable it spaces them evenly and tells you so, because that is a different beat from the one you played.',
  record_take: 'Records a part by voice. The studio asks whether you want the click, counts you in out loud, listens, and writes down what you said. Naming one drum records just that lane, which is how a kit is usually built.',
  open_editor: 'Opens the step sequencer or the piano roll on a clip, or makes a new one. A new sequencer arrives with a drum kit on it; a new piano roll does not.',
  define_word: 'Gives a word a meaning for this session: "ta means closed hi hat", "one means C major". Short words are the point — you cannot say "closed hi-hat" in a sixteenth note, and you can say "ta". They last until you change them or clear them.',
  name_notes: 'Names what is sounding — the notes, and the chord they make. Ask about a track by name, or about the playhead.',

  // ── Project ──────────────────────────────────────────────────────────────
  add_track: 'Adds a new empty track. Give it a name and every later command can find it by that name; without one it gets a number.',
  remove_track: 'Deletes a track and everything on it. Destructive, so it is confirmed first.',
  duplicate_track: 'Copies a whole track with its clips, effects and settings.',
  rename_track: 'Renames a track. Worth doing early — every command that takes a target finds it by name.',
  group_tracks: 'Folds tracks into one group, so they can be moved, muted and processed together.',
  set_instrument: 'Puts an instrument from your library onto a track. The notes already there stay exactly where they are - only what plays them changes.',
  undo: 'Takes back the last change. Carried out by the studio itself rather than by the song, because the history is not part of the project.',
  redo: 'Puts back what you just undid. Like undo it belongs to the studio rather than to the song, so the history is not something the project carries around.',

  // ── Questions ────────────────────────────────────────────────────────────
  'describe.tempo': 'Answers the tempo, including any changes part way through.',
  'describe.tracks': 'Lists the tracks, so you know what names the other commands will understand.',
  'describe.muted': 'Says what is muted or soloed — the first thing worth asking when something is missing.',
  'describe.length': 'Says how long the song runs, in bars and in minutes - the two numbers people mean at different moments.',
  'describe.clips': 'Lists the clips on a track and the bars they sit at, which is usually what you need before moving or duplicating one.',
  'describe.key': 'Says what key and scale the song is set to. That is what the studio was told, not what it worked out by listening to the notes.',
  'describe.notes': 'Says what a part is playing, as notes and chords.',
  'describe.instrument': 'Says what instrument is on a track, and whether it is a synth, a drum kit, a sampler or a plugin.',
  'describe.automation': 'Says what is automated, which is often the answer to "why does it do that".',
  'describe.effects': 'Lists the devices on a track in signal order, which is the order they actually happen in - an EQ before a compressor is a different sound from the same two the other way round.',
  'describe.volume': 'Says where a track fader is set, as a percentage - the number worth knowing before saying "a bit louder" three times and losing track of where you started.',
  'describe.position': 'Says where the loop is and whether it is on.',
}
