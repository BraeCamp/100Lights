#!/usr/bin/env python3
"""
analyze-mix.py — objective mix analysis for songs built in the 100Lights studio.

Pairs with window.__dawRenderWav (see lib/daw-engine.ts renderWav). The browser
bounces a beat range to lossless float WAV(s); this reads them and prints a mix
report — per-stem loudness (LUFS, BS.1770 K-weighting), peak/clipping, crest,
spectral balance across 6 bands, stereo width — plus plain-language hints. Lets
an agent "hear" what it made: catch clipping, buried parts, muddy/harsh balance
before a human listens.

Usage:
  python3 scripts/analyze-mix.py render.json       # {sampleRate,master,stems{}} of base64 WAVs
  python3 scripts/analyze-mix.py mix.wav [stem.wav ...]

render.json is what __dawRenderWav returns (save it via Playwright's evaluate
`filename`). Deps: numpy, scipy.
"""
import sys, json, base64, struct
import numpy as np

# numpy 2 removed np.trapz in favour of np.trapezoid. Support both, so this
# keeps working whichever the machine has — it is the only tool here that can
# tell me what a mix actually sounds like, and it should not stop being able to
# because of a rename.
_trapz = getattr(np, 'trapezoid', None) or np.trapz
from scipy import signal


# ── WAV loading (manual RIFF parse — stdlib `wave` rejects float32 / fmt 3) ────
def read_wav_bytes(raw: bytes):
    """Return (float32 samples [n, ch], sample_rate). Handles float32 and PCM16/24/32."""
    if raw[0:4] != b'RIFF' or raw[8:12] != b'WAVE':
        raise ValueError('not a WAVE file')
    fmt = channels = bits = sr = None
    data = None
    pos = 12
    while pos + 8 <= len(raw):
        cid = raw[pos:pos + 4]
        size = struct.unpack_from('<I', raw, pos + 4)[0]
        body = raw[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            fmt, channels, sr, _br, _ba, bits = struct.unpack_from('<HHIIHH', body, 0)
        elif cid == b'data':
            data = body
        pos += 8 + size + (size & 1)  # chunks are word-aligned
    if data is None or fmt is None:
        raise ValueError('missing fmt/data chunk')
    if fmt == 3 and bits == 32:
        arr = np.frombuffer(data, dtype='<f4')
    elif fmt == 1 and bits == 16:
        arr = np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768.0
    elif fmt == 1 and bits == 24:
        a = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        v = np.where(v & 0x800000, v - (1 << 24), v)
        arr = v.astype(np.float32) / (1 << 23)
    elif fmt == 1 and bits == 32:
        arr = np.frombuffer(data, dtype='<i4').astype(np.float32) / (1 << 31)
    else:
        raise ValueError(f'unsupported WAV format={fmt} bits={bits}')
    return arr.reshape(-1, channels), sr


# ── K-weighting (ITU-R BS.1770) designed for the actual sample rate ───────────
def _biquad_highshelf(fs, f0=1681.97, gain_db=3.9997, q=0.7071):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / fs
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha
    return np.array([b0, b1, b2]) / a0, np.array([a0, a1, a2]) / a0


def _biquad_highpass(fs, f0=38.135, q=0.5):
    w0 = 2 * np.pi * f0 / fs
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    return np.array([b0, b1, b2]) / a0, np.array([a0, a1, a2]) / a0


def k_weight(x, fs):
    b1, a1 = _biquad_highshelf(fs)
    b2, a2 = _biquad_highpass(fs)
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x))


def lufs_integrated(samples, fs):
    """Gated integrated loudness (LUFS) per BS.1770-4, channels summed."""
    x = samples if samples.ndim == 2 else samples[:, None]
    # per-channel K-weighting, then channel-summed mean square in 400ms blocks
    win = int(0.4 * fs); hop = int(0.1 * fs)
    if x.shape[0] < win:
        z = np.sum([np.mean(k_weight(x[:, c], fs) ** 2) for c in range(x.shape[1])])
        return -0.691 + 10 * np.log10(z + 1e-12)
    kw = np.stack([k_weight(x[:, c], fs) for c in range(x.shape[1])], axis=1)
    nb = 1 + (kw.shape[0] - win) // hop
    z = np.empty(nb)
    for i in range(nb):
        seg = kw[i * hop:i * hop + win]
        z[i] = np.sum(np.mean(seg ** 2, axis=0))
    lk = -0.691 + 10 * np.log10(z + 1e-12)
    abs_keep = lk > -70.0
    if not abs_keep.any():
        return float('-inf')
    rel = -0.691 + 10 * np.log10(np.mean(z[abs_keep]) + 1e-12) - 10.0
    keep = abs_keep & (lk > rel)
    if not keep.any():
        keep = abs_keep
    return float(-0.691 + 10 * np.log10(np.mean(z[keep]) + 1e-12))


# ── Spectral balance ──────────────────────────────────────────────────────────
BANDS = [('sub', 20, 60), ('bass', 60, 120), ('lo-mid', 120, 400),
         ('mid', 400, 2000), ('presence', 2000, 6000), ('air', 6000, 16000)]


def spectral_balance(mono, fs):
    f, pxx = signal.welch(mono, fs=fs, nperseg=min(8192, len(mono)))
    total = _trapz(pxx, f) + 1e-20
    out = {}
    for name, lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        out[name] = float(_trapz(pxx[m], f[m]) / total * 100)
    return out


def db(x):
    return 20 * np.log10(x + 1e-12)


def analyze(samples, fs):
    x = samples if samples.ndim == 2 else samples[:, None]
    mono = x.mean(axis=1)
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(mono ** 2)))
    clip = int(np.sum(np.abs(x) >= 0.999))
    r = {
        'peak_db': round(db(peak), 2),
        'rms_db': round(db(rms), 2),
        'crest_db': round(db(peak) - db(rms), 1),
        'lufs': round(lufs_integrated(x, fs), 1),
        'clip_samples': clip,
        'clip_pct': round(clip / x.size * 100, 3),
        'dc_offset': round(float(np.mean(mono)), 5),
        'bands_pct': {k: round(v, 1) for k, v in spectral_balance(mono, fs).items()},
    }
    if x.shape[1] == 2:
        mid = (x[:, 0] + x[:, 1]) / 2
        side = (x[:, 0] - x[:, 1]) / 2
        r['width_side_db'] = round(db(np.sqrt(np.mean(side ** 2))) - db(np.sqrt(np.mean(mid ** 2))), 1)
        c = np.corrcoef(x[:, 0], x[:, 1])
        r['stereo_corr'] = round(float(c[0, 1]) if np.isfinite(c[0, 1]) else 1.0, 2)
    return r


def hints(name, m, master_lufs=None):
    """Level/clip hints for every track; spectral-balance hints only for the
    master (a bass or keys *stem* is meant to be band-limited — flagging it is
    noise). Relative-loudness hints compare each stem to the master."""
    h = []
    is_master = name == 'master'
    if m['clip_samples'] > 0 or m['peak_db'] >= -0.1:
        h.append(f"CLIPPING/too hot (peak {m['peak_db']}dB, {m['clip_samples']} clipped)")
    if is_master:
        b = m['bands_pct']
        low = b['sub'] + b['bass']
        high = b['presence'] + b['air']
        if low > 45: h.append(f"bass-heavy/muddy ({low:.0f}% under 120Hz)")
        if b['lo-mid'] > 48: h.append(f"boxy ({b['lo-mid']:.0f}% in 120-400Hz)")
        if high > 40: h.append(f"bright/harsh ({high:.0f}% over 2kHz)")
        if high < 4: h.append(f"dull/dark (only {high:.0f}% over 2kHz — no air/sparkle)")
    if master_lufs is not None and not is_master and m['lufs'] != float('-inf'):
        rel = m['lufs'] - master_lufs
        if rel < -20: h.append(f"very quiet vs mix ({rel:+.0f} LU) — likely inaudible")
        elif rel < -14: h.append(f"low in the mix ({rel:+.0f} LU)")
    return h


def print_report(tracks, fs):
    master_lufs = tracks.get('master', {}).get('lufs')
    order = ['master'] + [k for k in tracks if k != 'master']
    print(f"\n  MIX ANALYSIS  ·  {fs} Hz\n" + "  " + "─" * 74)
    hdr = f"  {'track':<12} {'LUFS':>7} {'peak':>7} {'rms':>7} {'crest':>6} {'clip%':>6}   spectral balance (sub·bass·loMid·mid·pres·air %)"
    print(hdr)
    for name in order:
        m = tracks[name]
        b = m['bands_pct']
        bal = "·".join(f"{b[k]:>4.0f}" for k, _, _ in BANDS)
        lufs = f"{m['lufs']:>7.1f}" if m['lufs'] != float('-inf') else "   -inf"
        w = f"  width{m['width_side_db']:+.0f}dB corr{m['stereo_corr']}" if 'width_side_db' in m else ""
        print(f"  {name:<12}{lufs} {m['peak_db']:>7.1f} {m['rms_db']:>7.1f} {m['crest_db']:>6.1f} {m['clip_pct']:>6.2f}   {bal}{w}")
    print("  " + "─" * 74)
    any_hint = False
    for name in order:
        hs = hints(name, tracks[name], master_lufs)
        for h in hs:
            print(f"  ⚠ {name}: {h}"); any_hint = True
    if not any_hint:
        print("  ✓ no obvious issues (no clipping, balanced spectrum)")
    if master_lufs is not None and master_lufs != float('-inf'):
        print(f"\n  master {master_lufs:.1f} LUFS  (streaming target ≈ -14; -9 to -8 = loud/hot)")
    print()


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    tracks = {}
    fs = None
    if args[0].endswith('.json'):
        data = json.load(open(args[0]))
        fs = data['sampleRate']
        samp, _ = read_wav_bytes(base64.b64decode(data['master']))
        tracks['master'] = analyze(samp, fs)
        for name, b64 in (data.get('stems') or {}).items():
            s, _ = read_wav_bytes(base64.b64decode(b64))
            tracks[name] = analyze(s, fs)
    else:
        for i, path in enumerate(args):
            samp, sr = read_wav_bytes(open(path, 'rb').read())
            fs = sr
            # The first file is always the master, including when it is the
            # ONLY file — the report keys off that name, so analysing a single
            # bounce used to crash with KeyError('master').
            name = 'master' if i == 0 else path.split('/')[-1].rsplit('.', 1)[0]
            tracks[name] = analyze(samp, fs)
    print_report(tracks, fs)


if __name__ == '__main__':
    main()
