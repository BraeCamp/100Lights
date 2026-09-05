# Where Beacon runs out of road

Measured 2026-09-05 against the dev build, headless Chrome, on Brae's Mac
(which was also running the dev server, so the baseline is a working machine
rather than an idle one). Harnesses: `scripts/perf-cpu.mjs`,
`scripts/perf-ram.mjs`.

Two questions: how slow can the computer get before the audio suffers, and how
big can the song get before the same thing happens. They have different
answers and different causes.

---

## 1. A slower computer

Chrome was told to pretend it was 2×, 3×, 4× … 20× slower, playing eight
tracks of audio clips with EQ and reverb on each. The master output was
captured in real time at every step and compared with the unthrottled run.

| slower by | audio energy | longest silence | audio clock drift | timer lateness |
|---|---|---|---|---|
| 1× | 100 % | 40 ms | 0 ms | 192 ms |
| 2× | 101 % | 100 ms | −2 ms | 2 103 ms |
| **3×** | 96 % | **600 ms** | 0 ms | 2 703 ms |
| 4× | 88 % | 980 ms | −1 ms | 3 353 ms |
| 6× | 93 % | 1 260 ms | 3 ms | 3 645 ms |
| 8× | 97 % | 1 700 ms | −1 ms | 3 514 ms |
| 12× | 85 % | 2 840 ms | 4 ms | 3 841 ms |
| 20× | **10 %** | 8 520 ms | 0 ms | 4 256 ms |

**Audio starts dropping out between 2× and 3× slower.** At 2× the longest hole
in eight seconds is 100 ms, which is about the gap between hits and not a
fault. At 3× it is 600 ms — over a bar of nothing at 120 BPM, unmistakable. By
12× a third of the timeline is missing, and at 20× it barely plays at all.

**The audio thread is not the problem.** The AudioContext's own clock never
drifted more than 6 ms from the wall clock at any throttle rate, including 20×.
Whatever is scheduled comes out on time. What fails is scheduling it at all:
the note scheduler is a timer on the MAIN thread, and that timer is already
2.1 seconds late at 2× slower. Notes are queued after the moment they were
meant to sound, so they never play.

That points at one fix rather than a hundred small ones: **the scheduler has to
stop sharing a thread with the interface.** The same conclusion the freeze work
reached from the other direction — an Apollo render blocking painting for
eleven seconds — and it is the same thread.

Worth noticing in its own right: the timer is 192 ms late at 1×, unthrottled,
on a machine that is only also running a dev server. The main thread is
already the tightest thing in the studio before anything is asked of it.

## 2. A bigger song

Adding song until memory and scheduling became the problem. Tracks of audio
clips, one hit per beat, EQ and reverb on every track. "Capture" is a
real-time recording of eight seconds of the master, so anything above about
8.4 s means playback could not keep up with itself.

| song | clips | JS heap | capture of 8 s | longest silence |
|---|---|---|---|---|
| 8 × 16 bars | 512 | 145 M | 8.1 s | 40 ms |
| 24 × 32 | 3 072 | 423 M | 8.4 s | 380 ms |
| 32 × 32 | 4 096 | 206–525 M | 8.6 s | 160 ms |
| **32 × 64** | **8 192** | **902 M** | **8.4 s** | 400 ms |
| 40 × 64 | 10 240 | 852 M | 10.2 s | 3 880 ms |
| 48 × 64 | 12 288 | 469 M | 46.6 s | 27 s |
| 64 × 64 | 16 384 | 1 156 M | 43.0 s | 9.4 s |
| 96 × 64 | 24 576 | 1 504 M | 153 s | silent |

**Eight thousand clips is fine; ten thousand is not.** At 8 192 clips and
900 MB of heap the song still plays in real time. At 10 240 it takes 10.2
seconds to play 8 seconds and drops nearly four seconds of audio. By 12 288 it
takes almost six times real time — not slow, broken.

For scale: 32 tracks × 64 bars with something on every beat is a very full
arrangement. A normal song is one to two orders of magnitude below the knee.

**Memory pressure is not what breaks it.** Sending Chrome a *critical*
memory-pressure notification — the signal a phone or a loaded laptop sends when
it wants memory back — did not hurt playback at any size. At 40 × 64 the audio
after the signal measured *better* than before it. The failure at the top of
that table is scheduling cost per clip, not memory exhaustion; the heap figure
rises alongside it but is a passenger.

**Capping the JS heap does not test anything.** `--max-old-space-size` is
ignored by the renderer: under a 96 MB cap the page happily used 141 MB. Any
future memory test has to add work rather than pretend to remove memory.

---

## 3. What to do about it, in order

1. **Get the scheduler off the main thread.** It is the single cause of every
   audible failure above. Everything else in this document is downstream of it.
2. **Make the cost per clip flat.** Between 8 192 and 12 288 clips the capture
   goes from real time to six times real time — far worse than the 50 % more
   clips would explain, so something in the scheduling path is worse than
   linear in the number of clips.
3. **Say when a project is near the edge.** Ten thousand clips is a number the
   studio knows and the person does not.

## 4. How to re-run this

```
node scripts/perf-cpu.mjs 1,2,3,4,6,8,12,20 8      # CPU sweep
node scripts/perf-ram.mjs 8x16,32x64,40x64,48x64   # song-size sweep
```

Both need the dev server on :3000. Each takes a few minutes: the audio
measurements are real-time captures, and there is no honest way to hurry them.

⚠️ Three metrics that look reasonable and are not, all of them tried here
first: **the offline render time** (it is a real-time capture, so it measures
the tempo), **requestAnimationFrame** (headless Chrome paints only when it has
a reason to — 0 fps at 1×, 60 fps at 4×), and **a timer re-based on each tick**
(it reports a perfectly punctual scheduler at twenty times slower, because it
only ever measures the gap since the last late fire).
