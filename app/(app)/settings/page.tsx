'use client'

import { Settings, Zap } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Account and application preferences
          </p>
        </div>

        <div
          className="flex items-center gap-4 p-5 rounded-xl border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-subtle)' }}>
            <Zap size={18} color="var(--accent-light)" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
              AI features are ready
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Transcription and AI writing are powered by 100Lights — no API keys needed.
            </p>
          </div>
        </div>

        <div
          className="flex items-start gap-4 p-5 rounded-xl border mt-4"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-surface)' }}>
            <Settings size={18} color="var(--text-muted)" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
              More settings coming soon
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Notification preferences, default export quality, and team management will appear here.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
