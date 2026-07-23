// Shared Learn-article widget-marker validation.
//
// `renderMarkdown` in simple-markdown.tsx silently skips a malformed
// @grid/@ab/@synth/@progression/@audio/@sound marker — a try/catch swallows bad
// JSON, and a valid-JSON-but-wrong-shape payload (missing lanes/chords/srcs)
// hits a field guard and renders nothing. Either way a typo just vanishes from
// the page with no error.
//
// scripts/validate-articles.mjs runs the same *parse* checks over committed .md
// files at build time. This module is the runtime twin for the admin editor —
// the database-authoring path the build never sees — and additionally catches
// wrong-shape payloads and un-filled template placeholders. Keep the two aligned.

export interface MarkerIssue {
  /** 1-based line number in the body. */
  line: number
  marker: string
  message: string
}

const JSON_MARKERS = ['grid', 'ab', 'synth', 'progression'] as const
const ARG_MARKERS = ['sound', 'audio'] as const
const ALL: readonly string[] = [...JSON_MARKERS, ...ARG_MARKERS]

// Fields each widget needs before it renders anything — mirrors the guards in
// simple-markdown.tsx (spec.lanes?.length, plainSrc && treatedSrc, chords?.length).
// A payload that parses but lacks these draws a blank, which is the sneakiest
// failure because Preview shows nothing wrong — just nothing.
function shapeIssue(name: string, spec: unknown): string | null {
  const o = (spec ?? {}) as Record<string, unknown>
  if (name === 'grid') return Array.isArray(o.lanes) && o.lanes.length ? null : "has valid JSON but no 'lanes' — the beat grid renders nothing"
  if (name === 'ab') return o.plainSrc && o.treatedSrc ? null : 'has valid JSON but is missing plainSrc or treatedSrc — the A/B test renders nothing'
  if (name === 'progression') return Array.isArray(o.chords) && o.chords.length ? null : "has valid JSON but no 'chords' — the progression renders nothing"
  return null  // @synth renders with any object
}

/** Every marker in `body` that will silently fail to render, with line numbers. */
export function validateMarkers(body: string): MarkerIssue[] {
  const issues: MarkerIssue[] = []
  body.split('\n').forEach((raw, i) => {
    const line = raw.trimStart()
    const ln = i + 1
    for (const name of ALL) {
      if (!line.startsWith('@' + name)) continue
      const rest = line.slice(name.length + 1)  // chars after "@name"
      if (/^[a-z]/i.test(rest)) break            // a longer word (@audioX), not this marker
      if (!rest.startsWith('(')) { issues.push({ line: ln, marker: name, message: 'is missing its ( … ) payload' }); break }
      const m = line.match(new RegExp(`^@${name}\\(([^)]*)\\)`))
      if (!m) { issues.push({ line: ln, marker: name, message: '( … ) has no closing paren' }); break }
      const payload = m[1]
      if (JSON_MARKERS.includes(name as (typeof JSON_MARKERS)[number])) {
        let spec: unknown
        try {
          spec = JSON.parse(decodeURIComponent(payload))
        } catch (e) {
          issues.push({ line: ln, marker: name, message: `payload is not valid URI-encoded JSON — ${(e as Error).message}` })
          break
        }
        const shape = shapeIssue(name, spec)
        if (shape) issues.push({ line: ln, marker: name, message: shape })
      } else if (!payload.trim()) {
        issues.push({ line: ln, marker: name, message: '() has an empty argument' })
      }
      break
    }
    // Template markers ship with REPLACE_WITH… placeholders; if left in, the
    // widget renders but points at nothing.
    if (line.includes('REPLACE_WITH')) {
      const mk = ALL.find(n => line.includes('@' + n)) ?? 'marker'
      issues.push({ line: ln, marker: mk, message: 'still has a REPLACE_WITH… placeholder — fill in the real value' })
    }
  })
  return issues
}
