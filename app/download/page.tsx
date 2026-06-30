import Link from 'next/link'
import { headers } from 'next/headers'

const GITHUB_RELEASES = 'https://github.com/BraeCamp/100Lights/releases/latest'

async function getLatestRelease(): Promise<{ version: string; macDmg: string; macArm: string; winExe: string } | null> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/BraeCamp/100Lights/releases/latest',
      { next: { revalidate: 3600 }, headers: { 'User-Agent': '100Lights-Site' } }
    )
    if (!res.ok) return null
    const data = await res.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
    const version = data.tag_name.replace(/^v/, '')
    const find = (substr: string) =>
      data.assets.find(a => a.name.includes(substr))?.browser_download_url ?? ''
    return {
      version,
      macDmg: find('.dmg'),
      macArm: find('arm64') || find('.dmg'),
      winExe: find('.exe') || find('Setup'),
    }
  } catch {
    return null
  }
}

function detectPlatform(ua: string): 'mac' | 'win' | 'other' {
  if (/Mac|iPhone|iPad/.test(ua)) return 'mac'
  if (/Win/.test(ua)) return 'win'
  return 'other'
}

export default async function DownloadPage() {
  const headersList = await headers()
  const ua = headersList.get('user-agent') ?? ''
  const platform = detectPlatform(ua)
  const release = await getLatestRelease()

  const version = release?.version ?? '1.0'

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d0d14',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#fff',
      padding: '40px 24px',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 48, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24,
        }}>⚡</div>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>100Lights</span>
      </div>

      {/* Headline */}
      <h1 style={{
        fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em', textAlign: 'center',
        lineHeight: 1.1, marginBottom: 16, maxWidth: 600,
      }}>
        Professional creative tools.<br />
        <span style={{ color: '#6366f1' }}>On your desktop.</span>
      </h1>

      <p style={{
        fontSize: 17, color: '#8b8b9e', textAlign: 'center',
        maxWidth: 480, lineHeight: 1.6, marginBottom: 48,
      }}>
        Audio production, video editing, and graphics — all in one launcher.
        Download once. Buy only what you need.
      </p>

      {/* Primary download CTAs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 }}>
        {/* Mac */}
        <a
          href={release?.macDmg || GITHUB_RELEASES}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 28px', borderRadius: 12,
            background: platform === 'mac' ? '#6366f1' : '#1e1e2e',
            border: platform === 'mac' ? 'none' : '1px solid #2a2a3e',
            color: '#fff', textDecoration: 'none',
            fontSize: 15, fontWeight: 600,
            boxShadow: platform === 'mac' ? '0 4px 24px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <span style={{ fontSize: 20 }}></span>
          <div>
            <div style={{ fontSize: 13, opacity: 0.7, fontWeight: 400, marginBottom: 1 }}>Download for</div>
            <div>macOS {platform === 'mac' && '(Intel)'}</div>
          </div>
        </a>

        {release?.macArm && release.macArm !== release.macDmg && (
          <a
            href={release.macArm}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 28px', borderRadius: 12,
              background: platform === 'mac' ? '#1e1e2e' : '#1e1e2e',
              border: '1px solid #2a2a3e',
              color: '#fff', textDecoration: 'none',
              fontSize: 15, fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 20 }}></span>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7, fontWeight: 400, marginBottom: 1 }}>Download for</div>
              <div>macOS (Apple Silicon)</div>
            </div>
          </a>
        )}

        {/* Windows */}
        <a
          href={release?.winExe || GITHUB_RELEASES}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 28px', borderRadius: 12,
            background: platform === 'win' ? '#6366f1' : '#1e1e2e',
            border: platform === 'win' ? 'none' : '1px solid #2a2a3e',
            color: '#fff', textDecoration: 'none',
            fontSize: 15, fontWeight: 600,
            boxShadow: platform === 'win' ? '0 4px 24px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <span style={{ fontSize: 20 }}>🪟</span>
          <div>
            <div style={{ fontSize: 13, opacity: 0.7, fontWeight: 400, marginBottom: 1 }}>Download for</div>
            <div>Windows</div>
          </div>
        </a>
      </div>

      <p style={{ fontSize: 12, color: '#4a4a5e', marginBottom: 64 }}>
        Version {version} · Free to install · Buy only the modules you need
      </p>

      {/* Module pricing grid */}
      <div style={{ width: '100%', maxWidth: 760, marginBottom: 64 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4a5e', textAlign: 'center', marginBottom: 24 }}>
          What's inside
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {MODULES.map(mod => (
            <div key={mod.key} style={{
              borderRadius: 12, overflow: 'hidden',
              border: '1px solid #1e1e2e', background: '#0f0f1a',
            }}>
              <div style={{ height: 4, background: mod.color }} />
              <div style={{ padding: '20px 20px 16px' }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{mod.emoji}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{mod.label}</div>
                <div style={{ fontSize: 12, color: '#5a5a6e', lineHeight: 1.5, marginBottom: 14 }}>{mod.desc}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: mod.free ? '#4ade80' : '#fff' }}>
                  {mod.free ? 'Free' : `$${mod.price}`}
                  {!mod.free && <span style={{ fontSize: 12, fontWeight: 400, color: '#5a5a6e' }}> one-time</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#4a4a5e', marginTop: 16 }}>
          Or get everything for <strong style={{ color: '#fff' }}>$129</strong> — all current and future modules included.
        </p>
      </div>

      {/* Use in browser */}
      <div style={{
        padding: '20px 32px', borderRadius: 12, border: '1px solid #1e1e2e',
        background: '#0f0f1a', textAlign: 'center', maxWidth: 400,
      }}>
        <p style={{ fontSize: 14, color: '#5a5a6e', marginBottom: 10 }}>
          Prefer to work in the browser?
        </p>
        <Link
          href="/dashboard"
          style={{ fontSize: 14, color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}
        >
          Open 100Lights on the web →
        </Link>
      </div>
    </div>
  )
}

const MODULES = [
  {
    key: 'audio',
    label: 'Audio',
    emoji: '🎵',
    color: '#3b82f6',
    desc: 'Full DAW — arrangement, session view, mixer, effects chain, sample library.',
    free: true,
    price: 0,
  },
  {
    key: 'audio_pro',
    label: 'Audio Pro',
    emoji: '🎙️',
    color: '#f97316',
    desc: 'Podcast mode with episode management, voice chain presets, and RSS distribution.',
    free: false,
    price: 49,
  },
  {
    key: 'video',
    label: 'Video',
    emoji: '🎬',
    color: '#8b5cf6',
    desc: 'Multi-track timeline, color grading, LUTs, transitions, and export.',
    free: false,
    price: 79,
  },
  {
    key: 'image',
    label: 'Image',
    emoji: '🖼️',
    color: '#ec4899',
    desc: 'Layer-based canvas editor. Design thumbnails, brand assets, and social graphics.',
    free: false,
    price: 39,
  },
]
