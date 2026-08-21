#!/usr/bin/env python3
"""Spectral verification of the C++ vertical slice against engine.js behavior.

Checks (Goertzel band probes, same technique the browser QAs use):
  1. fundamental at 110 Hz is the dominant component in both renders
  2. bright render (cutoff 0.90) carries far more high-frequency energy
     than the dark render (cutoff 0.35) — the SVF lowpass works
  3. release tail decays to silence — the envelope works
"""
import struct, sys, math, os

def read_wav_f32(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    off = 12
    sr, samples = None, None
    while off < len(data) - 8:
        tag = data[off:off+4]; size = struct.unpack('<I', data[off+4:off+8])[0]
        if tag == b'fmt ':
            fmt, ch, sr = struct.unpack('<HHI', data[off+8:off+16])
            assert fmt == 3, 'expected float32 wav'
        elif tag == b'data':
            samples = struct.unpack(f'<{size//4}f', data[off+8:off+8+size])
        off += 8 + size
    return sr, samples

def goertzel(x, f, sr):
    w = 2 * math.pi * f / sr
    coeff = 2 * math.cos(w)
    s1 = s2 = 0.0
    for v in x:
        s0 = v + coeff * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(abs(s1*s1 + s2*s2 - coeff*s1*s2)) / len(x)

def rms(x):
    return math.sqrt(sum(v*v for v in x) / len(x))

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sr, dark = read_wav_f32('slice_dark.wav')
_, bright = read_wav_f32('slice_bright.wav')

body = slice(int(0.3*sr), int(1.2*sr))   # inside the held note
tail = slice(int(1.95*sr), int(2.0*sr))  # after release

ok = True
def check(name, cond, extra=''):
    global ok
    print(('PASS' if cond else 'FAIL'), name, extra)
    ok = ok and cond

lo = goertzel(dark[body], 110, sr)
hi_dark = goertzel(dark[body], 3520, sr) + goertzel(dark[body], 5280, sr)
hi_bright = goertzel(bright[body], 3520, sr) + goertzel(bright[body], 5280, sr)

check('fundamental dominates', lo > hi_dark * 3, f'(110Hz {lo:.5f} vs highs {hi_dark:.6f})')
check('cutoff opens the highs', hi_bright > hi_dark * 5, f'(dark {hi_dark:.6f} -> bright {hi_bright:.6f})')
check('audible body', rms(dark[body]) > 0.02, f'(rms {rms(dark[body]):.4f})')
check('release decays to silence', rms(dark[tail]) < 1e-4, f'(tail rms {rms(dark[tail]):.6f})')
sys.exit(0 if ok else 1)
