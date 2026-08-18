#!/usr/bin/env python3
# QA for gen-drum-kits output: per-role feature matrix across kits so the kits
# are PROVABLY distinct (centroid / low-band share / decay), not tweaked twins.
import wave, struct, cmath, sys, os

BASE = os.path.join(os.path.dirname(__file__), '..', 'public', 'drum-kits')
KITS = ['studio', 'boombap', 'rock', 'pop', 'house', 'lofi', 'trap808', 'techno']
ROLES = {36: 'kick', 38: 'snare', 39: 'clap', 42: 'chat', 46: 'ohat', 41: 'tomL', 49: 'crash', 51: 'rim'}

def fft(a):
    n = len(a)
    if n == 1: return a
    ev = fft(a[0::2]); od = fft(a[1::2])
    out = [0] * n
    for k in range(n // 2):
        t = cmath.exp(-2j * cmath.pi * k / n) * od[k]
        out[k] = ev[k] + t; out[k + n // 2] = ev[k] - t
    return out

def feats(path):
    w = wave.open(path, 'rb'); sr = w.getframerate(); n = w.getnframes()
    x = [v / 32768 for v in struct.unpack('<%dh' % n, w.readframes(n))]
    N = 4096
    a = x[:N] + [0] * max(0, N - len(x))
    X = fft(a)
    mags = [abs(v) for v in X[:N // 2]]
    tot = sum(mags) + 1e-12
    centroid = sum(i * sr / N * m for i, m in enumerate(mags)) / tot
    low = sum(m for i, m in enumerate(mags) if i * sr / N < 200) / tot
    peak = max(abs(v) for v in x)
    dec = n / sr
    W = int(0.005 * sr)
    for i in range(0, n - W, W):
        if max(abs(v) for v in x[i:i + W]) < peak * 0.1:
            dec = i / sr; break
    return centroid, low, dec

print(f"{'role':6}" + "".join(f"{k:>10}" for k in KITS))
worst = []
for pitch, role in ROLES.items():
    rows = [feats(os.path.join(BASE, k, f'{pitch}.wav')) for k in KITS]
    print(f"{role:6}" + "".join(f"{c[0]/1000:8.1f}k " for c in rows))
    print(f"{'  dec':6}" + "".join(f"{c[2]:8.2f}s " for c in rows))
    # nearest-neighbour similarity check (normalized feature distance)
    for i in range(len(KITS)):
        for j in range(i + 1, len(KITS)):
            ci, li, di = rows[i]; cj, lj, dj = rows[j]
            d = abs(ci - cj) / 4000 + abs(li - lj) * 2 + abs(di - dj) / 0.4
            if d < 0.25: worst.append((role, KITS[i], KITS[j], round(d, 2)))
print()
if worst:
    print('⚠ close pairs (tune these apart):')
    for w in worst: print('  ', w)
else:
    print('✓ all same-role sounds are comfortably distinct across kits')
