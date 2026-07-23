# Learn — Article Pipeline

How this works: tell Claude "draft the next learn article" (or name one). Claude
writes it to `content/learn/<slug>.md` with `draft: true` and updates this table.
Review at `/learn` (drafts show in dev, and via direct URL in prod but noindexed
and hidden from the list). Publish either by setting `draft: false`, or schedule
it with a `publishAt: <ISO datetime>` line — it stays a draft until that instant,
then auto-publishes on the next hourly rebuild (no deploy).

⚠️ **Only schedule GENUINE drafts.** An article already published on prod is a
`learn_articles` DB row that shadows the repo file, so a repo `publishAt` on it
does nothing. Check the live set with `curl https://100lights.com/learn/rss.xml`
before scheduling.

Video slots: `@video caption` renders a "coming soon" card; swap to
`@video(https://url.mp4) caption` when you have the clip.

## Shipped / scheduled

The first 23 guides are live or on the drip (2/day, 9am + 9pm PT, Jul 24 → Aug 2):
beats, DAW basics, recording vocals, piano roll, mixing 101, looping, session vs
arrangement, five chord progressions, what key, sample packs, sidechain, song
structure, four-chords-five-genres, boring loops, ten licks, andalusian cadence,
ear training, collaborating, gear, unfinished projects, automation, reese bass,
code-a-poly. (`build-a-reese-bass`, `automation-loop-into-song`,
`five-chord-progressions` were already published by Brae — live now, not on the
drip; the rest drip.)

## Drafts ready to work on (unscheduled)

| Idea | Slug | Target search | Voice |
|------|------|--------------|-------|
| How Music Is Counted: Bars and Beats | `what-are-bars-and-beats` | bars and beats explained | heretic |
| What Is BPM, and How Do You Pick a Tempo? | `what-is-bpm-choosing-your-tempo` | what is bpm | heretic |
| How to Use Reverb Without Drowning Your Mix | `how-to-use-reverb-without-drowning-your-mix` | how to use reverb | insider |
| Your Beat Sounds Stiff Because You Quantized It | `add-swing-to-your-beat` | how to add swing | heretic |
| Major vs Minor — Why One Sounds Happy... | `major-vs-minor-happy-or-sad` | major vs minor | detective |

## Next ideas (not yet drafted)

| Idea | Target search |
|------|--------------|
| What Is a Compressor and Do You Actually Need One | what does a compressor do |
| Layering Sounds for a Fuller Mix | how to layer sounds |
| Arpeggios: Turn One Chord Into a Whole Part | what is an arpeggiator |
| How to Make Your Drums Hit Harder | punchy drums |
| EQ: How to Make Instruments Sit Together | eq for beginners |

Notes:
- Every article should be doable start-to-finish in the free studio, and say so.
- Chord/theory pieces can lift from `lib/practice-recipes.ts` (already in-voice).
- One `/community` link + one `@studio(/new?modules=audio)` CTA per article; no keyword stuffing.
