// Caption generator — ported from the marketing pipeline's template copywriter.
// Pure: given a song's musical metadata, produce a platform-ready title + body.
// Kept deterministic (no LLM) so drafts are instant and free; the admin can edit
// the copy before approving.

export interface Musical {
  bpm?: number | null
  key?: string | null
  time_signature?: string | null
  genre_tags?: string[]
  instrument_list?: string[]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function templateCaption(m: Musical): { title: string; caption: string } {
  const genre = (m.genre_tags && m.genre_tags[0]) || 'music'
  const art = 'aeiou'.includes((genre[0] || '').toLowerCase()) ? 'an' : 'a'

  const hook = `Watch ${art} ${genre} track come together.`
  const body = 'Full run, no edits. Made in the browser with 100Lights. 🎧'
  const tags = [
    ...(m.genre_tags || []).slice(0, 3).map(t => '#' + t.replace(/\s+/g, '')),
    '#musicproduction', '#ai', '#100lights',
  ].join(' ')

  const caption = `${hook}\n${body}\n\n${tags}`.trim()
  const title = cap(`${art} ${genre} beat, start to finish · 100Lights`).slice(0, 100)
  return { title, caption }
}
