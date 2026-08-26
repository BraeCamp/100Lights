// Telling a loopback device apart from a microphone.
//
//   npm run test:audio-input
//
// This decides whether "Computer Audio" quietly uses a virtual driver — no
// screen sharing, no picker — or falls back to the screen-share flow. Both
// mistakes are bad in ways worth spelling out:
//
//   A false POSITIVE routes somebody's actual microphone in as "computer
//   audio". They press record expecting the song they are playing and capture
//   the room, themselves, whoever is talking nearby. That is the failure that
//   matters, so the microphone cases below are the ones to keep adding to.
//
//   A false NEGATIVE just means a screen-share prompt they did not need.
//
// The names are real ones, as the OS reports them.

import assert from 'node:assert'
import { createRequire } from 'node:module'

const { classifyAudioDevice } = createRequire(import.meta.url)('../.test-build/audio-capture.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const LOOPBACK = [
  'BlackHole 2ch',
  'BlackHole 16ch',
  'Loopback Audio',
  'Loopback Audio 2',
  'Soundflower (2ch)',
  'iShowU Audio Capture',
  'Stereo Mix (Realtek(R) Audio)',
  'Stereo Mix',
  'What U Hear (Sound Blaster)',
  'CABLE Output (VB-Audio Virtual Cable)',
  'VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)',
  'Line 1 (Virtual Audio Cable)',
  'Monitor of Built-in Audio Analog Stereo',
  'Monitor of Family 17h HD Audio Controller',
]

const MICROPHONES = [
  'MacBook Air Microphone',
  'MacBook Pro Microphone',
  'iPhone Microphone',
  'Default Microphone',
  'External Microphone',
  'Scarlett 2i2 USB',
  'Shure MV7',
  'Blue Yeti',
  'AirPods Pro',
  'Jabra Speak 710',
  'Logitech BRIO',
  'USB Audio CODEC',
  'Built-in Audio Analog Stereo',       // the device, NOT its monitor
  'Studio Display Microphone',
  'Samson Q2U Microphone',
  // Tempting near-misses. "Loopback" alone is not the product name, and a
  // headset that merely mentions monitoring is still a headset.
  'Beyerdynamic DT 770 (monitor headphones)',
  'Audio Monitor Speakers',
]

for (const label of LOOPBACK) {
  check(`"${label}" is computer audio`, classifyAudioDevice(label) === 'loopback')
}
for (const label of MICROPHONES) {
  const got = classifyAudioDevice(label)
  check(`"${label}" is a microphone`, got === 'microphone', got === 'loopback' ? '← would record the room instead of the song' : '')
}

console.log(failures ? `\n${failures} failing` : '\nloopback devices are told apart from microphones')
assert.equal(failures, 0)
