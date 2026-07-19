'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Film, PlusCircle, Clock, FolderOpen, Trash2, AlertCircle, RefreshCw, Star, Folder, LogIn, FileX } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { openProjectsFromFile } from '@/lib/project-serializer'
import { saveFolder, loadFolder, clearFolder, verifyPermission } from '@/lib/local-folder'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { CfProjFile } from '@/lib/project-serializer'

const CF_EXT = '.cfproj'

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  starred: boolean
  clips: number
  media: number
  thumbnail: string | null
}

interface LocalFile {
  name: string
  handle: FileSystemFileHandle
  isProject: boolean
  modifiedAt: number | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMs(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Guest: local folder view ────────────────────────────────────────────────

function LocalProjectsView() {
  const [folder, setFolder]   = useState<FileSystemDirectoryHandle | null>(null)
  const [files, setFiles]     = useState<LocalFile[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    loadFolder()
      .then(async handle => {
        if (!handle) { setLoading(false); return }
        const ok = await verifyPermission(handle).catch(() => false)
        if (ok) { setFolder(handle); await readFiles(handle) }
        else { await clearFolder(); setLoading(false) }
      })
      .catch(() => setLoading(false))
  }, [])

  async function readFiles(handle: FileSystemDirectoryHandle) {
    setLoading(true)
    const list: LocalFile[] = []
    for await (const [name, entry] of (handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'file') continue
      const file = await (entry as FileSystemFileHandle).getFile().catch(() => null)
      list.push({
        name,
        handle: entry as FileSystemFileHandle,
        isProject: name.endsWith(CF_EXT),
        modifiedAt: file?.lastModified ?? null,
      })
    }
    list.sort((a, b) => {
      if (a.isProject !== b.isProject) return a.isProject ? -1 : 1
      return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)
    })
    setFiles(list)
    setLoading(false)
  }

  async function pickFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) {
      alert('Your browser doesn\'t support folder access. Try Chrome or Edge.')
      return
    }
    const handle = await picker({ mode: 'read' }).catch(() => null)
    if (!handle) return
    await saveFolder(handle)
    setFolder(handle)
    await readFiles(handle)
  }

  async function changeFolder() {
    await clearFolder()
    setFolder(null)
    setFiles([])
  }

  async function openProject(file: LocalFile) {
    setOpening(file.name)
    try {
      const raw  = await file.handle.getFile()
      const text = await raw.text()
      const proj = JSON.parse(text) as CfProjFile
      localStorage.setItem(`cf_pending_cfproj_${proj.id}`, text)
      window.location.href = `/projects/${proj.id}`
    } catch {
      alert('Could not open this file. It may be corrupted or not a valid 100Lights project.')
    } finally {
      setOpening(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    )
  }

  if (!folder) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-xl border gap-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--border)' }}>
          <Folder size={22} color="var(--text-muted)" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Choose your project folder</p>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            100Lights will read your <code>.cfproj</code> files from a folder on your computer. You can change this at any time.
          </p>
        </div>
        <button
          onClick={pickFolder}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <FolderOpen size={15} /> Choose folder
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Or{' '}
          <Link href="/sign-in" style={{ color: 'var(--accent-light)' }}>sign in</Link>
          {' '}to save projects to the cloud.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Folder size={13} />
          <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{folder.name}</span>
          <span>· {files.filter(f => f.isProject).length} project{files.filter(f => f.isProject).length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={changeFolder} className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Change folder
        </button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border gap-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <FileX size={20} color="var(--text-muted)" />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No files in this folder</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Save a project here and it will appear automatically.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {files.map(file => (
            <div
              key={file.name}
              onClick={() => file.isProject && openProject(file)}
              className="flex items-center gap-4 p-4 rounded-xl border transition-all"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border)',
                opacity: file.isProject ? 1 : 0.4,
                cursor: file.isProject ? 'pointer' : 'default',
              }}
            >
              <div className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--border)' }}>
                <Film size={16} color={file.isProject ? 'var(--accent-light)' : 'var(--text-muted)'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {file.name}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {file.isProject ? 'Project file' : 'Not a project file'}
                </div>
              </div>
              {file.modifiedAt && (
                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatMs(file.modifiedAt)}</span>
              )}
              {file.isProject && opening === file.name && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Opening…</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cloud view (signed-in users) ────────────────────────────────────────────

function CloudProjectsView({ reloadKey = 0 }: { reloadKey?: number }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [ctxMenu, setCtxMenu]   = useState<{ id: string; starred: boolean; x: number; y: number } | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null)

  function loadProjects() {
    setLoading(true)
    setError(false)
    fetch('/api/projects')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProjects() }, [reloadKey])

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

  function deleteProject(id: string) {
    const p = projects.find(x => x.id === id)
    setConfirmDel({ id, name: p?.name ?? 'this project' })
  }

  async function performDelete() {
    if (!confirmDel) return
    const id = confirmDel.id
    setConfirmDel(null)
    setProjects(prev => prev.filter(p => p.id !== id))
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => loadProjects())
  }

  function toggleStar(id: string) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
    fetch(`/api/projects/${id}`, { method: 'PATCH' }).catch(() => {
      setProjects(prev => prev.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading projects…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl border gap-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <AlertCircle size={20} color="var(--text-muted)" />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load projects</p>
        <button onClick={loadProjects} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--border)' }}>
          <Clock size={20} color="var(--text-muted)" />
        </div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No projects yet</p>
        <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>Upload a video or audio file to get started</p>
        <Link href="/new" className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
          <PlusCircle size={14} /> New project
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <div
          key={project.id}
          className="group flex items-center gap-4 p-4 rounded-xl border transition-all"
          style={{ background: 'var(--bg-card)', borderColor: project.starred ? 'rgba(139,92,246,0.4)' : 'var(--border)' }}
          onContextMenu={(e) => {
            e.preventDefault()
            setCtxMenu({ id: project.id, starred: project.starred, x: e.clientX, y: e.clientY })
          }}
        >
          <Link href={`/projects/${project.id}`} className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--border)' }}>
            {project.thumbnail
              ? <img src={project.thumbnail} className="w-full h-full object-cover" alt="" />
              : <Film size={16} color="var(--text-secondary)" />
            }
          </Link>
          <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{project.name}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {project.clips} clip{project.clips !== 1 ? 's' : ''} · {project.media} media file{project.media !== 1 ? 's' : ''}
            </div>
          </Link>
          <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(project.savedAt)}</span>
          <button
            onClick={() => toggleStar(project.id)}
            title={project.starred ? 'Unstar' : 'Star'}
            className="p-1.5 rounded-lg"
            style={{ color: project.starred ? '#f59e0b' : 'var(--text-muted)' }}
          >
            <Star size={14} fill={project.starred ? '#f59e0b' : 'none'} />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); deleteProject(project.id) }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            title="Delete project"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[168px] rounded-lg border py-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y, background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Link
            href={`/projects/${ctxMenu.id}`}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm no-underline"
            style={{ color: 'var(--text-primary)' }}
          >
            <FolderOpen size={14} /> Open
          </Link>
          <button
            onClick={() => { toggleStar(ctxMenu.id); setCtxMenu(null) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left"
            style={{ color: 'var(--text-primary)' }}
          >
            <Star size={14} fill={ctxMenu.starred ? '#f59e0b' : 'none'} color={ctxMenu.starred ? '#f59e0b' : 'currentColor'} />
            {ctxMenu.starred ? 'Unstar' : 'Star'}
          </button>
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <button
            onClick={() => { const id = ctxMenu.id; setCtxMenu(null); deleteProject(id) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left"
            style={{ color: '#ef4444' }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title="Move to trash?"
        message={confirmDel ? `“${confirmDel.name}” will be moved to trash and permanently deleted after 1 month.` : ''}
        confirmLabel="Move to trash"
        onConfirm={performDelete}
        onCancel={() => setConfirmDel(null)}
      />
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
    const files = await openProjectsFromFile()
    if (files.length === 0) return

    // A single file opens straight into the editor (edit-and-save flow).
    if (files.length === 1 && !isSignedIn) {
      const cfproj = files[0]
      localStorage.setItem(`cf_pending_cfproj_${cfproj.id}`, JSON.stringify(cfproj))
      window.location.href = `/projects/${cfproj.id}`
      return
    }
    if (!isSignedIn) { setImportMsg('Sign in to import project files to your account.'); return }

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
    setImportMsg(
      `Imported ${ok} project${ok !== 1 ? 's' : ''}` +
      (fail ? ` — ${fail} failed${limit ? ' (project limit reached)' : ''}` : '') + '.'
    )
    setReloadKey(k => k + 1)
    setTimeout(() => setImportMsg(null), 6000)
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-4xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>All Projects</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {isSignedIn ? 'Your cloud-synced projects' : 'Your local projects'}
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
        ) : isSignedIn ? (
          <CloudProjectsView reloadKey={reloadKey} />
        ) : (
          <LocalProjectsView />
        )}
      </div>
    </main>
  )
}
