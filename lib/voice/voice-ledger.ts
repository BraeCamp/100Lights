'use client'
// ── What every command cost, and what it did not ─────────────────────────────
//
// Brae: "Give an option in voice control settings to see a log with lumens and
// macros used, amounts of calls, costs per call, stuff like that".
//
// ⚠️ THE FREE ROWS ARE THE POINT. A ledger of only the paid commands would show
// a bill going up and nothing else, which is exactly backwards: most of the
// work this system does now is answering without asking anybody, and the number
// worth watching is how much of the traffic never reaches the model. So every
// command is recorded with HOW it was answered, and the summary reports what
// the free paths saved as well as what the paid one spent.
//
// Local to the browser, and rolling. This is a read-out, not an audit: the
// server's api_usage table is the record of what was actually billed, and the
// admin Usage panel is where that lives.

export type AnsweredBy = 'rules' | 'learned' | 'shared' | 'assistant' | 'macro'

export interface LedgerEntry {
  at: number
  said: string
  by: AnsweredBy
  /** Assistant only — everything below is absent for a free answer. */
  turns?: number
  tokensIn?: number
  tokensOut?: number
  cacheRead?: number
  cacheWrite?: number
  credits?: number
  usd?: number
  problem?: string
}

// ⚠️ THE SAME NUMBERS THE SERVER BILLS AT — lib/api-usage.ts for the rates, and
// the assist route for how a cache read and a cache write are weighed against
// an ordinary input token. Two tables that drift apart would produce a read-out
// that quietly disagrees with the invoice, which is worse than no read-out.
const IN_PER_TOKEN = 3 / 1e6
const OUT_PER_TOKEN = 15 / 1e6
const READ_WEIGHT = 0.1
const WRITE_WEIGHT = 1.25

export function costOf(u: { tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number }): number {
  const input = (u.tokensIn ?? 0) + (u.cacheWrite ?? 0) * WRITE_WEIGHT + (u.cacheRead ?? 0) * READ_WEIGHT
  return input * IN_PER_TOKEN + (u.tokensOut ?? 0) * OUT_PER_TOKEN
}

const KEY = 'light.ledger.v1'
const MAX = 200

let mem: LedgerEntry[] | null = null
const subs = new Set<() => void>()

function load(): LedgerEntry[] {
  if (mem) return mem
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    mem = Array.isArray(parsed) ? parsed.filter(e => e && typeof e.at === 'number') : []
  } catch { mem = [] }
  return mem
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(mem ?? [])) } catch { /* nothing to keep it in */ }
  for (const f of subs) f()
}

/** Watch the ledger, so an open panel updates as commands land. */
export function onLedger(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

export function recordCommand(e: Omit<LedgerEntry, 'at' | 'usd'> & { at?: number }): void {
  const entry: LedgerEntry = { ...e, at: e.at ?? Date.now() }
  if (entry.by === 'assistant') entry.usd = costOf(entry)
  const list = load()
  list.push(entry)
  if (list.length > MAX) list.splice(0, list.length - MAX)
  save()
}

export function ledger(): LedgerEntry[] {
  return load().slice().reverse()   // newest first, which is how anybody reads a log
}

export function clearLedger(): void {
  mem = []
  save()
}

export interface LedgerSummary {
  total: number
  byPath: Record<AnsweredBy, number>
  paid: number
  free: number
  usd: number
  credits: number
  /** Mean cost of the commands that DID reach the model. */
  perPaid: number
  /**
   * What the free paths saved, valued at what a paid command actually costs
   * here — not at a list price. With nothing paid yet there is no evidence for
   * what a command costs, so this stays zero rather than inventing a rate.
   */
  saved: number
  turns: number
}

export function ledgerSummary(): LedgerSummary {
  const list = load()
  const byPath: Record<AnsweredBy, number> = { rules: 0, learned: 0, shared: 0, assistant: 0, macro: 0 }
  let usd = 0, credits = 0, paid = 0, turns = 0
  for (const e of list) {
    byPath[e.by] = (byPath[e.by] ?? 0) + 1
    if (e.by === 'assistant') {
      paid++
      usd += e.usd ?? 0
      credits += e.credits ?? 0
      turns += e.turns ?? 0
    }
  }
  const perPaid = paid ? usd / paid : 0
  return {
    total: list.length,
    byPath,
    paid,
    free: list.length - paid,
    usd,
    credits,
    perPaid,
    saved: (list.length - paid) * perPaid,
    turns,
  }
}
