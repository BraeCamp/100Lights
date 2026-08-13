#!/usr/bin/env python3
"""Extract the same rough DSP features Lightning Bug's classifier reads from the live AnalyserNode,
but offline with librosa — so we can check classifySonic() against real genre labels and retune it.

stdin: one JSON per line {"id","url"}.  stdout: {"id","bpm","rms","bass","bright","flux","pulse"}.
Features are raw (not yet scaled to the browser's 0-1); the calibrator normalizes per-corpus.
Audio is a mid-song 20s window via ffmpeg (no python download/codec dep)."""
import sys, json, subprocess, warnings
import numpy as np

warnings.filterwarnings("ignore")
SR = 22050


def decode(url, ss=20.0, dur=20.0):
    for args in ([f"-ss", str(ss), "-t", str(dur)], ["-t", "25"]):
        try:
            p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", *args, "-i", url,
                                "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, timeout=25)
        except subprocess.TimeoutExpired:
            return None                         # slow/hung source — skip it, don't stall the batch
        y = np.frombuffer(p.stdout, dtype=np.float32)
        if y.size >= SR:
            return y
    return None


def features(url):
    import librosa
    y = decode(url)
    if y is None:
        return None
    y = np.ascontiguousarray(y)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))          # freq x time
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    total = S.sum(axis=0) + 1e-9
    bass = (S[freqs < 150].sum(axis=0) / total).mean()               # low-band energy ratio
    bright = (S[freqs > 4000].sum(axis=0) / total).mean()            # high-band energy ratio
    rms = float(librosa.feature.rms(y=y).mean())                     # loudness
    flux = float(np.mean(np.maximum(0, np.diff(S, axis=1)).sum(axis=0)) / (S.shape[0]))  # spectral flux ~ density
    onset = librosa.onset.onset_strength(y=y, sr=SR)
    tempo = float(np.atleast_1d(librosa.beat.tempo(onset_envelope=onset, sr=SR))[0])
    while tempo > 150: tempo /= 2      # fold octave errors into a musical 60-150 range
    while 0 < tempo < 60: tempo *= 2
    # pulse clarity ~ how "beaty": normalized autocorrelation peak of the onset envelope
    ac = librosa.autocorrelate(onset - onset.mean())
    pulse = float(np.max(ac[1:]) / (ac[0] + 1e-9)) if ac.size > 1 else 0.0
    return dict(bpm=round(tempo, 1), rms=round(rms, 5), bass=round(float(bass), 4),
                bright=round(float(bright), 4), flux=round(flux, 4), pulse=round(max(0.0, pulse), 4))


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        f = features(req["url"])
        print(json.dumps({"id": req.get("id"), **(f or {"err": "decode_failed"})}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"id": json.loads(line).get("id"), "err": str(e)[:120]}), flush=True)
