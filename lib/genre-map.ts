// Map free-form music tags (Jamendo genres/moods) onto the 7 families the Lightning Bug auto system
// uses for its Looks. One source of truth, shared by: the broadcast playlist route (per-track genre
// → visual look), the centroid builder (scripts/build-genre-centroids.mjs), and the classifier
// calibration. Family strings match classifySonic()'s keys and GENRE_LOOK's keys exactly.

export type Family = 'Ambient' | 'Lofi / Chill' | 'Hip-hop' | 'Electronic' | 'Rock / Band' | 'Pop' | 'Orchestral'

export const FAMILIES: Family[] = ['Ambient', 'Lofi / Chill', 'Hip-hop', 'Electronic', 'Rock / Band', 'Pop', 'Orchestral']

// Weighted tag → family cues. A tag can hint more than one family; strongest total wins.
const CUES: Record<Family, string[]> = {
  'Orchestral':   ['orchestral', 'classical', 'cinematic', 'soundtrack', 'epic', 'strings', 'symphony', 'score', 'film', 'trailer', 'choir', 'baroque'],
  'Ambient':      ['ambient', 'drone', 'meditation', 'meditative', 'newage', 'atmospheric', 'soundscape', 'relax', 'relaxing', 'calm', 'peaceful', 'nature', 'sleep', 'space'],
  'Lofi / Chill': ['lofi', 'lo-fi', 'chillhop', 'chill', 'chillout', 'downtempo', 'lounge', 'jazz', 'jazzy', 'soul', 'smooth', 'study', 'coffee'],
  'Hip-hop':      ['hiphop', 'hip-hop', 'rap', 'trap', 'boombap', 'beats', 'phonk', '808', 'drill', 'grime'],
  'Electronic':   ['electronic', 'electro', 'edm', 'house', 'techno', 'trance', 'dance', 'synthwave', 'retrowave', 'dubstep', 'drumandbass', 'dnb', 'breakbeat', 'vaporwave', 'idm', 'glitch', 'synth', 'synthesizer'],
  'Rock / Band':  ['rock', 'metal', 'punk', 'grunge', 'hardrock', 'alternative', 'indie', 'guitar', 'blues', 'garage', 'emo', 'postrock'],
  'Pop':          ['pop', 'synthpop', 'electropop', 'dreampop', 'kpop', 'jpop', 'rnb', 'r&b', 'funk', 'disco', 'latin', 'reggae', 'gospel', 'country', 'singer', 'songwriter', 'vocal', 'catchy'],
}

// Best family for a set of tags, or null if nothing matches (caller falls back to DSP / station).
export function tagsToFamily(tags: string[] | undefined | null): Family | null {
  if (!tags?.length) return null
  const norm = tags.map(t => String(t).toLowerCase().replace(/[\s_]+/g, ''))
  const score = {} as Record<Family, number>
  for (const f of FAMILIES) score[f] = 0
  for (const t of norm) {
    for (const f of FAMILIES) {
      // exact tag match is strong; substring (e.g. "darksynthpop" contains "synthpop") is a soft hint
      if (CUES[f].includes(t)) score[f] += 2
      else if (CUES[f].some(c => c.length >= 4 && t.includes(c))) score[f] += 1
    }
  }
  let best: Family | null = null, top = 0
  for (const f of FAMILIES) if (score[f] > top) { top = score[f]; best = f }
  return top > 0 ? best : null
}
