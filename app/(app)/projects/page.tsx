'use client'

import { SaveOfflineItem } from '@/components/projects/SaveOfflineItem'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Film, PlusCircle, Clock, FolderOpen, Trash2, AlertCircle, RefreshCw, Star, Folder, FolderPlus, Cloud, HardDrive, FileX, X, Search, Pencil, Check, ExternalLink } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { readProjectFile } from '@/lib/project-serializer'
import { useProjectImport } from '@/components/site/useProjectImport'
import { projectPath } from '@/lib/project-url'
import { saveFolder, loadFolder, clearFolder, verifyPermission, verifyWritePermission } from '@/lib/local-folder'
import { ConfirmDialog } from '@/components/ConfirmDialog'

const CF_EXT = '.cfproj'

interface CloudSummary {
  id: string
  name: string
  savedAt: string
  starred: boolean
  clips: number
  media: number
  thumbnail: string | null
  slug: string | null
  username: string | null
  folderId: string | null
  modules: string[] | null
}

interface FolderRec { id: string; name: string; parentId: string | null; banner: string | null; logo: string | null }

// Downscale a picked image to a data URL small enough to store on the folder row. Banners go to JPEG
// (opaque, wide); logos stay PNG so transparency is preserved.
function fileToDataUrl(file: File, maxW: number, maxH: number, mime: 'image/jpeg' | 'image/png', quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height)
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      try { resolve(c.toDataURL(mime, quality)) } catch (e) { reject(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')) }
    img.src = url
  })
}

interface LocalFileHandle {
  name: string
  handle: FileSystemFileHandle
  modifiedAt: number | null
}

// One row in the unified list — either a cloud project or a local file.
type Row =
  | { source: 'cloud'; key: string; ts: number; name: string; id: string; starred: boolean; clips: number; media: number; thumbnail: string | null; slug: string | null; username: string | null; folderId: string | null; modules: string[] | null }
  | { source: 'local'; key: string; ts: number; name: string; file: LocalFileHandle }

// Link straight to the canonical /@username/slug-code URL so opening a project
// no longer bounces through /projects/{id} first. Falls back to /projects/{id}
// when the project has no owner username yet (projectPath handles that).
const cloudHref = (r: { username: string | null; slug: string | null; id: string; modules?: string[] | null }) =>
  // Apollo sessions live in the synth, not the studio editor.
  r.modules?.length === 1 && r.modules[0] === 'apollo'
    ? `/apollo?session=${r.id}`
    : projectPath(r.username, r.slug, r.id)

const isApolloRow = (r: { modules?: string[] | null }) => r.modules?.length === 1 && r.modules[0] === 'apollo'

/** Open an Apollo session as a Beacon track: fetch the session's patch, stash
 *  the neutral seed, land in the studio. */
async function openSessionInBeacon(id: string, name: string, go: (href: string) => void) {
  try {
    const res = await fetch(`/api/projects/${id}`)
    if (!res.ok) return
    const d = await res.json() as { apollo?: { patch?: object } }
    if (!d?.apollo?.patch) return
    sessionStorage.setItem('100lights-apollo-seed', JSON.stringify({ patch: d.apollo.patch, name }))
    // ⚠️ NOT window.location. A full page load throws away the JavaScript
    // context and everything living in it — including Light, which is mounted
    // in the app layout precisely so that it can outlive the page you started
    // talking on. Brae: "the voice controls don't stay alive when changing
    // projects." This is one of the two places that was killing it.
    go('/create?modules=audio&audioMode=music')
  } catch { /* offline */ }
}

function formatDate(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Unified list (cloud + local folder, in one place) ───────────────────────

function UnifiedProjects({ isSignedIn, reloadKey }: { isSignedIn: boolean; reloadKey: number }) {
  const router = useRouter()
  const [cloud, setCloud]       = useState<CloudSummary[]>([])
  const [cloudErr, setCloudErr] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(isSignedIn)

  const [folder, setFolder]     = useState<FileSystemDirectoryHandle | null>(null)
  const [local, setLocal]       = useState<LocalFileHandle[]>([])
  const [localLoading, setLocalLoading] = useState(true)

  const [opening, setOpening]   = useState<string | null>(null)
  const [ctxMenu, setCtxMenu]   = useState<{ id: string; starred: boolean; x: number; y: number; href: string; folderId: string | null } | null>(null)
  const [confirmDel, setConfirmDel] = useState<
    | { kind: 'cloud'; id: string; name: string }
    | { kind: 'local'; name: string }
    | { kind: 'folder'; id: string; name: string }
    | { kind: 'bulk'; ids: string[] }
    | null
  >(null)

  // ── Search / sort ──
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState<'recent' | 'name' | 'oldest'>('recent')
  const [dragId, setDragId] = useState<string | null>(null)     // project being dragged onto a folder
  const [dropFolder, setDropFolder] = useState<string | null | 'all'>(null)   // folder chip hovered during drag

  // ── Folders (cloud, per-user) ──
  const [folders, setFolders]   = useState<FolderRec[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)   // null = All
  const [folderMenu, setFolderMenu] = useState<boolean>(false)   // "Move to folder" submenu open in ctx menu
  const [folderCtx, setFolderCtx] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const folderCount = useCallback((id: string) => cloud.filter(p => p.folderId === id).length, [cloud])
  const [editFolder, setEditFolder] = useState<FolderRec | null>(null)   // folder open in the edit modal
  const loadFolders = useCallback(() => {
    if (!isSignedIn) return
    fetch('/api/folders').then(r => (r.ok ? r.json() : [])).then((d: FolderRec[]) => setFolders(Array.isArray(d) ? d : [])).catch(() => {})
  }, [isSignedIn])
  useEffect(() => { loadFolders() }, [loadFolders, reloadKey])

  async function createFolder(parentId: string | null = activeFolder) {
    const name = window.prompt(parentId ? 'New subfolder name:' : 'New folder name:')?.trim()
    if (!name) return
    const r = await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId }) })
    if (r.ok) loadFolders()
  }
  // Confirmation flows through the in-app ConfirmDialog (see performDelete) — no native window.confirm,
  // so it works the same in the browser, desktop (Electron) and mobile shells.
  function requestDeleteFolder(id: string, name: string) {
    setConfirmDel({ kind: 'folder', id, name })
  }
  async function deleteFolder(id: string) {
    await fetch(`/api/folders?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (activeFolder === id) setActiveFolder(null)
    setCloud(prev => prev.map(p => p.folderId === id ? { ...p, folderId: null } : p))
    loadFolders()
  }
  function moveToFolder(projectId: string, folderId: string | null) {
    setCloud(prev => prev.map(p => p.id === projectId ? { ...p, folderId } : p))
    fetch(`/api/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId }) }).catch(() => {})
  }

  // ── Multi-select (bulk move / star / delete). Checkbox toggles; shift-click selects a range. ──
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const clearSel = useCallback(() => { setSelected(new Set()); setAnchor(null) }, [])
  // Toggle one id; with shift, select the contiguous range from the anchor in `order`.
  function selectRow(id: string, order: string[], shift: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (shift && anchor && order.includes(anchor) && order.includes(id)) {
        const a = order.indexOf(anchor), b = order.indexOf(id)
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(order[i])
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
        setAnchor(id)
      }
      return next
    })
  }
  function bulkDelete() {
    const ids = [...selected]
    if (!ids.length) return
    setConfirmDel({ kind: 'bulk', ids })
  }
  function bulkMove(folderId: string | null) {
    const ids = [...selected]
    setBulkMoveOpen(false)
    setCloud(prev => prev.map(p => selected.has(p.id) ? { ...p, folderId } : p))
    clearSel()
    void Promise.allSettled(ids.map(id => fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId }) })))
  }
  function bulkStar(star: boolean) {
    // PATCH with an empty body TOGGLES starred — so only flip the ones not already in the target state.
    const flip = cloud.filter(p => selected.has(p.id) && !!p.starred !== star)
    setCloud(prev => prev.map(p => selected.has(p.id) ? { ...p, starred: star } : p))
    void Promise.allSettled(flip.map(p => fetch(`/api/projects/${p.id}`, { method: 'PATCH' })))
  }

  // ── Cloud ──
  const loadCloud = useCallback(() => {
    if (!isSignedIn) { setCloudLoading(false); return }
    setCloudLoading(true)
    setCloudErr(false)
    fetch('/api/projects')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: CloudSummary[]) => setCloud(data))
      .catch(() => setCloudErr(true))
      .finally(() => setCloudLoading(false))
  }, [isSignedIn])

  useEffect(() => { loadCloud() }, [loadCloud, reloadKey])

  // ── Local folder ──
  const readLocal = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setLocalLoading(true)
    const list: LocalFileHandle[] = []
    for await (const [name, entry] of (handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'file') continue
      if (!(name.endsWith(CF_EXT) || name.endsWith('.zip'))) continue
      const file = await (entry as FileSystemFileHandle).getFile().catch(() => null)
      list.push({ name, handle: entry as FileSystemFileHandle, modifiedAt: file?.lastModified ?? null })
    }
    setLocal(list)
    setLocalLoading(false)
  }, [])

  useEffect(() => {
    loadFolder()
      .then(async handle => {
        if (!handle) { setLocalLoading(false); return }
        const ok = await verifyPermission(handle).catch(() => false)
        if (ok) { setFolder(handle); await readLocal(handle) }
        else { await clearFolder(); setLocalLoading(false) }
      })
      .catch(() => setLocalLoading(false))
  }, [readLocal])

  async function connectFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) { alert('Your browser doesn\'t support folder access. Try Chrome or Edge.'); return }
    // Ask for read+write so this same folder also works as a save destination.
    const handle = await picker({ mode: 'readwrite' }).catch(() => null)
    if (!handle) return
    await saveFolder(handle)
    setFolder(handle)
    await readLocal(handle)
  }

  async function disconnectFolder() {
    await clearFolder()
    setFolder(null)
    setLocal([])
  }

  async function openLocal(f: LocalFileHandle) {
    setOpening(f.name)
    try {
      const { project } = await readProjectFile(await f.handle.getFile())
      localStorage.setItem(`cf_pending_cfproj_${project.id}`, JSON.stringify(project))
      // Client-side, for the same reason as openSessionInBeacon above.
      router.push(`/projects/${project.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not open this file. It may be corrupted or not a valid 100Lights project.')
    } finally {
      setOpening(null)
    }
  }

  // ── Deletes ──
  function requestDeleteCloud(id: string) {
    const p = cloud.find(x => x.id === id)
    setConfirmDel({ kind: 'cloud', id, name: p?.name ?? 'this project' })
  }
  function requestDeleteLocal(name: string) {
    setConfirmDel({ kind: 'local', name })
  }

  async function performDelete() {
    const target = confirmDel
    if (!target) return
    setConfirmDel(null)
    if (target.kind === 'folder') {
      await deleteFolder(target.id)
    } else if (target.kind === 'bulk') {
      const ids = target.ids
      setCloud(prev => prev.filter(p => !ids.includes(p.id)))
      clearSel()
      await Promise.allSettled(ids.map(id => fetch(`/api/projects/${id}`, { method: 'DELETE' })))
    } else if (target.kind === 'cloud') {
      setCloud(prev => prev.filter(p => p.id !== target.id))
      await fetch(`/api/projects/${target.id}`, { method: 'DELETE' }).catch(() => loadCloud())
    } else {
      if (!folder) return
      try {
        if (!(await verifyWritePermission(folder))) { alert('Permission to modify this folder was denied.'); return }
        await (folder as FileSystemDirectoryHandle & { removeEntry(n: string): Promise<void> }).removeEntry(target.name)
        setLocal(prev => prev.filter(f => f.name !== target.name))
      } catch {
        alert('Could not delete that file.')
      }
    }
  }

  function toggleStar(id: string) {
    setCloud(prev => prev.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
    fetch(`/api/projects/${id}`, { method: 'PATCH' }).catch(() => {
      setCloud(prev => prev.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
    })
  }

  // Close the right-click menu on any click, scroll, or Escape
  useEffect(() => {
    if (!ctxMenu && !folderCtx && !bulkMoveOpen) return
    const close = () => { setCtxMenu(null); setFolderCtx(null); setBulkMoveOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setCtxMenu(null); setFolderCtx(null); setBulkMoveOpen(false); clearSel() } }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu, folderCtx, bulkMoveOpen, clearSel])

  // Clear the multi-select when switching folders (selection is scoped to the current view).
  useEffect(() => { setSelected(new Set()); setAnchor(null) }, [activeFolder])

  const loading = cloudLoading || localLoading

  // ── Merge + sort (starred cloud first, then newest across both) ──
  const q = search.trim().toLowerCase()
  const rows: Row[] = [
    // A project lives INSIDE its folder, not also at the root: the root view (activeFolder null) shows
    // only unfiled projects, and a folder shows only its own. Exception: an active search is global, so
    // a filed project is still findable from anywhere. Local files aren't folder-able → root only.
    ...cloud
      .filter(p => q ? true : (p.folderId ?? null) === activeFolder)
      .map((p): Row => ({ source: 'cloud', key: `c:${p.id}`, ts: Date.parse(p.savedAt) || 0, name: p.name, id: p.id, starred: p.starred, clips: p.clips, media: p.media, thumbnail: p.thumbnail, slug: p.slug, username: p.username, folderId: p.folderId, modules: p.modules })),
    ...(activeFolder === null ? local.map((f): Row => ({ source: 'local', key: `l:${f.name}`, ts: f.modifiedAt ?? 0, name: f.name.replace(/\.(cfproj|zip)$/i, ''), file: f })) : []),
  ]
    .filter(r => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === 'name')   return a.name.localeCompare(b.name)
      if (sort === 'oldest') return a.ts - b.ts
      // recent (default): starred cloud first, then newest.
      const aStar = a.source === 'cloud' && a.starred ? 1 : 0
      const bStar = b.source === 'cloud' && b.starred ? 1 : 0
      if (aStar !== bStar) return bStar - aStar
      return b.ts - a.ts
    })

  // Ordered cloud ids (visible order) for shift-range selection.
  const orderedCloudIds = rows.filter(r => r.source === 'cloud').map(r => r.id)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading projects…</span>
      </div>
    )
  }

  return (
    <div>
      {/* Storage sources bar — shows where projects live and lets any user connect a local folder */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {isSignedIn && (
          <span className="flex items-center gap-1.5">
            <Cloud size={13} color="var(--accent-light)" />
            <span style={{ color: 'var(--text-secondary)' }}>{cloud.length}</span> in the cloud
          </span>
        )}
        {folder ? (
          <span className="flex items-center gap-1.5">
            <HardDrive size={13} />
            <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{folder.name}</span>
            · {local.length} local
            <button onClick={disconnectFolder} className="ml-1 underline" style={{ color: 'var(--text-muted)' }}>disconnect</button>
          </span>
        ) : (
          <button onClick={connectFolder} className="flex items-center gap-1.5 underline" style={{ color: 'var(--text-muted)' }}>
            <Folder size={13} /> Connect a local folder
          </button>
        )}
      </div>

      {cloudErr && (
        <div className="flex items-center justify-between mb-3 px-4 py-2.5 rounded-lg border text-sm" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-2"><AlertCircle size={15} color="var(--text-muted)" /> Couldn’t load your cloud projects.</span>
          <button onClick={loadCloud} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Search + sort */}
      {isSignedIn && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            {search && <button onClick={() => setSearch('')} title="Clear" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as typeof sort)}
            title="Sort"
            className="text-sm rounded-lg px-3 py-2"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <option value="recent">Recent</option>
            <option value="name">Name A–Z</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      )}

      {/* Breadcrumb (navigation only) + New folder. The folders themselves render as rows in the
          list below — like a file browser — not as tabs. Drag a project onto a crumb to file it. */}
      {isSignedIn && (() => {
        const byId = new Map(folders.map(f => [f.id, f]))
        const path: FolderRec[] = []
        { let cur = activeFolder; const seen = new Set<string>(); while (cur && byId.has(cur) && !seen.has(cur)) { seen.add(cur); const f = byId.get(cur)!; path.unshift(f); cur = f.parentId } }
        const crumb = (label: string, target: string | null, active: boolean) => (
          <button
            onClick={() => setActiveFolder(target)}
            onDragOver={(e) => { if (!dragId) return; e.preventDefault(); setDropFolder(target ?? 'all') }}
            onDragLeave={() => setDropFolder(null)}
            onDrop={(e) => { if (!dragId) return; e.preventDefault(); moveToFolder(dragId, target); setDropFolder(null); setDragId(null) }}
            className="px-1.5 py-0.5 rounded text-sm"
            style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 500 : 400, background: dropFolder === (target ?? 'all') ? 'var(--accent-subtle)' : 'transparent' }}
          >{label}</button>
        )
        return (
          <div className="flex items-center gap-1 mb-4 flex-wrap">
            {crumb('All projects', null, activeFolder === null)}
            {path.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <span style={{ color: 'var(--text-muted)' }}>›</span>
                {crumb(f.name, f.id, i === path.length - 1)}
              </span>
            ))}
            <button onClick={() => createFolder()} className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg" style={{ border: '1px dashed var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <FolderPlus size={12} /> {activeFolder ? 'New subfolder' : 'New folder'}
            </button>
          </div>
        )
      })()}

      {/* ── Folder header banner (only inside a folder that has a custom banner/logo) ── */}
      {isSignedIn && activeFolder && (() => {
        const f = folders.find(x => x.id === activeFolder)
        if (!f || (!f.banner && !f.logo)) return null
        return <FolderHeader folder={f} onEdit={() => setEditFolder(f)} />
      })()}

      {/* ── Multi-select action bar (appears when 1+ projects are selected) ── */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex items-center gap-2 p-2.5 mb-2 rounded-xl border shadow-sm" style={{ background: 'var(--accent-subtle)', borderColor: 'var(--accent)' }}>
          <span className="text-sm font-semibold px-1.5" style={{ color: 'var(--text-primary)' }}>{selected.size} selected</span>
          {orderedCloudIds.length > selected.size && (
            <button onClick={() => { setSelected(new Set(orderedCloudIds)); setAnchor(null) }} className="text-xs px-2 py-1 rounded-md" style={{ color: 'var(--accent)' }}>Select all ({orderedCloudIds.length})</button>
          )}
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setBulkMoveOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <Folder size={14} /> Move to…
            </button>
            {bulkMoveOpen && (
              <div className="absolute right-0 mt-1 py-1 rounded-lg border shadow-lg z-30 max-h-64 overflow-auto" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', minWidth: 190 }}>
                <button onClick={() => bulkMove(null)} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>All projects (no folder)</button>
                {folders.map(f => (
                  <button key={f.id} onClick={() => bulkMove(f.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                    <Folder size={13} color="var(--accent-light)" /> {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => bulkStar(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-card)', color: '#f59e0b' }} title="Star selected"><Star size={14} /> Star</button>
          <button onClick={bulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-card)', color: '#ef4444' }} title="Move selected to trash"><Trash2 size={14} /> Delete</button>
          <button onClick={clearSel} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} title="Clear selection"><X size={16} /></button>
        </div>
      )}

      {rows.length === 0 && !(isSignedIn && folders.some(f => (f.parentId ?? null) === activeFolder)) ? (
        <EmptyState isSignedIn={isSignedIn} hasFolder={!!folder} onConnect={connectFolder} />
      ) : (
        <div className="flex flex-col gap-2">
          {/* Folders live IN the list (like a file browser): click to open, drag a project onto one
              to file it, right-click for rename / subfolder / delete. */}
          {isSignedIn && folders.filter(f => (q ? f.name.toLowerCase().includes(q) : (f.parentId ?? null) === activeFolder)).map(f => {
            const n = folderCount(f.id)
            const over = dropFolder === f.id
            const kids = folders.some(x => x.parentId === f.id)
            return (
              <div
                key={`folder:${f.id}`}
                onClick={() => setActiveFolder(f.id)}
                onContextMenu={(e) => { e.preventDefault(); setFolderCtx({ id: f.id, name: f.name, x: e.clientX, y: e.clientY }) }}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); setDropFolder(f.id) }}
                onDragLeave={() => setDropFolder(null)}
                onDrop={(e) => { if (!dragId) return; e.preventDefault(); moveToFolder(dragId, f.id); setDropFolder(null); setDragId(null) }}
                className="group flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer"
                style={{ background: over ? 'var(--accent-subtle)' : 'var(--bg-card)', borderColor: over ? 'var(--accent)' : 'var(--border)' }}
              >
                <FolderThumb folder={f} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{n} project{n !== 1 ? 's' : ''}{kids ? ' · has subfolders' : ''}</div>
                </div>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Folder</span>
                <button onClick={(e) => { e.stopPropagation(); setEditFolder(f) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} title="Edit folder (name, banner, logo)">
                  <Pencil size={14} />
                </button>
              </div>
            )
          })}
          {rows.map(row => row.source === 'cloud' ? (
            <div
              key={row.key}
              draggable
              onDragStart={(e) => {
                setDragId(row.id)
                e.dataTransfer.effectAllowed = 'copyMove'
                // Also carry the project URL so dragging the row onto the browser tab bar (or another
                // window) opens it in a new tab — the internal folder-drop still uses dragId, not this.
                try { const url = new URL(cloudHref(row), window.location.origin).href; e.dataTransfer.setData('text/uri-list', url); e.dataTransfer.setData('text/plain', url) } catch { /* origin unavailable */ }
              }}
              onDragEnd={() => { setDragId(null); setDropFolder(null) }}
              className="group flex items-center gap-4 p-4 rounded-xl border transition-all"
              style={{ background: selected.has(row.id) ? 'var(--accent-subtle)' : 'var(--bg-card)', borderColor: selected.has(row.id) ? 'var(--accent)' : row.starred ? 'rgba(139,92,246,0.4)' : 'var(--border)', opacity: dragId === row.id ? 0.5 : 1, cursor: 'default' }}
              onContextMenu={(e) => { e.preventDefault(); setFolderMenu(false); setCtxMenu({ id: row.id, starred: row.starred, x: e.clientX, y: e.clientY, href: cloudHref(row), folderId: row.folderId }) }}
            >
              {/* Select checkbox — shows on hover, or always while a selection is active. Shift-click = range. */}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectRow(row.id, orderedCloudIds, e.shiftKey) }}
                className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-opacity ${selected.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ borderColor: selected.has(row.id) ? 'var(--accent)' : 'var(--border)', background: selected.has(row.id) ? 'var(--accent)' : 'transparent' }}
                title="Select (shift-click for range)"
                aria-pressed={selected.has(row.id)}
              >
                {selected.has(row.id) && <Check size={13} color="#fff" />}
              </button>
              {/* Hard navigation (plain <a>): a full load reliably hits the
                  canonical server route, avoiding client-router quirks with the
                  @-prefixed path. Opening a project reloads the editor anyway. */}
              <Link href={cloudHref(row)} draggable={false} className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--border)' }}>
                {row.thumbnail ? <img src={row.thumbnail} draggable={false} className="w-full h-full object-cover" alt="" /> : <Film size={16} color="var(--text-secondary)" />}
              </Link>
              <Link href={cloudHref(row)} draggable={false} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.name}</span>
                  <SourceBadge source="cloud" />
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {row.clips} clip{row.clips !== 1 ? 's' : ''} · {row.media} media file{row.media !== 1 ? 's' : ''}
                </div>
              </Link>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(row.ts)}</span>
              {isApolloRow(row) && (
                <button
                  onClick={(e) => { e.preventDefault(); void openSessionInBeacon(row.id, row.name, href => router.push(href)) }}
                  title="Open this session as an Apollo track in the Beacon studio"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-xs font-semibold"
                  style={{ color: 'var(--accent-light)' }}
                >Beacon ↗</button>
              )}
              <button onClick={() => toggleStar(row.id)} title={row.starred ? 'Unstar' : 'Star'} className="p-1.5 rounded-lg" style={{ color: row.starred ? '#f59e0b' : 'var(--text-muted)' }}>
                <Star size={14} fill={row.starred ? '#f59e0b' : 'none'} />
              </button>
              <button onClick={(e) => { e.preventDefault(); requestDeleteCloud(row.id) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} title="Delete project">
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <div
              key={row.key}
              className="group flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
              onClick={() => openLocal(row.file)}
            >
              <div className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--border)' }}>
                <Film size={16} color="var(--accent-light)" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.name}</span>
                  <SourceBadge source="local" />
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>On this computer</div>
              </div>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(row.ts)}</span>
              {opening === row.file.name && <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Opening…</span>}
              <button onClick={(e) => { e.stopPropagation(); requestDeleteLocal(row.file.name) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} title="Delete file from computer">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[168px] rounded-lg border py-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y, background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <a href={ctxMenu.href} className="flex items-center gap-2.5 px-3.5 py-2 text-sm no-underline" style={{ color: 'var(--text-primary)' }}>
            <FolderOpen size={14} /> Open
          </a>
          <a href={ctxMenu.href} target="_blank" rel="noopener noreferrer" onClick={() => setCtxMenu(null)} className="flex items-center gap-2.5 px-3.5 py-2 text-sm no-underline" style={{ color: 'var(--text-primary)' }}>
            <ExternalLink size={14} /> Open in new tab
          </a>
          <button onClick={() => { toggleStar(ctxMenu.id); setCtxMenu(null) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: 'var(--text-primary)' }}>
            <Star size={14} fill={ctxMenu.starred ? '#f59e0b' : 'none'} color={ctxMenu.starred ? '#f59e0b' : 'currentColor'} />
            {ctxMenu.starred ? 'Unstar' : 'Star'}
          </button>
          {/* Move to folder */}
          <button onClick={() => setFolderMenu(v => !v)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: 'var(--text-primary)' }}>
            <Folder size={14} /> Move to folder…
          </button>
          {folderMenu && (
            <div className="mx-1 mb-1 rounded-md py-1" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', maxHeight: 200, overflowY: 'auto' }}>
              {ctxMenu.folderId && (
                <button onClick={() => { moveToFolder(ctxMenu.id, null); setCtxMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left" style={{ color: 'var(--text-muted)' }}>
                  <X size={12} /> None (unfile)
                </button>
              )}
              {folders.length === 0 && <div className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>No folders yet.</div>}
              {folders.map(f => (
                <button key={f.id} onClick={() => { moveToFolder(ctxMenu.id, f.id); setCtxMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left" style={{ color: ctxMenu.folderId === f.id ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                  <Folder size={12} /> {f.name}
                </button>
              ))}
              <button onClick={() => { setCtxMenu(null); createFolder() }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left" style={{ color: 'var(--accent-light)', borderTop: '1px solid var(--border)' }}>
                <FolderPlus size={12} /> New folder…
              </button>
            </div>
          )}
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          {/* Renders this project's audio on the server and keeps it on this
              device. Deliberately does NOT close the menu — it reports its own
              progress in place, and a job you started should say how it went. */}
          <SaveOfflineItem projectId={ctxMenu.id} style={{ padding: '8px 14px', fontSize: 14, gap: 10 }} />
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <button onClick={() => { const id = ctxMenu.id; setCtxMenu(null); requestDeleteCloud(id) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: '#ef4444' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {/* Folder right-click menu — rename / delete */}
      {folderCtx && (
        <div
          className="fixed z-50 min-w-[150px] rounded-lg border py-1 shadow-xl"
          style={{ left: folderCtx.x, top: folderCtx.y, background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button onClick={() => { const f = folders.find(x => x.id === folderCtx.id); setFolderCtx(null); if (f) setEditFolder(f) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: 'var(--text-primary)' }}>
            <Pencil size={14} /> Edit…
          </button>
          <button onClick={() => { const id = folderCtx.id; setFolderCtx(null); createFolder(id) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: 'var(--text-primary)' }}>
            <FolderPlus size={14} /> New subfolder…
          </button>
          <button onClick={() => { const { id, name } = folderCtx; setFolderCtx(null); requestDeleteFolder(id, name) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: '#ef4444' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {editFolder && (
        <FolderEditModal
          folder={editFolder}
          onClose={() => setEditFolder(null)}
          onSaved={(u) => { setFolders(prev => prev.map(f => f.id === u.id ? { ...f, ...u } : f)); setEditFolder(null) }}
          onDelete={() => { const f = editFolder; setEditFolder(null); requestDeleteFolder(f.id, f.name) }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title={
          confirmDel?.kind === 'local'  ? 'Delete this file?'
          : confirmDel?.kind === 'folder' ? 'Delete this folder?'
          : confirmDel?.kind === 'bulk'   ? `Move ${confirmDel.ids.length} project${confirmDel.ids.length > 1 ? 's' : ''} to trash?`
          : 'Move to trash?'
        }
        message={
          confirmDel?.kind === 'local'
            ? `“${confirmDel.name}” will be permanently deleted from your computer.`
          : confirmDel?.kind === 'folder'
            ? `“${confirmDel.name}” will be removed. The projects inside it aren’t deleted — they just become unfiled.`
          : confirmDel?.kind === 'bulk'
            ? 'They can be restored from Trash for 1 month.'
          : confirmDel ? `“${confirmDel.name}” will be moved to trash and permanently deleted after 1 month.` : ''
        }
        confirmLabel={
          confirmDel?.kind === 'local'  ? 'Delete file'
          : confirmDel?.kind === 'folder' ? 'Delete folder'
          : 'Move to trash'
        }
        onConfirm={performDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}

function SourceBadge({ source }: { source: 'cloud' | 'local' }) {
  const cloud = source === 'cloud'
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
      title={cloud ? 'Synced to your account' : 'Saved on this computer'}
    >
      {cloud ? <Cloud size={10} /> : <HardDrive size={10} />}
      {cloud ? 'Cloud' : 'Local'}
    </span>
  )
}

// ── Folder visuals (banner + logo) ─────────────────────────────────────────

// The little thumbnail on a folder row. Falls back to the default icon; with a custom banner/logo it
// shows the banner behind the logo, separated by a bottom opacity gradient.
function FolderThumb({ folder }: { folder: FolderRec }) {
  const { banner, logo } = folder
  if (!banner && !logo) {
    return (
      <div className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--border)' }}>
        <Folder size={18} color="var(--accent-light)" />
      </div>
    )
  }
  return (
    <div className="w-14 h-9 rounded-lg shrink-0 relative overflow-hidden" style={{ background: 'var(--border)' }}>
      {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {banner && logo && <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 75%)' }} />}
      <div className="absolute inset-0 flex items-center justify-center">
        {logo
          ? <img src={logo} alt="" className="max-w-[72%] max-h-[72%] object-contain" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} />
          : <Folder size={16} color="#fff" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />}
      </div>
    </div>
  )
}

// The channel-style banner shown at the top of an opened folder: banner image fading through an opacity
// gradient into the card, with the logo overlapping the bottom-left.
function FolderHeader({ folder, onEdit }: { folder: FolderRec; onEdit: () => void }) {
  const { banner, logo, name } = folder
  return (
    <div className="relative mb-4 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <div className="relative h-28 sm:h-36">
        {banner
          ? <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-subtle))' }} />}
        {/* opacity gradient: the banner dissolves into the card so the logo + title read cleanly */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 25%, rgba(0,0,0,0.35) 65%, var(--bg-card) 100%)' }} />
        <button onClick={onEdit} className="absolute top-3 right-3 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(4px)' }}>
          <Pencil size={12} /> Edit
        </button>
      </div>
      <div className="flex items-end gap-3 px-4 pb-3 -mt-9 relative">
        <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center border-2" style={{ background: 'var(--bg-base)', borderColor: 'var(--bg-card)' }}>
          {logo ? <img src={logo} alt="" className="w-full h-full object-contain" /> : <Folder size={26} color="var(--accent-light)" />}
        </div>
        <div className="min-w-0 pb-1">
          <div className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>{name}</div>
        </div>
      </div>
    </div>
  )
}

// Edit a folder: name + banner + logo. Reuses the same in-app modal treatment as ConfirmDialog so it
// ports to desktop/mobile. The preview mirrors exactly how the header renders (banner→gradient→logo).
function FolderEditModal({ folder, onClose, onSaved, onDelete }: {
  folder: FolderRec
  onClose: () => void
  onSaved: (updated: FolderRec) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(folder.name)
  const [banner, setBanner] = useState<string | null>(folder.banner)
  const [logo, setLogo] = useState<string | null>(folder.logo)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function pick(kind: 'banner' | 'logo', file?: File | null) {
    if (!file) return
    setErr(null)
    try {
      if (kind === 'banner') setBanner(await fileToDataUrl(file, 1280, 480, 'image/jpeg', 0.82))
      else setLogo(await fileToDataUrl(file, 320, 320, 'image/png'))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read that image.') }
  }

  async function save() {
    setBusy(true); setErr(null)
    const cleanName = name.trim().slice(0, 60) || folder.name
    const r = await fetch('/api/folders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: folder.id, name: cleanName, banner: banner ?? '', logo: logo ?? '' }),
    }).catch(() => null)
    setBusy(false)
    if (!r || !r.ok) { const d = r ? await r.json().catch(() => ({})) : {}; setErr((d as { error?: string }).error || 'Could not save. The image may be too large.'); return }
    onSaved({ ...folder, name: cleanName, banner, logo })
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.5)' }}>
      <div onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full" style={{ maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Edit folder</h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
        </div>

        {/* Live preview — identical banner→gradient→logo composition as the folder header */}
        <div className="mx-5 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          <div className="relative h-28">
            {banner
              ? <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
              : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-subtle))' }} />}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 25%, rgba(0,0,0,0.35) 65%, var(--bg-card) 100%)' }} />
          </div>
          <div className="flex items-end gap-3 px-3 pb-2 -mt-8 relative">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center border-2" style={{ background: 'var(--bg-base)', borderColor: 'var(--bg-card)' }}>
              {logo ? <img src={logo} alt="" className="w-full h-full object-contain" /> : <Folder size={22} color="var(--accent-light)" />}
            </div>
            <div className="text-sm font-bold truncate pb-1" style={{ color: 'var(--text-primary)' }}>{name || 'Folder name'}</div>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Name</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60} className="text-sm rounded-lg px-3 py-2 outline-none" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </label>

          <div className="flex gap-3">
            {/* Banner */}
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Banner</span>
              <input ref={bannerInput} type="file" accept="image/*" className="hidden" onChange={e => pick('banner', e.target.files?.[0])} />
              <div className="flex gap-2">
                <button onClick={() => bannerInput.current?.click()} className="flex-1 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{banner ? 'Replace' : 'Upload'}</button>
                {banner && <button onClick={() => setBanner(null)} className="text-xs px-2.5 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: '#ef4444' }}>Remove</button>}
              </div>
            </div>
            {/* Logo */}
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Logo</span>
              <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={e => pick('logo', e.target.files?.[0])} />
              <div className="flex gap-2">
                <button onClick={() => logoInput.current?.click()} className="flex-1 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{logo ? 'Replace' : 'Upload'}</button>
                {logo && <button onClick={() => setLogo(null)} className="text-xs px-2.5 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: '#ef4444' }}>Remove</button>}
              </div>
            </div>
          </div>

          {err && <p className="text-xs" style={{ color: '#ef4444' }}>{err}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <button onClick={onDelete} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: '#ef4444', background: 'transparent' }}>Delete folder</button>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Cancel</button>
            <button onClick={save} disabled={busy} className="text-sm font-bold px-4 py-2 rounded-lg" style={{ border: 'none', color: '#fff', background: 'var(--accent)', opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ isSignedIn, hasFolder, onConnect }: { isSignedIn: boolean; hasFolder: boolean; onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 rounded-xl border gap-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--border)' }}>
        {hasFolder ? <FileX size={20} color="var(--text-muted)" /> : <Clock size={20} color="var(--text-muted)" />}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No projects yet</p>
        <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Start a new project — {isSignedIn ? 'it saves to the cloud, or to a local folder on your computer.' : 'save it to a folder on your computer, or sign in to sync to the cloud.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/create" className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
          <PlusCircle size={14} /> New project
        </Link>
        {!hasFolder && (
          <button onClick={onConnect} className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Folder size={14} /> Connect a folder
          </button>
        )}
      </div>
      {!isSignedIn && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Or <Link href="/sign-in" style={{ color: 'var(--accent-light)' }}>sign in</Link> to sync across devices.
        </p>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { isSignedIn, isLoaded } = useUser()
  const [reloadKey, setReloadKey] = useState(0)
  // Shared with the module dashboards (Beacon, Prism) so the two cannot drift.
  const { importing, importMsg, openFromFile: handleOpenFromFile } =
    useProjectImport(() => setReloadKey(k => k + 1))

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-4xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>All Projects</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {isSignedIn ? 'Everything in your cloud and connected local folders' : 'Your local projects'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFromFile}
              disabled={importing}
              title={isSignedIn ? 'Open one file to edit, or select several to import them all' : 'Open a project file'}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', opacity: importing ? 0.6 : 1 }}
            >
              <FolderOpen size={15} />
              {importing ? 'Importing…' : isSignedIn ? 'Open / Import Files' : 'Open from File'}
            </button>
            <Link
              href="/create"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <PlusCircle size={15} />
              New project
            </Link>
          </div>
        </div>

        {importMsg && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm" style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {importMsg}
          </div>
        )}

        {!isLoaded ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          </div>
        ) : (
          <UnifiedProjects isSignedIn={!!isSignedIn} reloadKey={reloadKey} />
        )}
      </div>
    </main>
  )
}
