// Apollo factory presets: built programmatically from the init patch.

import { ApolloPatch, initPatch, defaultFx, uid, ModSource } from '@/lib/apollo/patch'

function route(source: ModSource, dest: string, amount: number, bipolar = false) {
  return { id: uid(), source, dest, amount, bipolar, aux: 'none' as ModSource, auxAmount: 0, curve: null, bypass: false }
}

function make(name: string, build: (p: ApolloPatch) => void): { name: string; patch: ApolloPatch } {
  const p = initPatch()
  p.name = name
  build(p)
  return { name, patch: p }
}

export const FACTORY_PRESETS: { name: string; patch: ApolloPatch }[] = [
  make('Init', () => { /* stock */ }),

  make('Analog Bass', p => {
    p.oscs[0].wt.tableId = 'analog-saws'
    p.oscs[0].unison = 3
    p.oscs[0].detune = 0.08
    p.oscs[0].octave = -1
    p.sub.enabled = true
    p.sub.octave = -1
    p.sub.level = 0.6
    p.filters[0].enabled = true
    p.filters[0].type = 'ladder24'
    p.filters[0].cutoff = 0.45
    p.filters[0].res = 0.25
    p.filters[0].drive = 0.3
    p.envs[1].decay = 0.35
    p.matrix.push(route('env2', 'f1.cutoff', 0.45))
    p.matrix.push(route('vel', 'osc0.level', 0.3))
  }),

  make('PWM Strings', p => {
    p.oscs[0].wt.tableId = 'pwm'
    p.oscs[0].unison = 7
    p.oscs[0].detune = 0.22
    p.envs[0].attack = 0.4
    p.envs[0].release = 0.9
    p.filters[0].enabled = true
    p.filters[0].type = 'lp12'
    p.filters[0].cutoff = 0.68
    p.matrix.push(route('lfo1', 'osc0.wt.pos', 0.35))
    p.lfos[0].sync = false
    p.lfos[0].rate = 0.5
    p.fxMain.push(defaultFx('chorus'))
    const rv = defaultFx('reverb'); rv.mix = 0.35; rv.params.decay = 0.6
    p.fxMain.push(rv)
  }),

  make('Vocal Pad', p => {
    p.oscs[0].wt.tableId = 'vocal'
    p.oscs[0].unison = 5
    p.oscs[0].detune = 0.14
    p.envs[0].attack = 0.7
    p.envs[0].release = 1.6
    p.filters[0].enabled = true
    p.filters[0].type = 'formant'
    p.filters[0].cutoff = 0.5
    p.filters[0].res = 0.4
    p.matrix.push(route('lfo1', 'osc0.wt.pos', 0.5))
    p.matrix.push(route('lfo2', 'f1.fat', 0.4))
    p.lfos[1].syncRate = 3
    const rv = defaultFx('reverb'); rv.mix = 0.45; rv.params.mode = 0; rv.params.size = 0.8; rv.params.decay = 0.75
    p.fxMain.push(rv)
  }),

  make('FM Pluck', p => {
    p.oscs[0].wt.tableId = 'fm-scan'
    p.oscs[1].enabled = true
    p.oscs[1].wt.tableId = 'basic-shapes'
    p.oscs[1].level = 0
    p.oscs[0].wt.warp1 = { mode: 'fm', amount: 0.4 }
    p.oscs[0].wt.fmSource = 1
    p.envs[0].decay = 0.5
    p.envs[0].sustain = 0
    p.envs[1].decay = 0.25
    p.matrix.push(route('env2', 'osc0.wt.warp1.amount', 0.5))
    const dl = defaultFx('delay'); dl.mix = 0.28; dl.params.pingpong = 1
    p.fxMain.push(dl)
  }),

  make('Organ', p => {
    p.oscs[0].wt.tableId = 'organ'
    p.oscs[0].unison = 2
    p.oscs[0].detune = 0.05
    p.envs[0].attack = 0.005
    p.envs[0].sustain = 1
    p.envs[0].release = 0.08
    const ch = defaultFx('chorus'); ch.params.rate = 4; ch.params.depth = 0.25
    p.fxMain.push(ch)
    const dr = defaultFx('distortion'); dr.params.mode = 11; dr.params.drive = 0.15; dr.mix = 0.5
    p.fxMain.push(dr)
  }),

  make('Hyper Saw', p => {
    p.oscs[0].wt.tableId = 'analog-saws'
    p.oscs[0].unison = 16
    p.oscs[0].detune = 0.3
    p.oscs[0].blend = 0.8
    p.filters[0].enabled = true
    p.filters[0].type = 'hp12'
    p.filters[0].cutoff = 0.18
    p.fxMain.push(defaultFx('hyper'))
    const rv = defaultFx('reverb'); rv.mix = 0.3; rv.params.mode = 3
    p.fxBus1.push(rv)
    p.oscs[0].bus = 'main'
  }),

  make('Sub Drone', p => {
    p.oscs[0].wt.tableId = 'sub-fold'
    p.oscs[0].octave = -2
    p.oscs[0].unison = 2
    p.envs[0].attack = 1.2
    p.envs[0].release = 2.5
    p.sub.enabled = true
    p.sub.octave = -2
    p.matrix.push(route('lfo1', 'osc0.wt.warp1.amount', 0.4))
    p.oscs[0].wt.warp1 = { mode: 'bendPlus', amount: 0.2 }
    p.lfos[0].sync = false
    p.lfos[0].rate = 0.15
    const cv = defaultFx('convolve'); cv.mix = 0.35; cv.params.ir = 2
    p.fxMain.push(cv)
  }),

  make('Bell Keys', p => {
    p.oscs[0].wt.tableId = 'bells'
    p.envs[0].decay = 1.8
    p.envs[0].sustain = 0
    p.envs[0].release = 1.2
    const eb = defaultFx('echobode'); eb.mix = 0.25; eb.params.shift = 90
    p.fxMain.push(eb)
    const cv = defaultFx('convolve'); cv.mix = 0.3; cv.params.ir = 1
    p.fxMain.push(cv)
  }),

  make('Acid Line', p => {
    p.oscs[0].wt.tableId = 'squares-morph'
    p.filters[0].enabled = true
    p.filters[0].type = 'ladder24'
    p.filters[0].cutoff = 0.3
    p.filters[0].res = 0.62
    p.filters[0].drive = 0.4
    p.envs[1].decay = 0.18
    p.matrix.push(route('env2', 'f1.cutoff', 0.55))
    p.matrix.push(route('modwheel', 'f1.cutoff', 0.3))
    p.arp.on = true
    p.arp.mode = 'up'
    p.arp.syncRate = 13
    p.arp.octaves = 2
    const dist = defaultFx('distortion'); dist.params.mode = 0; dist.params.drive = 0.35; dist.mix = 0.6
    p.fxMain.push(dist)
    const dl = defaultFx('delay'); dl.mix = 0.22; dl.params.pingpong = 1; dl.params.timeL = 11; dl.params.timeR = 11
    p.fxMain.push(dl)
  }),

  make('Glitter Granules', p => {
    p.oscs[0].engine = 'granular'
    p.oscs[0].gran.density = 32
    p.oscs[0].gran.length = 120
    p.oscs[0].gran.spray = 0.18
    p.oscs[0].gran.pitchRand = 7
    p.oscs[0].gran.panRand = 0.7
    p.envs[0].attack = 0.5
    p.envs[0].release = 1.8
    const rv = defaultFx('reverb'); rv.mix = 0.4; rv.params.mode = 4; rv.params.decay = 0.8
    p.fxMain.push(rv)
    // needs a sample loaded by the user — engine stays silent until then
  }),
]
