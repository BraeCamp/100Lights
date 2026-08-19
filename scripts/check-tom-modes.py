#!/usr/bin/env python3
# Acoustic-realism check: a modal tom must show MULTIPLE spectral partials at
# drum-like ratios (~1 / ~1.5 / ~2.1); a v1 sine-sweep tom shows one peak.
import wave, struct, cmath, os, sys

BASE = os.path.join(os.path.dirname(__file__), '..', 'public', 'drum-kits')

def fft(a):
    n = len(a)
    if n == 1: return a
    ev = fft(a[0::2]); od = fft(a[1::2])
    out = [0] * n
    for k in range(n // 2):
        t = cmath.exp(-2j * cmath.pi * k / n) * od[k]
        out[k] = ev[k] + t; out[k + n // 2] = ev[k] - t
    return out

def partials(path):
    w = wave.open(path, 'rb'); sr = w.getframerate(); n = w.getnframes()
    x = [v / 32768 for v in struct.unpack('<%dh' % n, w.readframes(n))]
    seg = x[int(0.045 * sr):int(0.045 * sr) + 8192]        # past the strike, modes still ringing
    seg += [0] * (8192 - len(seg))
    mags = [abs(v) for v in fft(seg)[:4096]]
    hz = lambda i: i * sr / 8192
    # peaks: local maxima above 12% of global max, below 1.2 kHz
    mx = max(mags[4:])
    peaks = []
    for i in range(4, 4096 - 1):
        if hz(i) > 1200: break
        if mags[i] > 0.07 * mx and mags[i] >= mags[i - 1] and mags[i] >= mags[i + 1]:
            if peaks and hz(i) - peaks[-1][0] < 18:
                if mags[i] > peaks[-1][1]: peaks[-1] = (hz(i), mags[i])
            else: peaks.append((hz(i), mags[i]))
    peaks.sort(key=lambda p: -p[1])
    top = sorted(peaks[:5])
    if not top: return []
    f0 = top[0][0]
    return [(round(f, 0), round(f / f0, 2)) for f, _ in top]

for kit in ['studio', 'rock', 'pop', 'lofi', 'boombap', 'trap808']:
    for pitch, label in [(41, 'tomL'), (45, 'tomM')]:
        ps = partials(os.path.join(BASE, kit, f'{pitch}.wav'))
        tag = 'MODAL' if len(ps) >= 3 else ('2-part' if len(ps) == 2 else 'single')
        print(f"{kit:8} {label}: {tag:7} partials {ps}")
