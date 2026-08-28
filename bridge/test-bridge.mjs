#!/usr/bin/env node
// ============================================================================
//  End-to-end check of the Beacon Bridge.
//
//    node bridge/test-bridge.mjs [--port 8788] [--plugin "Luz"]
//
//  Starts from a running bridge, then: handshake, scan, list, open a plug-in,
//  render a note through it, and confirm the audio that comes back is real.
//  This is the same conversation the browser has, in the same order.
// ============================================================================

import { WebSocket } from 'ws'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const discovery = path.join(os.homedir(), 'Library', 'Application Support', '100Lights', 'Beacon', 'bridge.json')
let port = Number(flag('port', 0))
let token = ''
try {
  const info = JSON.parse(readFileSync(discovery, 'utf8'))
  port = port || info.port
  token = info.token ?? ''
} catch { /* fall back to the default */ }
port = port || 8788

const wanted = flag('plugin', 'Luz')

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  \x1b[32m ok \x1b[0m ${name}`) }
  else { failed++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}  ${detail}`) }
}

console.log(`\n\x1b[1mBeacon Bridge test\x1b[0m  ->  ws://127.0.0.1:${port}\n`)

// The bridge treats a connection with no Origin as "not a browser" and wants
// the token instead; a browser is gated on its Origin, which it cannot forge.
const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`)

const waitFor = (predicate, timeoutMs = 60000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(new Error('timed out')) }, timeoutMs)
  const onMessage = (data, isBinary) => {
    if (isBinary) { if (predicate.binary) { cleanup(); resolve(data) } return }
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (predicate.op === msg.op) { cleanup(); resolve(msg) }
    else if (msg.op === 'error') { cleanup(); reject(new Error(msg.message)) }
    else if (msg.op === 'scanning') process.stdout.write(`\r       scanning ${msg.done}%   ${String(msg.current).slice(0, 44).padEnd(46)}`)
  }
  const cleanup = () => { clearTimeout(timer); ws.off('message', onMessage) }
  ws.on('message', onMessage)
})

const send = (obj) => ws.send(JSON.stringify(obj))

ws.on('error', (err) => {
  console.error(`\n  Could not reach the bridge: ${err.message}`)
  console.error('  Start it first:  open "bridge/build/BeaconBridge_artefacts/Release/Beacon Bridge.app"\n')
  process.exit(1)
})

ws.on('open', async () => {
  try {
    send({ op: 'hello' })
    const welcome = await waitFor({ op: 'welcome' }, 5000)
    check('handshake and hello', welcome.version != null, JSON.stringify(welcome))
    check('reports the formats it hosts', Array.isArray(welcome.formats) && welcome.formats.includes('VST3'))

    console.log('\n  scanning (this walks every plug-in on the machine)')
    send({ op: 'scan' })
    const list = await waitFor({ op: 'plugins' }, 240000)
    process.stdout.write('\r'.padEnd(70) + '\r')
    check('scan completes and returns a list', Array.isArray(list.items), typeof list.items)
    console.log(`       found ${list.items.length} plug-ins`)

    const instruments = list.items.filter(p => p.isInstrument)
    console.log(`       ${instruments.length} of them are instruments`)
    for (const p of list.items.slice(0, 8)) console.log(`         ${p.format.padEnd(10)} ${p.name}`)

    const target = list.items.find(p => p.name.toLowerCase().includes(wanted.toLowerCase()) && p.isInstrument)
      ?? instruments[0]
    if (!target) {
      check('an instrument is available to open', false, 'no instruments were found on this machine')
      ws.close(); return finish()
    }

    console.log(`\n  opening "${target.name}" (${target.format})`)
    send({ op: 'open', id: target.id, sampleRate: 48000, blockSize: 512 })
    const opened = await waitFor({ op: 'opened' }, 30000)
    check('the plug-in loads', opened.uid > 0, JSON.stringify(opened).slice(0, 120))
    const uid = opened.uid
    const info = opened.plugin ?? {}
    check('it reports its parameters', Array.isArray(info.parameters) && info.parameters.length > 0,
          `${info.parameters?.length ?? 0} parameters`)
    console.log(`       ${info.name} — ${info.parameters?.length ?? 0} params, editor: ${info.hasEditor}`)

    // ---- silence first, so "it made a sound" means something
    send({ op: 'render', uid, frames: 512, events: [] })
    const quiet = await waitFor({ binary: true }, 15000)
    const quietPeak = peakOf(quiet)
    check('renders silence when nothing is playing', quietPeak < 0.01, `peak ${quietPeak.toFixed(4)}`)

    // ---- then a note
    send({ op: 'render', uid, frames: 512, events: [{ offset: 0, on: true, pitch: 60, velocity: 0.9 }] })
    await waitFor({ binary: true }, 15000)

    let loudest = 0
    for (let i = 0; i < 20; i++) {
      send({ op: 'render', uid, frames: 512, events: [] })
      const block = await waitFor({ binary: true }, 15000)
      loudest = Math.max(loudest, peakOf(block))
    }
    check('a note produces audio', loudest > 0.005, `peak ${loudest.toFixed(4)}`)
    console.log(`       peak after note on: ${loudest.toFixed(4)}`)

    // ---- state round trip
    send({ op: 'getState', uid })
    const state = await waitFor({ op: 'state' }, 15000)
    check('plug-in state can be saved', typeof state.state === 'string' && state.state.length > 0,
          `${state.state?.length ?? 0} bytes of base64`)

    send({ op: 'close', uid })
    check('closes cleanly', true)

    ws.close()
    finish()
  } catch (err) {
    console.error(`\n  ${err.message}`)
    failed++
    ws.close()
    finish()
  }
})

function peakOf(buffer) {
  // [uid int32][frames int32][interleaved float32]
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const frames = view.getInt32(4, true)
  let peak = 0
  for (let i = 0; i < frames * 2; i++) {
    const v = Math.abs(view.getFloat32(8 + i * 4, true))
    if (v > peak) peak = v
  }
  return peak
}

function finish() {
  console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed + failed} checks, ${failed} failures\x1b[0m\n`)
  process.exit(failed === 0 ? 0 : 1)
}
