#!/usr/bin/env python3
"""Local CLAP embedder — bakes out the paid Replicate/ImageBind step.

LAION-CLAP (laion/clap-htsat-unfused) maps audio AND text into ONE 512-d space, so a text prompt can
retrieve sonically-similar tracks. Runs on CPU locally, free, no per-track cost.

Two modes:
  • streaming (default): read one JSON request per line from stdin ({"id","url"} or {"id","text"}),
    write {"id","vec":[...512]} per line to stdout. Model loads once. Used by scripts/embed-jamendo.mjs.
  • one-shot:  --text "dreamy dark synthpop"   → prints a single {"vec":[...]} line.

Audio is fetched + decoded by ffmpeg (48kHz mono f32), so we never add a Python download/codec dep.
We take a 10s window from ~20s in (the body of the song, not the intro) to represent the track.
"""
import sys, json, subprocess, warnings
import numpy as np

warnings.filterwarnings("ignore")
SR = 48000
_model = None
_proc = None


def load():
    global _model, _proc
    if _model is None:
        import torch  # noqa
        from transformers import ClapModel, ClapProcessor
        _model = ClapModel.from_pretrained("laion/clap-htsat-unfused")
        _proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
        _model.eval()
    return _model, _proc


def decode(url, ss=20.0, dur=10.0):
    """ffmpeg → mono 48k float32 PCM. Try a mid-song window; fall back to the start if the seek fails."""
    for args in ([f"-ss", str(ss), "-t", str(dur)], ["-t", "20"]):
        p = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", *args, "-i", url,
             "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
            capture_output=True)
        buf = np.frombuffer(p.stdout, dtype=np.float32)
        if buf.size >= SR:  # at least 1s of audio
            return buf
    return None


def embed_audio(url):
    model, proc = load()
    import torch
    wav = decode(url)
    if wav is None:
        return None
    inp = proc(audios=[wav], sampling_rate=SR, return_tensors="pt")
    with torch.no_grad():
        v = model.get_audio_features(**inp)[0]
    v = v / v.norm()  # unit-normalize → cosine == dot
    return v.cpu().numpy().astype(float).tolist()


def embed_text(text):
    model, proc = load()
    import torch
    inp = proc(text=[text], return_tensors="pt", padding=True)
    with torch.no_grad():
        v = model.get_text_features(**inp)[0]
    v = v / v.norm()
    return v.cpu().numpy().astype(float).tolist()


def main():
    args = sys.argv[1:]
    if "--text" in args:
        txt = args[args.index("--text") + 1]
        print(json.dumps({"vec": embed_text(txt)}), flush=True)
        return
    load()  # warm up before signalling ready
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            vec = embed_text(req["text"]) if "text" in req else embed_audio(req["url"])
            print(json.dumps({"id": req.get("id"), "vec": vec}), flush=True)
        except Exception as e:  # noqa: BLE001 — one bad track shouldn't kill the batch
            print(json.dumps({"id": json.loads(line).get("id") if line else None, "vec": None, "err": str(e)[:120]}), flush=True)


if __name__ == "__main__":
    main()
