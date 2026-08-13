// Vector store for track embeddings (pgvector on Neon) — powers "inspired by ___" audio similarity.
// Embeddings come from ImageBind via Replicate (lib/audio-embed.ts), which puts audio AND text in
// the same 1024-dim space, so a text prompt can find sonically-similar tracks.
import { sql } from '@/lib/db'

export const EMBED_DIM = 1024   // ImageBind

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
      embedding vector(1024),
      added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // HNSW cosine index for fast nearest-neighbour.
  await sql`CREATE INDEX IF NOT EXISTS track_embeddings_vec_idx ON track_embeddings USING hnsw (embedding vector_cosine_ops)`
  ready = true
}

const toVec = (e: number[]) => `[${e.join(',')}]`

export interface EmbTrack { id: string; title: string; artist: string; audio: string; tags: string[]; source?: string }

export async function upsertEmbedding(t: EmbTrack, embedding: number[]): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO track_embeddings (id, title, artist, audio, tags, source, embedding)
    VALUES (${t.id}, ${t.title}, ${t.artist}, ${t.audio}, ${t.tags}, ${t.source ?? 'jamendo'}, ${toVec(embedding)}::vector)
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
  return rows[0].e.replace(/[[\]]/g, '').split(',').map(Number)
}

export interface SimilarTrack { id: string; title: string; artist: string; audio: string; tags: string[]; score: number }

export async function nearest(embedding: number[], limit = 30): Promise<SimilarTrack[]> {
  await ensure()
  const v = toVec(embedding)
  const rows = await sql`
    SELECT id, title, artist, audio, tags, (1 - (embedding <=> ${v}::vector)) AS score
    FROM track_embeddings WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${v}::vector LIMIT ${limit}`
  return rows.map(r => ({ id: String(r.id), title: String(r.title), artist: String(r.artist), audio: String(r.audio), tags: (r.tags as string[]) ?? [], score: Number(r.score) }))
}
