// Vocal clarity — a small DSP chain that makes a vocal (or dialogue) audio item clearer and more
// present, without a plugin. Works in any Web Audio context, so ONE builder serves both the offline
// export mix and the live preview. Everything scales with `amount` (0..1), so it can go from a gentle
// polish to a strong "podcast voice".
//
// Chain (in order): high-pass (kill rumble) → low-mid dip (de-mud/boxiness) → presence boost
// (2–4 kHz intelligibility) → de-ess (tame ~7 kHz sibilance) → air shelf → gentle compressor (even out
// level) → makeup gain. A true de-esser is dynamic; the static ~7 kHz dip here is a good, cheap
// approximation that noticeably reduces harshness.

export interface VocalClarityChain { input: AudioNode; output: AudioNode }

export function buildVocalClarityChain(ctx: BaseAudioContext, amount = 1): VocalClarityChain {
  const a = Math.max(0, Math.min(1, amount))

  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 350; mud.Q.value = 1.0; mud.gain.value = -2.5 * a
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 0.8; presence.gain.value = 4.5 * a
  const deEss = ctx.createBiquadFilter(); deEss.type = 'peaking'; deEss.frequency.value = 7200; deEss.Q.value = 2.4; deEss.gain.value = -3.0 * a
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 10500; air.gain.value = 2.0 * a

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -22; comp.knee.value = 6; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15

  // Compensate for the gain the compressor pulls down, so the vocal comes out a touch louder + fuller.
  const makeup = ctx.createGain(); makeup.gain.value = Math.pow(10, (2.5 * a) / 20)

  hp.connect(mud); mud.connect(presence); presence.connect(deEss); deEss.connect(air); air.connect(comp); comp.connect(makeup)
  return { input: hp, output: makeup }
}
