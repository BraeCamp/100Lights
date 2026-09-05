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
  'browse_sounds': 'Plays your sounds one after another so you can hear them instead of reading names. While it runs, short words steer it — next, back, again, restart, faster, slower, this one, done — and none of them reach the assistant, so hunting through a library costs nothing. Instruments are collapsed to one note each, so a cello does not take forty seconds.',

  // ── Named shapes ─────────────────────────────────────────────────────────
  'run_macro': 'Runs a shape you saved earlier — several parameters moving together across a clip or a stretch of bars. The shape stretches to whatever it is given, so the same one covers a four-bar clip and a thirty-two-bar section. Saying its NAME is free; "do the same thing again" is not, because that points at the selection rather than at the shape.',

  // ── The workspace ────────────────────────────────────────────────────────
  'select.focus_track': 'Focuses a track and says so, then every command that names nothing acts on it — "louder", "add reverb", "mute it". Deliberately NOT a mode: naming another track still wins, so there is nothing to get stuck inside and nothing to exit.',
  'show_view.colours': 'Opens the studio\'s own colours and patterns — the look of the app, not anything in the song. Say "close the colours" to put it away.',
  'show_view.devices': 'Opens a track\'s effect rack and selects the track, so the rack is showing that track\'s devices and not the last one you looked at. Say "close the devices" to put it away.',
  'show_view.automation': 'Puts a drawable volume lane under the track, ready to draw a shape into. Every device parameter can be automated as well — add those from the lane\'s own menu once one is open.',
  'show_view.pads': 'Shows the playable pads for tapping parts in by hand or by voice. Nothing about the song changes either way.',
  'copy_notes': 'Makes a new clip on the same track holding only a part of another clip — the notes that start together at its beginning ("the first chord"), or everything inside its first bar or two — and puts it where you say, several times back to back if you ask. The source clip is untouched.',
  'show_view.transcript': 'Opens the transcript in a bar beside the voice card: what you said, what Light answered, and — as its own list — what actually changed in the song. The card stays on screen.',
  'show_view.help': 'Opens the full list of what Light understands on its own, beside the voice card, with the ways to say each one. Nothing is spoken; the list is the answer.',
  'show_view.voice': 'Opens the voice card\'s own settings, its usage-and-costs log, or its named shapes, in a bar beside the card rather than in place of the live view.',
  'describe.playhead': 'Answers with the bar and beat the transport is sitting on at this moment, and adds the loop range if looping happens to be switched on.',
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
  strip_back: 'Leaves only the tracks you name and mutes everything else, or brings it all back. The fastest way to hear an arrangement idea, and worth several separate mute commands.',
  set_master_volume: 'Sets the level of the whole mix, after every track and effect. Use it for the room, not for balance.',
  add_effect: 'Puts a device on a track — reverb, delay, EQ, compressor, saturator and the rest. It goes on the end of the chain, which is where you almost always want it.',
  remove_effect: 'Takes a device off a track. Naming the type is enough; you do not have to say which one if there is only one.',
  set_effect: 'Changes how much of an effect a track has, as a percentage. "More reverb on the vocals", "halve the delay".',
  shape_tone: 'Tone in one word: brighter, darker, warmer, cleaner, punchier, fuller, thinner. Each is a small set of EQ or transient moves rather than a single band — "warmer" lifts the body AND takes the top down, because a low boost on its own is just mud. Saying it again does it again; it reuses the device already there instead of stacking another.',
  set_width: 'How far a track spreads across the stereo picture. Wider, narrower, or hard mono. Bass in mono is the commonest reason anybody asks for this.',
  duck_under: 'Makes one track step out of the way of another — the pump you hear when a pad breathes around a kick. Say which one gets quieter and which one it makes room for: "duck the pad under the kick".',

  balance_levels: 'Sets track levels by MEASURING them rather than by guessing. It renders each track on its own, works out how loud it actually sounds, and moves the faders to match — so it takes a few seconds and says so. ⚠️ Measured with K-weighting, not raw level: a bass and a hi-hat at the same RMS are nowhere near equally loud, and matching by raw level is what leaves the bass booming and the vocal buried.',
  crossfade: 'Fades one clip out as the next fades in, so the join is smooth instead of a click. If the two clips do not overlap, the second is pulled back to meet the first — there is no other way to make them cross. An overlap you already set up is honoured rather than overruled.',

  set_device_param: 'Sets a named dial inside an effect — compressor ratio, reverb decay, delay feedback, limiter ceiling, gate threshold. Reads the same parameter registry the device UI and the automation lanes read, so a value here means what it means everywhere else. If the device is not on the track yet it is added first, so "put a compressor on and set the ratio to 4" is one sentence.',
  set_sound: 'Shapes the INSTRUMENT — its envelope and its own filter — rather than an effect after it. "A slower attack", "shorten the release", "more resonance". ⚠️ Only synths have an envelope to shape; a drum kit or a sampler will say so rather than pretend. The cutoff moves by ratio rather than by a fixed number of Hertz, because 2 kHz up from 200 Hz and 2 kHz up from 10 kHz are not the same move.',
  eq_band: 'Cuts or boosts at a frequency you name — the commonest sentence in any mixing session. "Cut 300 hertz on the guitar", "boost 5k on the vocals". The frequency decides which of the three bands moves, and that band\'s crossover is placed where you asked.',
  send_to: 'Feeds some of a track into a shared return bus instead of putting an effect on the track. This is how several tracks share one reverb, which is cheaper and is how a mix hangs together. Send 0 takes it back out.',

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
  time_feel: 'How a part sits against the beat. Half time and double time rewrite the note positions and stretch the clip to match. Humanize moves each note\'s start a little, earlier or later, up to the amount you give (as a share of a sixteenth; 50 % is the default) — the same way every time, so undoing and redoing does not give you a different performance. Ahead and behind push the whole part early or late.',

  apply_groove: 'Gives one part a named feel — shuffle, laid back, pushed, off-grid, straight — by moving its notes and shaping its accents. ⚠️ Not the same as swing: swing is one number applied to the whole song at playback time and only ever moves the offbeats. A groove is baked into the notes of one part, so you can see it in the piano roll, and it can move downbeats and change accents, which uniform swing cannot.',

  tempo_ramp: 'A ritardando or accelerando — speeding up or slowing down ACROSS a stretch rather than at a point. Written as a handful of tempo markers instead of a curve: few enough to see and move by hand afterwards, close enough together to hear as a slide.',
  modulate: 'Changes key from a point onwards: transposes the notes from there AND moves the key setting. That second half is the whole difference between a key change and a transpose — without it the scale highlighting disagrees with the song.',

  // ── Arrangement ──────────────────────────────────────────────────────────
  set_clip_active: 'Parks a clip: it stays exactly where it is, drawn dimmed, and playback and every render skip it until you activate it again. This is the move for trying an idea without it — nothing is deleted, nothing moves, and the whole track keeps playing its other clips. Deleting is a different command, and silencing a whole track is mute.',
  duplicate_clip: 'Repeats a clip back to back, as many times as you say. The copies follow on immediately rather than landing on top of each other.',
  nudge: 'Moves something by a few milliseconds — the adjustment you make when a part is nearly right. ⚠️ Not move_clips: that works in bars and beats, which are musical distances. A nudge is a fixed amount of TIME, so it converts through the tempo and stays the same nudge whatever the grid says.',
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
  set_chance: 'Sets how often the notes of a part play — a percentage per note, rolled on every pass, so a hat line breathes instead of repeating. 100 is always, 0 is never. Part of a clip can be named, as with transpose.',
  set_delay_compensation: 'Turns delay compensation on or off — on, every track is delayed to match the slowest one\'s devices so they all arrive together; off, each track plays as its devices deliver it, which is what you want while recording live through a slow one.',
  modulate_parameter: 'Puts an LFO on a parameter so it keeps moving — a wobble on the filter, a tremolo on the volume, an auto-pan — in time (every eighth, once a bar) or at a rate in hertz. Automation is a ramp drawn once; this repeats. "Take the LFO off" removes it.',
  add_clip_effect: 'Dials a parameter in and out across a stretch of a clip, for movement inside a part rather than across the mix.',

  // ── Notes ────────────────────────────────────────────────────────────────
  chord_inversion: 'Moves the bottom note of each chord up an octave, or the top note down — same chord, different voicing and a different bass note. Each chord is inverted separately, which is what keeps a progression a progression; inverting the whole part by pitch would move notes between chords.',
  select: 'Chooses what "this" refers to without touching the mouse — everything, the clips inside the loop, everything on one track, or nothing. Notes too: "select every C in the pad", "select the quiet notes in the lead", "select the notes off the scale" opens the clip and selects exactly those notes, so the next command acts on them. Worth saying before a command that acts on the selection.',
  warp_markers: 'An audio clip\'s warp markers — the pins between moments of the sample and beats of the clip. Warp it as a loop of so many bars, straight at one speed, or at its own tempo; quantize its transients onto the grid; or clear the markers. Warp itself switches on and off with the clip settings.',
  clip_time: 'A MIDI clip\'s loop and its time. Set the loop\'s length; duplicate the loop — it doubles and its notes are copied, with what came after moved along; crop the clip to its loop; select the notes inside it. The time commands insert, delete or duplicate the loop\'s span (or the whole clip when it does not loop). Looping on or off is the clip-settings command; the song\'s loop is its own.',
  edit_notes: 'Note surgery inside a clip. Split cuts every note in two (or at a place you name); chop cuts each into a number of equal pieces; join merges the notes on each key into one long note; fit stretches the notes to fill the loop or the clip; deactivate keeps notes in place but silences them, and activate brings them back. Splitting or deactivating a CLIP is a different command.',
  transpose: 'Moves a part up or down in semitones — twelve is an octave — or by scale degrees when you say so ("up two scale degrees"), which keeps the part in the song\'s key. On an audio clip it is the clip\'s pitch shift, in semitones.',
  invert_notes: 'Flips a part upside down: the highest note becomes the lowest and the lowest the highest, the rhythm untouched. When the song has a key, it inverts by scale degree so the result stays in key. Chords have their own command — invert the chords — which moves the bottom note up an octave.',
  stretch_notes: 'Stretches a part in time by a factor, from its first note: 2 is twice as long (half speed), 0.5 is half as long. Note positions and lengths move together, and the clip grows to fit.',
  quantize: 'Pulls notes onto the grid — a quarter note unless you say eighths, sixteenths or triplets (two thirds of the value). Note starts move unless you ask for the ends, or both. Say a strength below 100 to tighten a performance without flattening it — full strength is a snap, and it is not always what you want.',
  set_velocity: 'Makes a part play harder or softer. This is how hard the notes are struck, not the track fader, so the instrument changes character rather than just level.',
  note_length: 'How long the notes are held. Legato runs each note into the next — chords are handled properly, so the notes of a chord do not cut each other short. Staccato clips them. Or one length for every note: "make the hats sixteenth notes".',
  dynamics_ramp: 'A crescendo or diminuendo across a part. It shapes the note velocities, so the part is genuinely played harder rather than turned up.',
  harmonize: 'Adds a second voice a third, fifth or octave away. It ADDS — the original part stays, which is the difference between harmonising and transposing. When the song has a key the interval is taken in the scale, so a third above is a major or minor third as the key wants and the harmony stays in key.',
  reverse_notes: 'Plays a part backwards within the clip. The rhythm mirrors in time and the pitches stay as they were.',
  stutter: 'Chops notes into fast repeats — the roll on the last beat before a drop, or a snare going into a chorus. By default it takes only the last note or chord, which is the usual ask; say "every note" for the whole part. The repeats get quieter across the run, which is what makes it read as a roll rather than as a stuck note.',
  set_apollo_param: 'Any of Apollo\'s 166 dials, by the name you say out loud — the filter cutoff, an envelope stage, the wavetable position, grain size, an LFO rate, a macro, the glide. One command for all of them, because Apollo\'s own parameter registry knows every dial\'s range, curve and unit, so a spoken value lands where the panel would put it: "cutoff to 800 hertz" is a real frequency, and "halfway" is halfway to the EAR on a dial that is logarithmic. It always says which module it moved, so a wrong assumption shows immediately. ⚠️ Where a dial exists in several places — level, pan, rate — say which one, or it asks rather than guessing.',
  set_apollo_switch: "Apollo's CHOICES rather than its dials — which engine an oscillator runs, which warp is on it, how many unison voices, which octave. The engine is the one that matters most: it decides what an oscillator IS (wavetable, sample, granular, spectral), and it gates 66 of Apollo's dials, so the granular and spectral controls do nothing at all until an oscillator is actually running them. ⚠️ Sample, granular and spectral all play a LOADED sample, so switching to one with an empty slot makes no sound — it says so rather than leaving you with silence and a success message.",
  set_apollo_filter: 'Changes which filter MODEL Apollo is running: ladder, acid, EMS, formant/vowel, comb, phaser, ring mod, sample-and-hold, and the plain low/high/band passes. This is the biggest single change to a patch\'s character — a ladder and a comb at the same cutoff are not the same instrument. A slope you say ("24 dB low pass") is honoured. ⚠️ It switches the filter on as well as choosing it, because picking a filter and hearing one should not be two separate commands.',
  'describe.library': 'Asks what SOUNDS you have, rather than what is in the song. "What dark pads do I have", "what pianos do I have", "what is in my library". Searched by the same words the library filter chips use — dark, warm, bright, ambient, crunchy, and the instrument kinds — so a preset answers to the same word whether you click it or say it. It replies with NAMES, not a count: the point of asking is to pick one.',
  'describe.loading': 'Asks whether the song has finished preparing itself, and how far along it is. Worth knowing because the answer is never "wait" — parts that are not ready yet play live, so you can keep working while it finishes. Studio state rather than part of the song, so it is never saved with the project.',
  edit_note: 'Puts a single note in, or takes one out. Everything else about notes works in BULK — transposing, quantising, lengthening, softening a whole part — and none of it could add or delete one note, which is the thing you want the moment the piano roll is open. A note said without an octave ("put a C on beat three") lands in the same octave as the rest of the part, because a bare C in a bass line means a low one. Removing asks which: the last, the first, the highest, the lowest.',
  project_action: 'The project as a FILE rather than as music — open a different one, start one, name a version of where you are now, go back to a version, or rename this project. Saving a version is the one worth knowing about: naming a moment out loud, mid-flow, is the thing nobody stops to do with a mouse, and it is what makes going back later possible at all. ⚠️ Opening a project or restoring a version replaces what is on screen; the studio saves as you work, so nothing is lost, but it is a big move and it always says what it is doing first. A version has to be NAMED — an unnamed one is a row you cannot identify later, which is the same as not having saved it.',
  write_part: 'Makes a whole new part in one go — a track, a sound, and notes to play — because these cannot be asked for separately: a track with no clips yet cannot be given a sampled preset, so split into steps the request fails halfway. The sound is chosen by CHARACTER rather than by name: say darker, sad, mellow, warm, bright, spacious, gritty, and your library is searched by what each preset measurably sounds like — its filtering, its EQ, its attack — so it works on presets nobody has tagged, including ones you made yourself. It always says which preset it picked and why. ⚠️ Notes stay inside the preset\'s sampled range, because notes outside it are repitched and sound slightly wrong; "low notes" means low FOR THAT PRESET.',
  set_apollo_layer: 'Brings in Apollo\'s own layers — the sub oscillator, the noise, and the three oscillators. "Add sub to the pad" thickens the sound the pad already makes, INSIDE the instrument, rather than adding an effect after it or a second track. ⚠️ Only Apollo instruments have these; anything else says so and says what would fix it. Asking for a layer switches it on: reading "add sub" as "set its level but leave it off" would be a command that reports success and changes nothing you can hear.',
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
  set_instrument: 'Puts an instrument from your library onto a track. The notes already there stay exactly where they are - only what plays them changes. A library sample works too, and it can be asked for by its name, by its folder, or by its kind - "a hihat", "the 808", "a clap" picks one of that kind and pitches it across the keys.',
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
  set_colour: 'Colours a clip or a track so the arrangement reads at a glance. Colour is a label and never changes the sound. Several clips with one name are all coloured together.',
  set_clip_audio: 'An audio clip\'s own settings: fade in, fade out, its level, reversed or not, looped or not — and the Sample Editor\'s: Warp on or off, the warp mode (Re-Pitch or Complex), its pitch in semitones and cents, the sample\'s own tempo (Seg BPM, which sets how many beats the clip spans), the 4 ms edge fade, and Slip, which slides the audio under the clip while the clip keeps its place and its length — and Tempo Leader, which makes the song\'s tempo follow this one clip (its warp markers become the tempo map, so it plays as recorded). These live on the clip, so the track fader and its effects are untouched.',
  sound_like: 'A sound asked for by how it feels rather than by which control — "fuzzier", "wiggly", "dreamy", "bigger", "harder". The studio knows what each of its words can mean here, and when one of them is genuinely two different sounds it asks which, describing both for someone who does not know the words ("more like static, or more muffled?"). Then it makes the change for real, plays it back where it happens, and keeps it on the table so you can say "a little bit less of that".',
  adjust_it: 'Bending the change still under discussion, and nothing else: less, more, spread it over the bars so it starts one way and ends another, undo it, or leave it. There is no target because it is whatever was just made. These sentences mean nothing on their own, so the studio only reads them this way while something is actually on the table.',
  set_automation_arm: 'Whether moving a control while the transport records writes the move into its lane. Touch writes while you hold it and then the lane goes back to what it already said — for fixing one moment in a shape you like. Latch writes while you hold and then HOLDS that value to the end, replacing everything after, which is also how eight bars of careful work disappear; it is never the default and it says how many points it destroyed. Off is the third real answer: moving a control overrides its lane instead, destroying nothing.',
  set_global_quantization: 'When a session launch lands, for every slot that names none of its own — none (the instant you press), a beat, a bar, two bars or four. A clip pressed half a bar early still comes in on time. This is the default; set_launch overrides it for one slot. The slot menu has always offered "Use Global"; until now there was no global and every such slot got a hard-coded bar.',
  set_launch: 'How a session slot answers a press. Trigger starts it from the top and ignores the release; Gate plays only while you hold; Toggle starts and then stops on the next press (what Beacon has always done, and the default); Repeat starts it again every launch-quantization step while held. Legato makes a clip launched over a playing one pick up where that one had got to rather than start over, and Velocity Amount decides how much the velocity of the press reaches the clip\'s level. These belong to the session grid, not the arrangement.',
  bounce_track: 'A track\'s devices printed as audio. Bouncing looks like freezing and is not: a freeze is a cache that thaws back, and a bounce is a normal audio clip that can then be cut, warped and reversed. To a new track the originals are parked rather than deleted, so the live version is one click away. The render is pre-mixer and the level, pan and sends are copied onto the new track, so it sounds identical to the source and the level is still in the fader. It takes real seconds, so the reply comes before the audio does.',
  set_metronome: 'What the click sounds like, how often it clicks, whether it is only there for takes, and how many bars it counts in. A click you cannot hear over what you are playing is worse than no click at all, so the six sounds sit in different frequency bands rather than having different characters — cutting through is a question of which band is free. Auto subdivides when the beat is further apart than the phrase you are trying to place inside it, and thins out when it would be a buzz. This is not the on/off switch.',
  set_record_quantize: 'The grid recorded notes land on as they are played, so a part somebody cannot quite play in time arrives in time and they keep going instead of stopping to tidy up. Not the same as quantizing a clip afterwards — that is an edit you can see and undo, and this happens at the moment of capture. Only note starts move; lengths are kept exactly as held. The combined grids snap to whichever of the straight or triplet line is nearer.',
  set_punch: 'Recording that starts and stops at the loop brace by itself — Punch In waits for the start of the brace, Punch Out stops at the end of it. That is how you replace one phrase in the middle of a take without risking what is either side: you play along from a few bars early and never touch the button. The brace is the punch region, so it is the same span you set for everything else. This only decides when a take would begin and end; it never starts one.',
  audio_to_midi: 'An audio clip to MIDI on a NEW track beside it — the audio stays. Slice cuts the sample at its transients (or its warp markers, or a grid) and makes every slice a pad of a new drum track, with a MIDI clip playing the pads where the slices sit. Convert hears the notes: Harmony keeps every voice, Melody keeps one line, Drums turns the attacks into kick, snare and hat. Local and instant; uncertain notes are counted and said — worth a listen.',
  import_settings: 'How a sample lands when it is dropped or imported — a studio setting, not the song. Short samples (under 30 s) land as unwarped one-shots, as warped loops of whole bars, or Auto decides from the length; long samples are auto-warped straight at the song tempo, or left as they are. Clips already in the song do not change.',
  move_track: 'Moves a track up or down the list, to the top or the bottom, or above or below another track. Only the order changes; nothing about the sound does.',
  'workspace.undoHistory': 'Opens the Undo History — everything that has been done, one row per request, and a way back to any of it in a single click. Two panels answer to the word "history" in this studio: this is what was DONE, and the transcript is what was SAID. "Undo history" and "edit history" mean this one.',
  'workspace.view': 'Switches what the studio shows — the arrangement timeline, the session grid of clips, or the mixer with its faders. The song is untouched.',
  'workspace.zoom': 'Zooms the arrangement in or out, or fits the whole song to the screen — what a hand does with the scroll wheel between two edits.',
  'workspace.scroll': 'Brings a bar or a named section into view without moving the playhead, so you can look at a part of the song while another part plays.',
  'workspace.snap': 'Sets what the grid snaps to — bars, beats, eighths, sixteenths — or turns snapping off for free placement. Only the grid changes.',
  'workspace.overlay': 'Puts an overlay on the arrangement that greys out one kind of thing — what is not loaded, other sections, what is out of key — or clears it.',
  'workspace.sound': 'Opens the Sound panel for a clip, where its own sound settings live — the panel a right-click would open, without the right-click.',
  'workspace.focus': 'Brings a track into view and selects it, so the next "this" means that track. Handy in a long list of tracks.',
  'workspace.command': 'Runs any command the studio offers in its own command palette, by name — hide the sidebar, open the sound library, go to the end of the song. Whatever is in the list is sayable.',
}
