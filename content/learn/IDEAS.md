# Learn — Article Pipeline

How this works: tell Claude "draft the next learn article" (or name one) in any
session. Claude writes it to `content/learn/<slug>.md` with `draft: true`,
leaves `@video` slots where a clip would help, and updates this table. You
review at `/learn` (drafts are visible in dev, and via direct URL in prod but
noindexed and hidden from the list). Publish by changing `draft: true` →
`draft: false` — the next deploy puts it in the list, the sitemap, and search.

Video slots: `@video caption` renders a "coming soon" card. When you have the
clip, change it to `@video(https://url.mp4) caption` (YouTube links work too).

## Status

| # | Idea | Target search | Status |
|---|------|--------------|--------|
| 1 | How to Make a Beat in Your Browser (No Downloads) | make beats online free | **drafted** |
| 2 | 5 Chord Progressions Every Producer Should Know | chord progressions for producers | **drafted** |
| 3 | Recording Vocals at Home with Just a Browser | record vocals online | idea |
| 4 | What Is a DAW? A Beginner's Guide | what is a daw | idea |
| 5 | Piano Roll Basics: Writing Melodies Without a Keyboard | piano roll tutorial | idea |
| 6 | How to Loop a Sample (and Make It Sound Intentional) | how to loop samples | idea |
| 7 | Mixing 101: Volume, Pan, and EQ Before Anything Else | mixing for beginners | idea |
| 8 | The Andalusian Cadence: One Progression, Four Genres | andalusian cadence | idea |
| 9 | Song Structure for Producers: Verse, Chorus, and Why 8 Bars | song structure electronic music | idea |
| 10 | Free Sample Packs vs. Making Your Own Sounds | free sample packs | idea |
| 11 | Sidechain Compression Explained (with Your Ears, Not Math) | sidechain compression explained | idea |
| 12 | Collaborating on Music Remotely: A Practical Setup | make music online with friends | idea |

Notes:
- Every article should be doable start-to-finish in the free studio, and say so.
- Chord/theory pieces can lift from the recipe annotations in `lib/practice-recipes.ts` — that copy is already written in the right voice.
- One internal link to /community and one to sign-up per article; no keyword stuffing.
