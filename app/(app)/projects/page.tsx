'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Film, PlusCircle, Clock, FolderOpen, Trash2, AlertCircle, RefreshCw, Star, Folder, Cloud, HardDrive, FileX } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { openProjectsFromFile, readProjectFile } from '@/lib/project-serializer'
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
}

interface LocalFileHandle {
  name: string
  handle: FileSystemFileHandle
  modifiedAt: number | null
}

// One row in the unified list — either a cloud project or a local file.
type Row =
  | { source: 'cloud'; key: string; ts: number; name: string; id: string; starred: boolean; clips: number; media: number; thumbnail: string | null }
  | { source: 'local'; key: string; ts: number; name: string; file: LocalFileHandle }

function formatDate(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Unified list (cloud + local folder, in one place) ───────────────────────

function UnifiedProjects({ isSignedIn, reloadKey }: { isSignedIn: boolean; reloadKey: number }) {
  const [cloud, setCloud]       = useState<CloudSummary[]>([])
  const [cloudErr, setCloudErr] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(isSignedIn)

  const [folder, setFolder]     = useState<FileSystemDirectoryHandle | null>(null)
  const [local, setLocal]       = useState<LocalFileHandle[]>([])
  const [localLoading, setLocalLoading] = useState(true)

  const [opening, setOpening]   = useState<string | null>(null)
  const [ctxMenu, setCtxMenu]   = useState<{ id: string; starred: boolean; x: number; y: number } | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ kind: 'cloud'; id: string; name: string } | { kind: 'local'; name: string } | null>(null)

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
      window.location.href = `/projects/${project.id}`
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
    if (target.kind === 'cloud') {
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
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const loading = cloudLoading || localLoading

  // ── Merge + sort (starred cloud first, then newest across both) ──
  const rows: Row[] = [
    ...cloud.map((p): Row => ({ source: 'cloud', key: `c:${p.id}`, ts: Date.parse(p.savedAt) || 0, name: p.name, id: p.id, starred: p.starred, clips: p.clips, media: p.media, thumbnail: p.thumbnail })),
    ...local.map((f): Row => ({ source: 'local', key: `l:${f.name}`, ts: f.modifiedAt ?? 0, name: f.name.replace(/\.(cfproj|zip)$/i, ''), file: f })),
  ].sort((a, b) => {
    const aStar = a.source === 'cloud' && a.starred ? 1 : 0
    const bStar = b.source === 'cloud' && b.starred ? 1 : 0
    if (aStar !== bStar) return bStar - aStar
    return b.ts - a.ts
  })

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

      {rows.length === 0 ? (
        <EmptyState isSignedIn={isSignedIn} hasFolder={!!folder} onConnect={connectFolder} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(row => row.source === 'cloud' ? (
            <div
              key={row.key}
              className="group flex items-center gap-4 p-4 rounded-xl border transition-all"
              style={{ background: 'var(--bg-card)', borderColor: row.starred ? 'rgba(139,92,246,0.4)' : 'var(--border)' }}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: row.id, starred: row.starred, x: e.clientX, y: e.clientY }) }}
            >
              <Link href={`/projects/${row.id}`} className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--border)' }}>
                {row.thumbnail ? <img src={row.thumbnail} className="w-full h-full object-cover" alt="" /> : <Film size={16} color="var(--text-secondary)" />}
              </Link>
              <Link href={`/projects/${row.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.name}</span>
                  <SourceBadge source="cloud" />
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {row.clips} clip{row.clips !== 1 ? 's' : ''} · {row.media} media file{row.media !== 1 ? 's' : ''}
                </div>
              </Link>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(row.ts)}</span>
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
          <Link href={`/projects/${ctxMenu.id}`} className="flex items-center gap-2.5 px-3.5 py-2 text-sm no-underline" style={{ color: 'var(--text-primary)' }}>
            <FolderOpen size={14} /> Open
          </Link>
          <button onClick={() => { toggleStar(ctxMenu.id); setCtxMenu(null) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: 'var(--text-primary)' }}>
            <Star size={14} fill={ctxMenu.starred ? '#f59e0b' : 'none'} color={ctxMenu.starred ? '#f59e0b' : 'currentColor'} />
            {ctxMenu.starred ? 'Unstar' : 'Star'}
          </button>
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <button onClick={() => { const id = ctxMenu.id; setCtxMenu(null); requestDeleteCloud(id) }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left" style={{ color: '#ef4444' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title={confirmDel?.kind === 'local' ? 'Delete this file?' : 'Move to trash?'}
        message={
          confirmDel?.kind === 'local'
            ? `“${confirmDel.name}” will be permanently deleted from your computer.`
            : confirmDel ? `“${confirmDel.name}” will be moved to trash and permanently deleted after 1 month.` : ''
        }
        confirmLabel={confirmDel?.kind === 'local' ? 'Delete file' : 'Move to trash'}
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
        <Link href="/new" className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
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
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  async function handleOpenFromFile() {
    // Uploading a Firefly bundle's recordings can take a moment, so the
    // spinner goes up before the read, not after it.
    setImporting(true)
    let read
    try {
      read = await openProjectsFromFile()
    } finally {
      setImporting(false)
    }
    const { projects: files, degraded, errors } = read

    // Recordings that never reached storage play now and die on reload — say
    // so, rather than letting the user find out later.
    const notes = [
      ...errors,
      ...(degraded
        ? [`${degraded} recording${degraded !== 1 ? 's' : ''} couldn't be saved to your library — ${degraded !== 1 ? 'they' : 'it'} will play now but won't survive a reload.`]
        : []),
    ]
    const flash = (msg: string) => {
      setImportMsg([msg, ...notes].join(' '))
      setTimeout(() => setImportMsg(null), 8000)
    }

    if (files.length === 0) {
      if (notes.length) flash('Nothing imported.')
      return
    }

    // A single file opens straight into the editor (edit-and-save flow).
    if (files.length === 1 && !isSignedIn) {
      const cfproj = files[0]
      localStorage.setItem(`cf_pending_cfproj_${cfproj.id}`, JSON.stringify(cfproj))
      window.location.href = `/projects/${cfproj.id}`
      return
    }
    if (!isSignedIn) { flash('Sign in to import project files to your account.'); return }

    // Signed in: import all selected files straight into the projects list.
    setImporting(true)
    let ok = 0, fail = 0, limit = false
    for (const cf of files) {
      try {
        const r = await fetch('/api/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf),
        })
        if (r.ok) ok++
        else { fail++; if (r.status === 403) limit = true }
      } catch { fail++ }
    }
    setImporting(false)
    flash(
      `Imported ${ok} project${ok !== 1 ? 's' : ''}` +
      (fail ? ` — ${fail} failed${limit ? ' (project limit reached)' : ''}` : '') + '.'
    )
    setReloadKey(k => k + 1)
  }

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
              href="/new"
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
