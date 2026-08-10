// Isomorphic credit config — NO server-only imports — so API routes AND client components read the
// SAME numbers (mirrors lib/entitlements.ts). lib/credits.ts re-exports these and adds the DB ops.
//
// Prices/credits track ElevenLabs' *consumer* tiers (2026). Our transcription/vision is a HYBRID:
// only the low-confidence fraction hits paid AI, so the same credits go much further here. We do NOT
// offer the business-scale tiers (Scale/Business) yet — consumer + prosumer only.
//
// Credits-per-dollar (must stay monotonic ↑ so a bigger plan is never worse value; top-ups ≤ every
// subscription so subscribing always beats à-la-carte):
//   Starter  $6  / 30,000  = 5,000 /$
//   Creator  $22 / 121,000 = 5,500 /$   (ElevenLabs shows $11 = first-month-50%-off; $22 is standard)
//   Pro      $99 / 600,000 = 6,061 /$
//   top-up   $5  / 25,000  = 5,000 /$ ; $20 / 110,000 = 5,500 /$
export const CREDIT_TIERS = {
  free:    { price: 0,  monthlyCredits: 10_000,  label: 'Free' },
  starter: { price: 6,  monthlyCredits: 30_000,  label: 'Starter' },
  creator: { price: 22, monthlyCredits: 121_000, label: 'Creator' },
  pro:     { price: 99, monthlyCredits: 600_000, label: 'Pro' },
} as const
export type CreditTier = keyof typeof CREDIT_TIERS

// ── AI action costs (credits). The hybrid bills only the AI fraction (low-confidence spans), so real
//    spend is far below the nominal cost. ──
export const CREDIT_COSTS = {
  transcribeMinute: 200,   // per minute actually sent to the AI/smarter pass (low-confidence only)
  visionPage: 500,         // per sheet-music image/PDF page (Claude vision)
  generateClip: 2000,      // per AI music generation
  stems: 1500,             // per stem-separation
} as const

// One-time credit top-ups. Priced ≤ the subscription rate so a plan is always the better deal.
export const CREDIT_TOPUPS = [
  { credits: 25_000, usd: 5 },
  { credits: 110_000, usd: 20 },
] as const
