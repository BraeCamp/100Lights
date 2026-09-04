// Read a localStorage value straight out of a Chromium LevelDB table file — the
// desktop app (~/Library/Application Support/100lights-desktop/Local Storage/leveldb)
// or a Chrome profile — for voice-history forensics when the app is not open.
// It parses the table (.ldb): footer → index block → data blocks, snappy-decompressed — and
// decode the value (0x00 prefix = UTF-16LE, 0x01 = Latin-1). No dependencies.
//   node scripts/read-local-storage.mjs <file.ldb> <key substring> [--out=file.json]   e.g. key beacon.voice.memory.v1
import { readFileSync, writeFileSync } from 'node:fs'

const [file, want] = process.argv.slice(2)
const outArg = process.argv.find(a => a.startsWith('--out='))
const buf = readFileSync(file)

function varint(b, p) { let v = 0, shift = 0; for (;;) { const c = b[p++]; v += (c & 0x7f) * 2 ** shift; if (!(c & 0x80)) return [v, p]; shift += 7 } }

function snappy(src) {
  let [len, pos] = varint(src, 0)
  const out = Buffer.alloc(len); let op = 0
  while (pos < src.length) {
    const tag = src[pos++], type = tag & 3
    if (type === 0) {
      let l = (tag >> 2) + 1
      if (l > 60) { const n = l - 60; l = 0; for (let i = 0; i < n; i++) l |= src[pos++] << (8 * i); l += 1 }
      src.copy(out, op, pos, pos + l); op += l; pos += l
    } else {
      let offset, l
      if (type === 1) { l = ((tag >> 2) & 7) + 4; offset = ((tag >> 5) << 8) | src[pos++] }
      else if (type === 2) { l = (tag >> 2) + 1; offset = src[pos] | (src[pos + 1] << 8); pos += 2 }
      else { l = (tag >> 2) + 1; offset = src.readUInt32LE(pos); pos += 4 }
      for (let i = 0; i < l; i++) { out[op] = out[op - offset]; op++ }
    }
  }
  return out.subarray(0, op)
}

function block(handle) {
  const [offset, size] = handle
  const raw = buf.subarray(offset, offset + size)
  const type = buf[offset + size]
  return type === 1 ? snappy(raw) : raw
}

function entries(b) {
  const n = b.readUInt32LE(b.length - 4)
  const end = b.length - 4 - 4 * n
  let p = 0, prev = Buffer.alloc(0)
  const out = []
  while (p < end) {
    let shared, nonShared, vlen
    ;[shared, p] = varint(b, p); [nonShared, p] = varint(b, p); [vlen, p] = varint(b, p)
    const key = Buffer.concat([prev.subarray(0, shared), b.subarray(p, p + nonShared)])
    p += nonShared
    const value = b.subarray(p, p + vlen)
    p += vlen
    out.push({ key, value }); prev = key
  }
  return out
}

// Footer: metaindex handle, index handle, padding, 8-byte magic.
const footer = buf.subarray(buf.length - 48)
let p = 0, meta, index
;[meta, p] = [[0, 0], 0]
{ let o, s; [o, p] = varint(footer, p); [s, p] = varint(footer, p); meta = [o, s]; [o, p] = varint(footer, p); [s, p] = varint(footer, p); index = [o, s] }
const indexEntries = entries(block(index))
let found = 0
for (const ie of indexEntries) {
  let o, s, q = 0
  ;[o, q] = varint(ie.value, q); [s, q] = varint(ie.value, q)
  let data
  try { data = entries(block([o, s])) } catch (e) { console.error('block failed', o, s, e.message); continue }
  for (const e of data) {
    const userKey = e.key.subarray(0, Math.max(0, e.key.length - 8)).toString('latin1')
    if (!userKey.includes(want)) continue
    const seq = e.key.length >= 8 ? Number(e.key.readBigUInt64LE(e.key.length - 8) >> 8n) : 0
    const prefix = e.value[0]
    const text = prefix === 0 ? e.value.subarray(1).toString('utf16le') : e.value.subarray(1).toString('latin1')
    found++
    console.log(`key: ${userKey.replace(/[^\x20-\x7e]/g, '·')}  seq=${seq}  value ${text.length} chars`)
    if (outArg) { writeFileSync(outArg.slice(6), text); console.log('wrote', outArg.slice(6)) }
    else console.log(text.slice(0, 600))
  }
}
if (!found) console.log('key not found in', file)
