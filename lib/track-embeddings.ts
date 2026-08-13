// Vector store for track embeddings (pgvector on Neon) — powers "inspired by ___" audio similarity.
// Embeddings come from a LOCAL CLAP model (scripts/clap-embed.py), which puts audio AND text in the
// same 512-d space. The store is populated offline (scripts/embed-jamendo.mjs); production only READS
// it (query-by-example: pick a seed track, return its nearest-by-sound neighbours), so nothing heavy
// runs on the server. Only commercial-safe tracks are stored, so every neighbour is broadcast-safe.
import { sql } from '@/lib/db'

export const EMBED_DIM = 512   // CLAP (laion/clap-htsat-unfused)

let ready = false
async function ensure() {
  if (ready) return
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`
    CREATE TABLE IF NOT EXISTS track_embeddings (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL DEFAULT '',
      artist    TEXT NOT NULL DEFAULT '',
      audio     TEXT NOT NULL,
      tags      TEXT[] NOT NULL DEFAULT '{}',
      source    TEXT NOT NULL DEFAULT 'jamendo',
      license   TEXT NOT NULL DEFAULT '',
      embedding vector(512),
      added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // HNSW cosine index for fast nearest-neighbour.
  await sql`CREATE INDEX IF NOT EXISTS track_embeddings_vec_idx ON track_embeddings USING hnsw (embedding vector_cosine_ops)`
  ready = true
}

const toVec = (e: number[]) => `[${e.join(',')}]`
const parseVec = (s: string) => s.replace(/[[\]]/g, '').split(',').map(Number)

export interface EmbTrack { id: string; title: string; artist: string; audio: string; tags: string[]; source?: string; license?: string }

export async function upsertEmbedding(t: EmbTrack, embedding: number[]): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO track_embeddings (id, title, artist, audio, tags, source, license, embedding)
    VALUES (${t.id}, ${t.title}, ${t.artist}, ${t.audio}, ${t.tags}, ${t.source ?? 'jamendo'}, ${t.license ?? ''}, ${toVec(embedding)}::vector)
    ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, tags = EXCLUDED.tags, title = EXCLUDED.title, artist = EXCLUDED.artist`
}

export async function embeddingCount(): Promise<number> {
  await ensure()
  try { const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM track_embeddings WHERE embedding IS NOT NULL` as { n: number }[]; return n }
  catch { return 0 }
}

export async function getEmbeddingById(id: string): Promise<number[] | null> {
  await ensure()
  const rows = await sql`SELECT embedding::text AS e FROM track_embeddings WHERE id = ${id}` as { e: string }[]
  if (!rows.length || !rows[0].e) return null
  return parseVec(rows[0].e)
}

export interface Seed { id: string; title: string; artist: string; embedding: number[]; overlap: number }

// Query-by-example seed: the embedded track whose own tags best overlap the target vibe tags. This is
// how a text prompt reaches the audio space without running any model in production.
export async function seedByTags(targetTags: string[]): Promise<Seed | null> {
  await ensure()
  const tags = targetTags.map(t => t.toLowerCase()).filter(Boolean)
  if (!tags.length) return null
  const rows = await sql`
    SELECT id, title, artist, embedding::text AS e,
      (SELECT COUNT(*)::int FROM unnest(tags) g WHERE g = ANY(${tags})) AS overlap
    FROM track_embeddings
    WHERE embedding IS NOT NULL AND tags && ${tags}
    ORDER BY overlap DESC, added_at DESC
    LIMIT 1` as { id: string; title: string; artist: string; e: string; overlap: number }[]
  if (!rows.length || !rows[0].e) return null
  return { id: rows[0].id, title: rows[0].title, artist: rows[0].artist, embedding: parseVec(rows[0].e), overlap: Number(rows[0].overlap) }
}

export interface SimilarTrack { id: string; title: string; artist: string; audio: string; tags: string[]; license: string; score: number }

export async function nearest(embedding: number[], limit = 30, excludeId?: string): Promise<SimilarTrack[]> {
  await ensure()
  const v = toVec(embedding)
  const rows = await sql`
    SELECT id, title, artist, audio, tags, license, (1 - (embedding <=> ${v}::vector)) AS score
    FROM track_embeddings
    WHERE embedding IS NOT NULL AND (${excludeId ?? null}::text IS NULL OR id <> ${excludeId ?? null})
    ORDER BY embedding <=> ${v}::vector LIMIT ${limit}`
  return rows.map(r => ({ id: String(r.id), title: String(r.title), artist: String(r.artist), audio: String(r.audio), tags: (r.tags as string[]) ?? [], license: String(r.license ?? ''), score: Number(r.score) }))
}
