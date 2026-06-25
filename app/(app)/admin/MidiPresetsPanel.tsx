'use client'
import { useState, useEffect, useCallback } from 'react'
import { getPresets, addPreset, deletePreset, noteRangeLabel, presetDisplayName } from '../../../lib/midi-presets'
import type { MidiPreset } from '../../../lib/midi-presets'
import { libraryGetAll } from '../../../lib/sound-library'

const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 } as const
const BADGE = (color: string) => ({ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: color + '22', color, border: `1px solid ${color}55`, flexShrink: 0 } as const)

export default function MidiPresetsPanel() {
  const [presets,   setPresets]   = useState<MidiPreset[]>([])
  const [folders,   setFolders]   = useState<string[]>([])
  const [creating,  setCreating]  = useState(false)
  const [newName,   setNewName]   = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [newLo,     setNewLo]     = useState(36)
  const [newHi,     setNewHi]     = useState(84)
  const [newCat,    setNewCat]    = useState('')

  const refresh = useCallback(() => setPresets(getPresets()), [])

  useEffect(() => {
    refresh()
    // Load distinct folders from the library for the create form
    libraryGetAll().then(entries => {
      const seen = new Set<string>()
      const folderList: string[] = []
      for (const e of entries) {
        if (e.folder && !seen.has(e.folder)) { seen.add(e.folder); folderList.push(e.folder) }
      }
      setFolders(folderList.sort())
    }).catch(() => {})
  }, [refresh])

  function handleFolderChange(folder: string) {
    setNewFolder(folder)
    // Auto-detect note range from library entries in this folder
    libraryGetAll().then(entries => {
      const inFolder = entries.filter(e => e.folder === folder)
      const NOTE_PC: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }
      const midis = inFolder.flatMap(e => {
        const m = e.name.match(/^([A-G]#?)(-?\d+)$/)
        if (!m) return []
        const pc = NOTE_PC[m[1]]
        return pc !== undefined ? [(parseInt(m[2]) + 1) * 12 + pc] : []
      })
      if (midis.length > 0) {
        setNewLo(Math.min(...midis))
        setNewHi(Math.max(...midis))
      }
      // Auto-detect category from first entry
      if (inFolder[0]?.category) setNewCat(inFolder[0].category)
    }).catch(() => {})
  }

  function handleCreate() {
    if (!newName.trim() || !newFolder) return
    addPreset({ name: newName.trim(), folder: newFolder, loNote: newLo, hiNote: newHi, category: newCat })
    setCreating(false); setNewName(''); setNewFolder(''); refresh()
  }

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  function midiLabel(m: number) { return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}` }

  return (
    <div>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1 }}>
            {presets.length} preset{presets.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setCreating(v => !v)}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--accent)', background: 'var(--accent-subtle)', color: 'var(--accent-light)' }}
          >
            {creating ? 'Cancel' : '+ New preset'}
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                placeholder="Preset name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <select
                value={newFolder}
                onChange={e => handleFolderChange(e.target.value)}
                style={{ flex: 2, fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="">Select a folder…</option>
                {folders.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            {newFolder && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Range:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{midiLabel(newLo)}→{midiLabel(newHi)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>auto-detected from library</span>
              </div>
            )}
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || !newFolder}
              style={{ alignSelf: 'flex-end', fontSize: 11, padding: '4px 14px', borderRadius: 5, cursor: newName.trim() && newFolder ? 'pointer' : 'not-allowed', border: '1px solid var(--accent)', background: 'var(--accent-subtle)', color: 'var(--accent-light)', opacity: newName.trim() && newFolder ? 1 : 0.4 }}
            >
              Create
            </button>
          </div>
        )}

        {/* Preset rows */}
        {presets.length === 0 && (
          <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No presets yet</div>
        )}
        {presets.map(p => (
          <div key={p.id} style={ROW}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', marginRight: 8 }}>{p.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{noteRangeLabel(p)}</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
              {p.folder}
            </span>
            {p.builtIn
              ? <span style={BADGE('var(--text-muted)')}>built-in</span>
              : <button onClick={() => { deletePreset(p.id); refresh() }} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--error)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}>Delete</button>
            }
          </div>
        ))}
      </div>
    </div>
  )
}
