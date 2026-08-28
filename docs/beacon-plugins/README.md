# Beacon plugins

Beacon can load plugins two different ways, and the difference is not a
detail — it decides what a plugin can be.

| | **Beacon plugins** | **Native plugins** |
| --- | --- | --- |
| What they are | a manifest + an AudioWorklet (+ optional WASM) | AU and VST3 you already own |
| Where they run | in the page | in the Beacon Bridge, a helper process |
| Works in a browser | yes, with nothing installed | only if the bridge is installed |
| Latency | none beyond the audio context | a buffer, ~85 ms by default |
| Who can write one | anyone, no build step required | anyone with a plugin SDK |

A browser cannot load an Audio Unit or a VST3. Not "does not yet" — the
sandbox forbids running arbitrary native code, and no amount of engineering
changes that. So Beacon has its own web-native format, and reaches real
plugins through a separate process when one is available.

---

## Writing a Beacon plugin

A plugin is a folder with a manifest in it. The smallest useful one:

```
my-synth/
  beacon-plugin.json
  processor.js
```

`public/plugins/app.100lights.example/` is a complete, working example — about
300 lines of plain JavaScript, no build step. Copy it.

### The manifest

```json
{
  "formatVersion": 1,
  "id": "com.yourname.mysynth",
  "name": "My Synth",
  "vendor": "Your Name",
  "version": "1.0.0",
  "kind": "instrument",
  "processor": "processor.js",
  "processorName": "my-synth",
  "outputs": 2,
  "parameters": [
    { "kind": "float", "id": "cutoff", "name": "Cutoff",
      "min": 30, "max": 18000, "default": 2400, "unit": "Hz", "curve": "log" }
  ]
}
```

`id` is what a saved project stores, so it is permanent. `processorName` must
match what your code passes to `registerProcessor` — Beacon looks the processor
up by the manifest's name, so a mismatch loads fine in a test and silently
fails in the page.

Parameter kinds are `float`, `int`, `bool` and `choice`. `group` sorts them
into sections in the generated panel; `curve` (`linear`, `log`, `exp`) decides
how the knob maps position to value, which is the difference between a usable
frequency control and one bunched at the bottom.

### The processor

An ordinary `AudioWorkletProcessor` that speaks a small message protocol.

**Host → processor**

| message | when |
| --- | --- |
| `init` | once, first. Carries `sampleRate`, the initial `values`, and `wasmBinary` if the manifest declares one |
| `note` | `{ on, pitch, velocity, time }` — `time` is an **absolute AudioContext time** |
| `param` / `params` | a control moved |
| `transport` | `{ bpm, playing }` |
| `state` / `requestState` | opaque state you asked to keep |
| `panic` | stop everything now |

**Processor → host**

| message | when |
| --- | --- |
| `ready` | after `init`. Beacon queues everything until this arrives — if you never send it, your plugin is silent forever |
| `meter` | `{ peak }`, a few times a second |
| `state` | in reply to `requestState` |
| `error` | anything the user should know about |

### Three things that will bite you

**A worklet has no `fetch`.** There is no network in an
`AudioWorkletGlobalScope` at all. If your plugin needs a WASM binary, declare
it in the manifest and Beacon will fetch it and hand you the bytes in `init`.
A processor that tries to load its own is simply never heard from again.

**Schedule by time, not by timer.** Note events carry an absolute
`AudioContext` time. Apply them at the right sample inside the render quantum,
not at the start of the block. If you use `setTimeout`, an offline bounce will
not match what you heard, and fast passages will smear by up to 2.7 ms.

**Never return `false` from `process()`.** That destroys the node while the
host is still holding it. Return `true` always; Beacon disconnects when it is
finished with you.

### Testing without a browser

```sh
node scripts/beacon-plugin-render.mjs app.100lights.example --out /tmp/out.wav
node scripts/beacon-plugin-render.mjs my-synth --preset "Deep Bass" --notes 36
node scripts/beacon-plugin-render.mjs my-synth --set cutoff=800 --raw /tmp/out.f32
```

It stubs the worklet global scope and runs your real processor, so it exercises
the same code path the page does — including the `processorName` check, which
is otherwise invisible until the plugin fails to appear.

### Installing one

Built-in plugins live in `public/plugins/<id>/`. Anything else is added by URL
on the plugin picker; the URL is remembered locally. A manifest served from
another origin needs CORS.

---

## Luz: the same engine on both sides

`public/plugins/app.100lights.luz/` is the Aurora engine from the Luz
AU/VST3/CLAP plugin, compiled to WebAssembly.

Its DSP headers are shared *verbatim* with the native plugin. A ~300-line shim
(`wasm/shim-include` in the Luz project) supplies the small slice of JUCE they
reference, so there is no forked DSP to drift.

`wasm/parity.sh` proves it: it renders the same notes natively and through the
real worklet and compares them sample for sample. They are not bit identical —
wasm and native use different libm implementations and contract multiply-adds
differently — but the difference sits at −110 to −120 dB through the sustained
part of a note, rising only in the reverb tail where a feedback network
amplifies rounding. A logic difference shows up immediately and far louder.

To rebuild it:

```sh
cd ~/Desktop/Plugins/Luz
wasm/build.sh                      # -> wasm/dist/{luz.wasm, luz-worklet.js, beacon-plugin.json}
wasm/parity.sh                     # prove it still matches the plug-in
```

The manifest is generated from the same parameter table the engine applies, so
it cannot disagree with the code about a name, a range or a default.

---

## The Beacon Bridge

`bridge/` is a small JUCE application that hosts real Audio Units and VST3s and
talks to Beacon over a WebSocket on loopback.

```sh
cmake -B bridge/build -S bridge -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build bridge/build
open "bridge/build/BeaconBridge_artefacts/Release/Beacon Bridge.app"
node bridge/test-bridge.mjs          # scans, loads a plugin, renders a note
```

### It never opens an audio device

Beacon asks for N frames, the bridge renders exactly N frames, and the browser
mixes them with everything else. Letting the bridge play its own audio would
put the plugins on a different clock from the rest of the session — they could
never stay in time with it, and an offline bounce could not include them at
all.

The same pull model serves live playback (Beacon keeps a few blocks ahead of
the playhead) and rendering a mixdown (Beacon pulls as fast as the bridge can
go), so there is no separate offline path that can be true when the live one is
not.

The cost is latency: the ring buffer is about 85 ms at 48 kHz by default.
`BridgeVoice.getLatencyMs()` reports it so the UI can say so.

### Security

The bridge loads native code, so the gate matters.

- It binds **loopback only**. Never `0.0.0.0`.
- Browser connections are checked against an **Origin allowlist**. A browser
  cannot forge `Origin`, so this is what stops an arbitrary web page from
  driving your plugins.
- Connections with no `Origin` — the desktop app — must present a **token**
  written to a file only a local user can read.
- Scanning is restricted to the **standard plugin folders**. The process will
  load native code from wherever it is pointed, so it is not pointed anywhere
  else.

### Formats

Audio Units and VST3. **CLAP hosting is not included**: JUCE has no CLAP host
format and writing one is its own project. Beacon's own plugins cover the
"runs anywhere" case, so the gap is narrow. VST2 is deliberately absent — it
needs Steinberg's withdrawn SDK and cannot be shipped.

### On the desktop

The Electron app starts the bridge lazily and stops it on quit
(`electron/src/bridge.ts`). Someone who never opens a plugin never has a second
process. The renderer then talks to it over the same WebSocket the browser
uses, so there is one code path for both.

---

## How a plugin reaches the DAW

```
InstrumentPicker  ->  type: 'plugin'
                        |
                  PluginPanel  (picker, then controls generated from the manifest)
                        |
        lib/beacon-plugins/registry.ts   what exists: builtin | url | bridge
                        |
        lib/beacon-plugins/host.ts       one worklet per (context, track bus)
                        |
             lib/daw-instruments.ts      playPluginNote(...)
```

Track state is a `PluginInstrumentParams`: a plugin id, sparse parameter
values, and an optional opaque `state` string. Small and portable, so a project
file stays readable.

Plugin parameters are automatable as `plugin:{paramId}`, alongside the existing
`apollo:` and `fx:` routes.
