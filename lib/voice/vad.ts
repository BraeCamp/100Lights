// ── Deciding whether anyone is talking ──────────────────────────────────────
//
// Brae: "The voice control doesn't hear me while it's playing."
//
// It could not, and the reason was this file's fault before this file existed.
// The rule was: learn the room from the first half-second, then treat anything
// 2.5x above it as speech. In a quiet room that is exactly right. With the
// transport running, THE ROOM IS THE MUSIC — so the floor was learned as the
// mix, the bar became two and a half times the mix, and nothing a person can
// say from a normal distance ever reached it. The take then failed the "was
// there any speech in this" check and came back "I didn't catch that", which
// reads as a hearing problem and was a maths problem.
//
// Two things follow from that, and both are about the same mistake — treating a
// number learned once as a fact about the world:
//
//   THE FLOOR HAS TO KEEP MOVING. Music is not a constant. A floor measured
//   during an intro is wrong by the first chorus, so it tracks continuously,
//   and only while nobody is talking — otherwise it chases the speech it is
//   supposed to be detecting and the speaker talks themselves into silence.
//
//   THE BAR HAS TO DEPEND ON WHAT IT IS ABOVE. Speech does not get 2.5x louder
//   than a full mix; it adds to it. Over music the useful signal is a modest
//   rise, and demanding a large one is demanding something that never happens.
//
// Pure, and separate from the microphone, because the only way to test any of
// this without a room and a voice is to feed it numbers.

export interface VadOptions {
  /** True while the transport is running — the loud case. */
  playing?: boolean
  /**
   * True when the microphone is being held open across several commands.
   *
   * Brae: "when it's toggled it should listen at a lower, less sensitive level
   * for anything that the user might command."
   *
   * A take that lasts one command can afford to be eager — somebody pressed a
   * button and is about to speak. A microphone held open for minutes cannot:
   * everything said in the room, every cough and every chair, arrives at the
   * same detector, and each false start costs a transcription and possibly a
   * command nobody gave. So the bar goes up, and a rise has to HOLD before it
   * counts as somebody talking.
   */
  continuous?: boolean
  /**
   * A multiplier on how hard it is to trigger, 1 by default.
   *
   * The right value depends on the room, the microphone and how far away the
   * other people are — none of which this can measure. So it is a dial rather
   * than a constant, and the meter draws the bar it produces so somebody can
   * set it by watching their own voice cross it and the room not.
   */
  sensitivity?: number
  /**
   * A multiplier on the silence tail — how long a pause has to last before
   * the sentence is taken as finished. 1 = the standing 1.2 s. Somebody who
   * thinks mid-sentence sets this up; the trigger bar above is left alone.
   * See voicePatience() in speak.ts.
   */
  patience?: number
}

export interface VadState {
  /** The level the room is sitting at, tracked continuously. */
  floor: number
  /** How many samples have gone into the initial estimate. */
  calibrated: number
  /** Has anyone spoken during this take? */
  heard: boolean
  /** When the level was last above the bar. */
  lastLoudAt: number
  /**
   * When the level went above the bar and has NOT dipped once since.
   *
   * Strict on purpose: any sample below the bar clears it. This is the clock
   * that identifies a mix, which sits up without gaps.
   */
  unbrokenSince: number | null
  /**
   * When the level went above the bar allowing for the gaps inside speech.
   *
   * A brief dip does not clear it. This is the clock that identifies a person,
   * who is up most of the time and down between words.
   *
   * Two clocks because they answer two different questions, and one clock
   * answered them both wrongly: strict, and speech could never hold long enough
   * to pass the minimum-duration filter; lenient, and a five-second sentence
   * looked exactly like a chorus arriving and got cut off.
   */
  activeSince: number | null
  /** When it most recently dropped below. Null while it is up. */
  belowSince: number | null
  /** When somebody started talking in this take, so a short command can be
   *  answered quickly and a long one is given room to breathe. */
  spokeSince: number | null
  /** The last sample that cleared the HIGH bar, so the low bar knows how long
   *  it has been holding the gate open on its own. */
  lastOpenAt: number | null
  /**
   * Is a sentence in progress?
   *
   * Separate from `heard`, which records that this take contains speech and
   * must survive to the end so the audio is actually sent. This is the LATCH —
   * the reason the bar is currently on the floor — and it has to be droppable
   * the moment the thing holding it open turns out to be a section of music,
   * without also forgetting that somebody spoke before the chorus arrived.
   */
  latched: boolean
  /**
   * Has this level been judged a sustained one — a section of music rather than
   * a person?
   *
   * Set when the sustained-level rule fires, cleared by a real dip. It exists
   * because clearing the latch once is not enough: while the floor climbs to
   * meet a chorus there is a window where the level no longer clears the rising
   * bar, so the sustained rule stops firing, and the ordinary hysteresis
   * re-opens the gate and re-latches on the very thing that was just identified
   * as music. It went quiet at 3.0s and started "speaking" again at 3.75s.
   */
  sustained: boolean
}

export interface VadStep {
  state: VadState
  /** Is somebody speaking right now? */
  speaking: boolean
  /** Has speech finished — the take can end itself. */
  ended: boolean
  /** The bar this sample was judged against, for the meter and for tests. */
  threshold: number
}

export function newVad(): VadState {
  return {
    floor: 0, calibrated: 0, heard: false, lastLoudAt: 0,
    unbrokenSince: null, activeSince: null, belowSince: null, spokeSince: null,
    lastOpenAt: null, latched: false, sustained: false,
  }
}

/** Samples of the room taken before any judging starts. 10 x 50ms = half a
 *  second, which is long enough to average out a syllable of nothing and short
 *  enough that nobody notices. */
export const CALIBRATION_SAMPLES = 10

/**
 * How far above the floor a sample has to sit to count as speech.
 *
 * Brae: "Make it more sensitive." Three rounds of this, so the numbers moved
 * properly rather than by a notch: 1.7x the room in a quiet one (was 2.5), and
 * 1.2x rather than 1.6x on top of that when the microphone is held open.
 *
 * The reason it can afford to be this low now is everything else that changed
 * around it. The bar only has to catch a word's ONSET, because the latch holds
 * the take open through the rest of it. And it no longer decides whether audio
 * is SENT — anything above the room goes to the recogniser regardless — so the
 * cost of the bar being wrong has gone from "the command is lost" to "the take
 * is cut a moment late".
 *
 * In a quiet room the floor is hiss and a large multiple is safe and correct.
 * Over a mix the floor is the music, and speech ADDS to it rather than
 * multiplying it — a person talking over their own playback raises the meter by
 * something like a quarter, not by a factor of two and a half.
 */
export const RATIO_QUIET = 1.7
export const RATIO_OVER_MUSIC = 1.3

/**
 * How much higher the bar sits when the microphone is held open.
 *
 * Applied on top of whichever ratio is in play, so continuous listening is
 * less sensitive in a quiet room AND over music, without either case having to
 * know about the other.
 */
export const CONTINUOUS_STRICTNESS = 1.2

/**
 * How long a rise has to hold before it is somebody talking.
 *
 * The single most effective filter for a microphone left open: a cough, a
 * chair, a door and a keyboard are all loud and all brief. Speech is not — even
 * one word occupies a couple of hundred milliseconds. Requiring the level to
 * STAY up costs a fifth of a second of responsiveness and removes almost every
 * false start, which is a trade worth making only when the mic is open long
 * enough for false starts to happen. In a single-command take it is zero.
 *
 * 150, not 220. "Play" is a 300ms word whose quiet half sits under the bar, so
 * even with the gate holding through its tail it clears about 200ms — and 220
 * put the requirement ABOVE what the shortest real command can produce, which
 * is how a perfectly clear word ended up discarded as a click. Nothing this
 * filter is aimed at lasts a sixth of a second: a keyboard click is nearer 30ms
 * and a chair creak is not loud enough to open the gate in the first place.
 * Level is what rejects the room; duration only rejects taps.
 */
export const MIN_SPEECH_MS_CONTINUOUS = 150

/**
 * How long the level must stay down before the rise before it is forgotten.
 *
 * Speech is not a plateau, it is a picket fence: the meter drops between words
 * and between syllables, several times a second. Treating any single dip as the
 * end of the rise made the minimum-duration filter above impossible to satisfy
 * BY SPEECH — every word restarted the clock, so a person talking never held
 * long enough to count while a steady tone would have.
 *
 * A fifth of a second is longer than the gaps inside a sentence and far shorter
 * than the pause between one command and the next, so it joins up words without
 * joining up commands.
 */
const DIP_GRACE_MS = 200

/**
 * Below this, nothing counts as speech however quiet the room is — otherwise a
 * silent room triggers on its own noise floor.
 *
 * 0.004, not 0.012. It is a HARD floor that no amount of calibration can get
 * under, and at 0.012 it was the binding constraint on a quiet input: somebody
 * whose microphone runs at a low gain could calibrate all day and never move
 * the bar, because the bar was not being set by the calibration at all. The
 * measured floor is a far better guard than a constant, and it is what does the
 * work now; this is only here to stop a truly silent room dividing by its own
 * hiss.
 */
export const MIN_SPEECH_LEVEL = 0.004

/**
 * The bar never sits closer to the room than this multiple of it.
 *
 * With the ratios lowered and calibration aiming just above the floor, a noisy
 * room could otherwise put the bar within a few percent of its own tone — and
 * then the room crosses it constantly. That costs less than it used to, since a
 * take no longer has to be recognised as speech to be sent, but "costs less"
 * is not "is free": every false crossing is a clip transcribed to be told there
 * were no words in it.
 *
 * A quarter above the room is the least that still means anything.
 */
export const MIN_TRIGGER_MARGIN = 1.25

/**
 * How far above the room something has to rise before the clip is worth sending.
 *
 * A quarter — the same margin, for a different question. Deliberately far below
 * anything this file would call speech: it is not "was that a word", it is "did
 * anything happen at all", and the only thing it exists to exclude is a
 * recording of an untouched room.
 */
export const SEND_MARGIN = 1.25

/**
 * Should this clip go to the recogniser?
 *
 * Brae: "It works for hard letters like 'check check', but not 'start'... I
 * think we need to remove the volume gate and try it."
 *
 * He was right, and this is the line that mattered. Whether audio was SENT used
 * to be the same question as whether this file recognised speech in it — and
 * those are not the same question at all. On the other end of the wire is a
 * speech recogniser; on this end is a number compared against a moving average.
 * Deciding here that a recording contains no words, and discarding it unheard,
 * is the one judgement we are worst equipped to make.
 *
 * "Check" is two hard transients and clears any bar. "Start" opens on a
 * sibilant and closes on a soft t, never spikes, and was thrown away — a word
 * the microphone had captured perfectly and a recogniser would have read
 * instantly.
 *
 * So the detector keeps the job it is good at, deciding WHEN to cut, and loses
 * the veto. Being wrong now costs one transcription that comes back empty.
 */
export function worthSending(peak: number, floor: number, heardSpeech = false): boolean {
  if (heardSpeech) return true
  return peak > Math.max(floor, 0) * SEND_MARGIN && peak > 0
}

/**
 * Where the gate closes, as a fraction of the way from the floor to the bar it
 * opened at.
 *
 * Half. Low enough that the decay of an ordinary word stays inside it, high
 * enough that room tone does not hold the gate open once the talking stops —
 * and the gate can only be held open by something that already crossed the high
 * bar, so a room that never reaches it is never listened to at all.
 */
export const RELEASE_FRACTION = 0.5

/** The release bar never sits closer to the floor than this multiple of it, so
 *  a very low bar in a silent room does not collapse onto the room itself. */
export const FLOOR_MARGIN = 1.15

/**
 * How long the low bar may hold the gate open once the level has left the high
 * one.
 *
 * A hysteretic gate with no time limit is a gate that a mix can hold open
 * forever: a chorus sitting between the two bars never re-triggers the high one
 * and never falls under the low one, so the floor stops following it, the take
 * never ends, and the studio decides a song is a very long sentence. The test
 * for that already existed and caught this within a minute of the change.
 *
 * What separates the two is how long it lasts. The tail of a word is a decay —
 * a few hundred milliseconds and gone. Anything still sitting in the band after
 * that is not a tail, so the gate lets go and the ordinary rules resume.
 */
export const RELEASE_HOLD_MS = 400

/**
 * Where the bar goes once somebody is definitely talking.
 *
 * Brae, after the two-bar gate still was not enough: "It still can't understand
 * me. I think there's a volume cutoff. Can we get rid of that while I'm talking
 * and add it again once there hasn't been talking for 2-4 seconds?"
 *
 * He is right, and it is a different thing from a lower bar. A gate — however
 * many bars it has — asks the same question of every sample: is THIS loud
 * enough. Speech does not work like that. Once somebody has started a sentence,
 * everything until they finish it belongs to that sentence: the unvoiced
 * consonants, the trailing vowels, the breath between clauses. None of it is
 * loud, and all of it is speech.
 *
 * So once the take has latched, the bar drops to just above the room — enough
 * to tell talking from not-talking, not enough to tell loud from quiet. The
 * cutoff comes back when the take ends, which is what re-arms it.
 */
export const PRESENCE_FRACTION = 0.15

/**
 * How long a gap ends the take.
 *
 * 2.2s for a sentence — Brae's "2-4 seconds", at the responsive end of it. The
 * old 1.1s cut people off mid-thought: "add a descending low pass filter to…"
 * then a pause to decide which track, and the two halves arrive as separate
 * takes that are both nonsense. A pause inside a sentence is longer than people
 * think it is, and the cost of waiting is a second of latency on a command that
 * is already finished, while the cost of cutting is having to say it all again.
 *
 * Note this only applies to a sentence. One word still ends in SILENCE_MS_SHORT
 * below, because somebody who says "stop" is finished when it stops — and
 * making THAT wait two seconds was a complaint of its own.
 *
 * Longer again over music, where the level falls back to a moving target rather
 * than to silence and the decision is noisier.
 */
// ⚠️ 1,200, DOWN FROM 2,200 — Brae: "Let's do the biggest lever." This wait was
// the single largest delay between a sentence ending and anything happening,
// longer than the model turn itself. It was long for a reason ("when I talk
// more slowly it thinks that I'm saying different sentences"), and shortening
// it means a slow speaker's pause WILL cut a sentence in half more often. That
// is now handled where the words are rather than by waiting: a fragment that
// trails off ("on pad intro…") is held quietly and joined to what follows, for
// up to six seconds, before anybody is asked anything. See lib/voice/stitch.
export const SILENCE_MS = 1200
export const SILENCE_MS_PLAYING = 1500

/**
 * How long a burst has to be before it might be a SENTENCE.
 *
 * Brae: "When I said 'stop', it didn't recognize it as a command for 6 or 7
 * seconds. When I say stop, it should almost immediately stop it."
 *
 * A second and a half of silence before believing somebody has finished is
 * right for a sentence — people pause to think mid-instruction, and cutting
 * them off there loses the end of the command. It is absurd for the word
 * "stop", which was over before the timer started.
 *
 * So the wait depends on what was said. A burst under this long cannot have
 * been a sentence with a pause in it; it was one word, and one word is finished
 * when it stops.
 */
export const SHORT_UTTERANCE_MS = 900

/** The wait after a short burst. Long enough to not clip "stop it", short
 *  enough to feel like a button. */
export const SILENCE_MS_SHORT = 420
export const SILENCE_MS_SHORT_PLAYING = 550

/** How fast the floor follows the room while nobody is talking. Slow enough
 *  that a held note does not become the new floor; fast enough to keep up with
 *  a song. */
const FLOOR_FOLLOW = 0.02

/**
 * How long a level may stay up before it stops being speech and starts being
 * the room.
 *
 * Freezing the floor while somebody talks is right, and on its own it cannot
 * tell a sentence from a chorus arriving — both are "the level went up and
 * stayed up", so a drop landing would be heard as a very long word and the
 * floor would never catch up to the new section.
 *
 * What separates them is not loudness, it is SHAPE. Speech is gaps: between
 * words, between syllables, to breathe. The meter falls back below the bar
 * several times a second and any one of those dips is enough to say a person is
 * still there. Music does not do that — a mix sits up.
 *
 * So a level that stays up for two and a half seconds without ever dipping is
 * not a person talking, whatever its level. It is the new floor, and it is
 * treated as one.
 */
export const SUSTAINED_MS = 2500

/**
 * One sample of the meter.
 *
 * Returns a new state rather than mutating, so a test can replay a whole take
 * and a caller cannot half-update it.
 */
export function vadStep(
  state: VadState,
  rms: number,
  now: number,
  opts: VadOptions = {},
): VadStep {
  // ── The first half-second is the room, whatever the room is ──────────────
  if (state.calibrated < CALIBRATION_SAMPLES) {
    const floor = (state.floor * state.calibrated + rms) / (state.calibrated + 1)
    return {
      state: { ...state, floor, calibrated: state.calibrated + 1 },
      speaking: false,
      ended: false,
      threshold: Infinity,
    }
  }

  // ── How far above the floor speech has to sit ────────────────────────────
  //
  // Strictness scales the EXCESS over the floor, not the whole threshold, and
  // the difference is the whole feature over music. Multiplying the threshold
  // put the bar at 2.08x the mix — around the same ratio a quiet room asks for,
  // which is a level nobody reaches by talking over their own playback. It is
  // the arithmetic behind "it's having trouble hearing me": the bar was set
  // where a shout would be.
  //
  // Scaling the excess keeps the shape right in both worlds. In a quiet room
  // the floor is hiss and the excess is nearly everything, so strictness still
  // bites hard. Over a mix the excess is a modest rise, and being firmer about
  // it stays modest.
  const ratio = opts.playing ? RATIO_OVER_MUSIC : RATIO_QUIET
  const strictness = (opts.continuous ? CONTINUOUS_STRICTNESS : 1)
    * (opts.sensitivity && opts.sensitivity > 0 ? opts.sensitivity : 1)
  const threshold = Math.max(
    MIN_SPEECH_LEVEL,
    state.floor * MIN_TRIGGER_MARGIN,
    state.floor * (1 + (ratio - 1) * strictness),
  )

  // ── Two bars, because it is a gate ───────────────────────────────────────
  //
  // Brae: "I think that it cuts off the quieter last part of my words because
  // of the sound limiter." That is exactly what it was, and one threshold was
  // doing two different jobs: deciding a word had STARTED, and deciding it was
  // still GOING. Those want different bars, and every noise gate ever built
  // uses two.
  //
  // "Play" is about 300ms — a hard attack on the P, then a decay through the
  // vowel. In a silent room the bar bottoms out at MIN_SPEECH_LEVEL and the
  // tail clears it by luck. In a real room, with a fan or a street outside, the
  // floor lifts the bar into the MIDDLE of the word, and the second half of
  // every short command falls underneath it. The consequences were worse than a
  // clipped tail: the loud part alone could not hold out for
  // MIN_SPEECH_MS_CONTINUOUS, so `heard` was never set, so the take was never
  // cut, so the audio was thrown away by the idle reset — and the studio
  // answered "I didn't catch that" to a word it had recorded perfectly.
  //
  // So: cross the high bar to open, fall below the LOW one to close. The tail
  // of a word holds the gate open, counts towards the minimum duration, and
  // keeps the silence clock from starting at the loudest moment instead of at
  // the end of the word.
  // Three bars, and which one applies says what the studio currently believes.
  //
  //   threshold  somebody might be starting to talk
  //   release    a word is still going (its tail, its decay)
  //   presence   somebody is mid-sentence and has not stopped
  //
  // The last one is the latch. Once a take has heard speech, measuring loudness
  // is the wrong question — the only question left is whether they have
  // stopped — so the bar drops to just above the room until the take ends.
  const release = Math.max(state.floor * FLOOR_MARGIN, state.floor + (threshold - state.floor) * RELEASE_FRACTION)
  const presence = Math.max(state.floor * FLOOR_MARGIN, state.floor + (threshold - state.floor) * PRESENCE_FRACTION)
  const opening = rms > threshold
  // Already open — within the dip grace that carries the gate across a word
  // boundary — still above the low bar, and not held there for longer than a
  // word's tail could last. `opening` alone stays the test for everything that
  // decides what KIND of sound this is; only the gate is hysteretic.
  const held = !state.sustained
    && state.activeSince != null
    && state.lastOpenAt != null
    && now - state.lastOpenAt <= RELEASE_HOLD_MS
  // The time limit is deliberately NOT applied once latched. It exists so a mix
  // sitting between the bars cannot hold the gate open forever, and a mix
  // cannot latch: latching needs a rise that clears the high bar, and a mix
  // that does that becomes the floor within SUSTAINED_MS and stops clearing it.
  const latched = !state.sustained && state.latched && rms > presence
  const above = opening || latched || (held && rms > release)

  if (above) {
    // Strictly the high bar. This clock is the music test — a mix sits up
    // without gaps — and judging it against the low bar would let a mix hold it
    // open through its own dips and never be recognised as a mix.
    const unbrokenSince = opening ? (state.unbrokenSince ?? now) : null
    const activeSince = state.activeSince ?? now
    const base = {
      ...state, unbrokenSince, activeSince, belowSince: null,
      lastOpenAt: opening ? now : state.lastOpenAt,
    }

    // Up for this long without a single dip: a section, not a sentence. The
    // level becomes the floor — quickly, because until it does, everything else
    // is judged against a bar belonging to a quieter part of the song.
    // `unbrokenSince != null` explicitly, not `now - unbrokenSince`. It is null
    // whenever the gate is being held open by the low bar, and `now - null` is
    // `now` — which passes this test in any session older than two and a half
    // seconds. Every quiet word-tail would have been read as a section of music
    // and pulled the floor up under the speaker. The fixtures missed it because
    // they speak in the first second; the test below speaks a minute in.
    if (unbrokenSince != null && now - unbrokenSince > SUSTAINED_MS) {
      return {
        // The latch goes with it. Whatever this is, it has been up without a
        // gap for longer than a person can talk without one, so it is a section
        // of music — and a latch held open by music is a take that never ends.
        // `heard` is deliberately left alone: somebody may well have said
        // something before the chorus landed, and that take still has to be
        // sent.
        state: {
          ...base,
          latched: false,
          sustained: true,
          floor: state.floor * (1 - FLOOR_FOLLOW * 4) + rms * FLOOR_FOLLOW * 4,
        },
        speaking: false,
        ended: false,
        threshold,
      }
    }
    // Loud, but not yet for long enough to be a word. Nothing is decided: the
    // clock keeps running, the floor stays put, and if it holds it becomes
    // speech on a later sample.
    if (opts.continuous && now - activeSince < MIN_SPEECH_MS_CONTINUOUS) {
      return { state: base, speaking: false, ended: false, threshold }
    }
    return {
      // The floor is not updated while somebody is actually ABOVE the bar:
      // following the level while they talk raises it under them until they
      // fall below it, and the symptom of that is a speaker cut off
      // mid-sentence.
      //
      // It IS updated, slowly, while the latch is holding the take open on
      // something quieter than the bar. Without that, a latch is a trap: a
      // sustained tone that clears the high bar once — a chorus arriving — then
      // sits above the presence bar forever, and with the floor frozen it can
      // never rise to release it. The take runs until the recorder gives up.
      // Following here is safe precisely because it only happens while the
      // level is BELOW the speaking bar, which is where the room lives anyway.
      state: {
        ...base,
        floor: opening ? state.floor : state.floor * (1 - FLOOR_FOLLOW) + rms * FLOOR_FOLLOW,
        heard: true,
        latched: true,
        lastLoudAt: now,
        spokeSince: state.spokeSince ?? now,
      },
      speaking: true,
      ended: false,
      threshold,
    }
  }

  const floor = state.floor * (1 - FLOOR_FOLLOW) + rms * FLOOR_FOLLOW
  // How long they talked for decides how long to wait before believing they
  // stopped. One word is finished when it stops; a sentence gets room to pause.
  const burst = state.spokeSince ? state.lastLoudAt - state.spokeSince : 0
  const short = state.heard && burst < SHORT_UTTERANCE_MS
  // The tail stretches with patience — a thinking pause is not the end of a
  // sentence for everybody. The one-word case stays quick: "stop" is over.
  const patience = opts.patience && opts.patience > 0 ? Math.max(0.5, Math.min(3, opts.patience)) : 1
  const gap = short
    ? (opts.playing ? SILENCE_MS_SHORT_PLAYING : SILENCE_MS_SHORT)
    : (opts.playing ? SILENCE_MS_PLAYING : SILENCE_MS) * patience
  const ended = state.heard && now - state.lastLoudAt > gap
  // A dip only ends the rise once it has lasted longer than the gaps inside
  // speech. Anything shorter is a word boundary, and the rise continues through
  // it.
  const belowSince = state.belowSince ?? now
  const activeSince = now - belowSince > DIP_GRACE_MS ? null : state.activeSince
  return {
    // Any dip at all breaks the unbroken clock — that is what makes it a test
    // for music. The lenient one survives a word boundary.
    state: {
      ...state, floor, unbrokenSince: null, activeSince, belowSince,
      // Cleared by a genuine dip — down to near the room — not merely by
      // falling under the bar. Those are different events, and using the wrong
      // one put this straight back where it started: while the floor climbs to
      // meet a chorus, the mix IS under the (rising) bar the whole way, so
      // every sample of it looked like a dip and re-armed the latch on the
      // music it had just identified.
      sustained: rms > presence ? state.sustained : false,
    },
    speaking: false,
    ended,
    threshold,
  }
}
