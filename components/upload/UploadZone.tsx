'use client'

import { useState, useRef } from 'react'
import { Upload, Film, Mic } from 'lucide-react'
import type { ContentType } from '@/lib/types'

const contentTypes: { type: ContentType; label: string; icon: React.ElementType; description: string }[] = [
  { type: 'video', label: 'Video', icon: Film, description: 'MP4, MOV, MKV — interviews, lectures, recordings' },
  { type: 'audio', label: 'Audio', icon: Mic, description: 'MP3, WAV, M4A — podcasts, voice memos, calls' },
]

interface Props {
  onSubmit: (file: File, contentType: ContentType) => void
}

export default function UploadZone({ onSubmit }: Props) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [selectedType, setSelectedType] = useState<ContentType>('video')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (picked) setFile(picked)
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
          Content type
        </p>
        <div className="grid grid-cols-2 gap-3">
          {contentTypes.map(({ type, label, icon: Icon, description }) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className="flex items-start gap-3 p-4 rounded-xl border text-left transition-all"
              style={{
                background: selectedType === type ? 'var(--accent-subtle)' : 'var(--bg-card)',
                borderColor: selectedType === type ? 'var(--accent-light)' : 'var(--border)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: selectedType === type ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <Icon size={16} color={selectedType === type ? '#fff' : 'var(--text-secondary)'} />
              </div>
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
          Upload file
        </p>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center"
          style={{
            borderColor: dragging ? 'var(--accent-light)' : file ? 'var(--accent)' : 'var(--border-light)',
            background: dragging ? 'var(--accent-subtle)' : 'var(--bg-card)',
          }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: file ? 'var(--accent-subtle)' : 'var(--border)' }}
          >
            <Upload size={20} color={file ? 'var(--accent-light)' : 'var(--text-muted)'} />
          </div>
          {file ? (
            <>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · Click to change
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Drop your file here, or click to browse
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                MP4, MOV, MKV, MP3, WAV up to 4GB
              </p>
            </>
          )}
          <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={handleFile} />
        </div>
      </div>

      <button
        onClick={() => file && onSubmit(file, selectedType)}
        disabled={!file}
        className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
        style={{
          background: file ? 'var(--accent)' : 'var(--border)',
          color: file ? '#fff' : 'var(--text-muted)',
          cursor: file ? 'pointer' : 'not-allowed',
        }}
      >
        Import & Process
      </button>
    </div>
  )
}
