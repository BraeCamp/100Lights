# Broadcast station audio

Drop licensed/stream-safe audio files here, one folder per station slug (see `lib/stations.ts`):

    public/broadcast/dnd-tavern/01-hearth.mp3
    public/broadcast/study-lofi/rainy-day.mp3

The broadcast view (`/apps/musicvideo?station=<slug>&broadcast=1`) auto-discovers these files and
plays them in order (looping, shuffled). Local files are the most reliable path for a 24/7 stream —
no API, no CORS, no rate limits. Supported: mp3, m4a, aac, ogg, wav, flac, opus.

If a station folder is empty, the app falls back to the station's `tracks` list, then the Jamendo
API (needs `JAMENDO_CLIENT_ID`). Only use audio you're licensed to stream — see `STREAMING.md`.
