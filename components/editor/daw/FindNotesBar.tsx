'use client'

// Find & Select Notes — Live 12.1's filter toolbar, under the piano roll's
// own toolbar. Each control is one field of a NoteFilter (lib/find-notes.ts);
// they combine, Invert flips them, and Select makes the matches the roll's
// selection. The readout says in words what the filter means and how many
// notes it finds right now, so a wrong filter is visible before it is applied.

import { type NoteFilter, type NoteCondition, describeFilter, filterIsEmpty } from '@/lib/find-notes'

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function FindNotesBar({ filter, setFilter, count, total, onSelect, onClose, scaleOn }: {
  filter: NoteFilter
  setFilter: (f: NoteFilter) => void
  count: number
  total: number
  onSelect: () => void
  onClose: () => void
  scaleOn: boolean
}) {
  const set = <K extends keyof NoteFilter>(k: K, v: NoteFilter[K]) => setFilter({ ...filter, [k]: v })
  const num = (k: keyof NoteFilter, raw: string, lo: number, hi: number) => {
    const v = raw.trim() === '' ? undefined : Math.max(lo, Math.min(hi, Number(raw)))
    setFilter({ ...filter, [k]: v == null || Number.isNaN(v) ? undefined : v })
  }
  const empty = filterIsEmpty(filter)

  return (
    <div data-help-id="find-notes-bar" role="search" aria-label="Find and select notes" style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderTop: '1px solid var(--border)',
      background: 'var(--bg-elevated, #191919)', fontSize: 9, color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', flexShrink: 0 }}>FIND</span>

      <Field label="Pitch">
        <select data-help-id="find-pitch" value={filter.pitchClass ?? ''} onChange={e => set('pitchClass', e.target.value === '' ? undefined : Number(e.target.value))} style={sel} aria-label="Pitch class">
          <option value="">any</option>
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </Field>
      <Field label="Velocity">
        <input data-help-id="find-vel-min" type="number" min={1} max={127} placeholder="1" value={filter.velocityMin ?? ''} onChange={e => num('velocityMin', e.target.value, 1, 127)} style={inp} aria-label="Velocity at least" />
        <span>–</span>
        <input data-help-id="find-vel-max" type="number" min={1} max={127} placeholder="127" value={filter.velocityMax ?? ''} onChange={e => num('velocityMax', e.target.value, 1, 127)} style={inp} aria-label="Velocity at most" />
      </Field>
      <Field label="Chance %">
        <input data-help-id="find-chance-min" type="number" min={0} max={100} placeholder="0" value={filter.chanceMin ?? ''} onChange={e => num('chanceMin', e.target.value, 0, 100)} style={inp} aria-label="Chance at least" />
        <span>–</span>
        <input data-help-id="find-chance-max" type="number" min={0} max={100} placeholder="100" value={filter.chanceMax ?? ''} onChange={e => num('chanceMax', e.target.value, 0, 100)} style={inp} aria-label="Chance at most" />
      </Field>
      <Field label="Length">
        <input data-help-id="find-dur-min" type="number" min={0} step={0.25} placeholder="0" value={filter.durationMin ?? ''} onChange={e => num('durationMin', e.target.value, 0, 999)} style={inp} aria-label="Length at least, beats" />
        <span>–</span>
        <input data-help-id="find-dur-max" type="number" min={0} step={0.25} placeholder="∞" value={filter.durationMax ?? ''} onChange={e => num('durationMax', e.target.value, 0, 999)} style={inp} aria-label="Length at most, beats" />
      </Field>
      <Field label="Time">
        <input data-help-id="find-time-from" type="number" min={0} step={0.25} placeholder="0" value={filter.timeFrom ?? ''} onChange={e => num('timeFrom', e.target.value, 0, 9999)} style={inp} aria-label="Starting from beat" />
        <span>–</span>
        <input data-help-id="find-time-to" type="number" min={0} step={0.25} placeholder="end" value={filter.timeTo ?? ''} onChange={e => num('timeTo', e.target.value, 0, 9999)} style={inp} aria-label="Starting before beat" />
        <span title="Repeat the time window every this many beats — 4 for the same spot in every bar">↻</span>
        <input data-help-id="find-repeat" type="number" min={0} step={0.25} placeholder="—" value={filter.repeatEvery ?? ''} onChange={e => num('repeatEvery', e.target.value, 0, 9999)} style={inp} aria-label="Repeat every beats" />
      </Field>
      <Field label="Every">
        <input data-help-id="find-nth" type="number" min={1} max={64} placeholder="1" value={filter.everyNth ?? ''} onChange={e => num('everyNth', e.target.value, 1, 64)} style={{ ...inp, width: 30 }} aria-label="Every nth note" />
        <span>th, from</span>
        <input data-help-id="find-offset" type="number" min={0} max={64} placeholder="0" value={filter.offset ?? ''} onChange={e => num('offset', e.target.value, 0, 64)} style={{ ...inp, width: 30 }} aria-label="Offset" />
      </Field>
      <Field label="Condition">
        <select data-help-id="find-condition" value={filter.condition ?? ''} onChange={e => set('condition', (e.target.value || undefined) as NoteCondition | undefined)} style={sel} aria-label="Condition">
          <option value="">any</option>
          <option value="active">active</option>
          <option value="inactive">deactivated</option>
          <option value="chance">chance &lt; 100 %</option>
          <option value="deviation">has deviation</option>
        </select>
      </Field>
      <Field label="Scale">
        <select data-help-id="find-scale" value={filter.scale ?? ''} onChange={e => set('scale', (e.target.value || undefined) as 'in' | 'out' | undefined)} style={sel} aria-label="Scale" disabled={!scaleOn} title={scaleOn ? 'In or out of the song’s scale' : 'Set a key and scale first'}>
          <option value="">any</option>
          <option value="in">in</option>
          <option value="out">out</option>
        </select>
      </Field>
      <label data-help-id="find-invert" style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <input type="checkbox" checked={!!filter.invert} onChange={e => set('invert', e.target.checked || undefined)} /> Invert
      </label>

      <button data-help-id="find-select" onClick={onSelect} disabled={empty}
        title={empty ? 'Set a filter first' : `Select the ${count} matching notes`}
        style={{ ...btn, background: empty ? 'transparent' : 'rgb(var(--accent-rgb) / 0.2)', color: empty ? 'var(--text-muted)' : 'var(--accent-light)', border: `1px solid ${empty ? 'var(--border)' : 'rgb(var(--accent-rgb) / 0.45)'}` }}>
        Select {empty ? '' : `${count}/${total}`}
      </button>
      <button data-help-id="find-clear" onClick={() => setFilter({})} style={btn} title="Clear every filter">Clear</button>
      <span data-help-id="find-readout" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{describeFilter(filter)}</span>
      <div style={{ flex: 1 }} />
      <button onClick={onClose} style={btn} title="Close Find & Select">×</button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </span>
  )
}

const inp: React.CSSProperties = { width: 38, fontSize: 9, padding: '1px 3px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }
const sel: React.CSSProperties = { fontSize: 9, padding: '1px 2px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }
const btn: React.CSSProperties = { fontSize: 9, fontWeight: 600, padding: '1px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', flexShrink: 0 }
