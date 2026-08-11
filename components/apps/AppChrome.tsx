'use client'

// Shared chrome for the /apps mini-apps. Gives every app the same app-store-grade
// shell: an animated loading intro, a floating toolbar (Learn · History · Account ·
// Customize), a per-app saved-work history, a motion/appearance settings sheet, and
// smooth button/menu animations gated by the user's Motion preference. Wrap a page in
// <AppChrome slug="beatmaker">…</AppChrome>; apps can reach the shell via useAppShell().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Palette, X, RotateCcw, GraduationCap, History as HistoryIcon, User, Sparkles, Trash2, ArrowRight, Zap, ShieldCheck } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { WorkshopThemeProvider, useWorkshopTheme } from '@/components/editor/WorkshopThemeProvider'
import { BUILTIN_PRESETS, PATTERN_TYPES, resolveColor } from '@/lib/workshop-theme'
import { tourFor, type TourStep } from '@/lib/app-tour'
import { useAppHistory, relTime, type AppHistoryEntry } from '@/lib/app-history'
import { bySlug } from '@/lib/apps-registry'

type Motion = 'full' | 'subtle' | 'off'
type SheetId = 'history' | 'account' | 'customize' | null

interface AppShell {
  slug: string
  motion: Motion
  history: ReturnType<typeof useAppHistory>
  /** Register a handler the History sheet calls when the user reopens a saved entry. */
  registerRestore: (fn: (data: unknown) => void) => void
  /** Contribute app-specific controls into the Account & settings sheet (pass null to clear). */
  setSettings: (node: React.ReactNode | null) => void
  /** Start the guided tour. force=false only starts if unseen (call on first reaching the tool). */
  startTour: (force?: boolean) => void
  openSheet: (s: Exclude<SheetId, null>) => void
}

const Ctx = createContext<AppShell | null>(null)
/** Reach the shared shell from inside an app (save to history, open sheets, read motion). */
export function useAppShell(): AppShell {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppShell must be used within <AppChrome>')
  return c
}
/** Non-throwing variant for apps that only optionally use the shell. */
export const useAppShellOptional = () => useContext(Ctx)

export default function AppChrome({ slug = '', children }: { slug?: string; children: React.ReactNode }) {
  return (
    <WorkshopThemeProvider>
      <Shell slug={slug}>{children}</Shell>
    </WorkshopThemeProvider>
  )
}

function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [sheet, setSheet] = useState<SheetId>(null)
  const [motion, setMotionState] = useState<Motion>('full')
  const [intro, setIntro] = useState(true)
  const [tour, setTour] = useState(false)
  const [appSettings, setAppSettings] = useState<React.ReactNode | null>(null)
  const history = useAppHistory(slug)
  const restoreRef = useRef<((data: unknown) => void) | null>(null)
  const app = bySlug(slug)
  const tourSteps = tourFor(slug)

  // Resolve the Motion preference (default follows prefers-reduced-motion).
  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem('100lights-motion') as Motion | null } catch { return null } })()
    const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    setMotionState(stored ?? (prefersReduced ? 'off' : 'full'))
  }, [])
  const setMotion = useCallback((m: Motion) => { setMotionState(m); try { localStorage.setItem('100lights-motion', m) } catch { /* off */ } }, [])

  // The loading intro: shown once per session per app, fades out quickly.
  useEffect(() => {
    const seen = (() => { try { return sessionStorage.getItem(`100lights-intro-${slug}`) } catch { return null } })()
    if (seen) { setIntro(false); return }
    const dur = motion === 'off' ? 250 : 1100
    const t = setTimeout(() => { setIntro(false); try { sessionStorage.setItem(`100lights-intro-${slug}`, '1') } catch { /* off */ } }, dur)
    return () => clearTimeout(t)
  }, [slug, motion])

  // Start the tour. force=false only starts if it hasn't been seen yet — apps call that when the
  // user first reaches the tool screen (targets live in the tool, not the home). The Learn button
  // forces a replay.
  const startTour = useCallback((force = true) => {
    if (!tourFor(slug)) return
    if (!force) { try { if (localStorage.getItem(`100lights-tour-${slug}`)) return } catch { return } }
    setTour(true)
  }, [slug])
  const endTour = useCallback(() => {
    setTour(false)
    try { localStorage.setItem(`100lights-tour-${slug}`, '1') } catch { /* off */ }
  }, [slug])

  const registerRestore = useCallback((fn: (data: unknown) => void) => { restoreRef.current = fn }, [])
  const openSheet = useCallback((s: Exclude<SheetId, null>) => setSheet(s), [])
  const setSettings = useCallback((node: React.ReactNode | null) => setAppSettings(node), [])
  const ctx = useMemo<AppShell>(() => ({ slug, motion, history, registerRestore, setSettings, startTour, openSheet }), [slug, motion, history, registerRestore, setSettings, startTour, openSheet])

  return (
    <Ctx.Provider value={ctx}>
      <ShellStyles />
      <div data-editor="true" data-anim={motion}
        style={{ minHeight: '100dvh', background: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)' }}>
        {children}

        {/* Floating toolbar — one cluster, top-right, safe-area aware. */}
        <div className="app-toolbar" style={{ position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))', right: 12, zIndex: 25, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tourSteps && <ToolBtn label="Show me around" onClick={() => startTour(true)}><GraduationCap size={18} /></ToolBtn>}
          {slug && <ToolBtn label="History" onClick={() => setSheet('history')}><HistoryIcon size={18} /></ToolBtn>}
          <ToolBtn label="Account & settings" onClick={() => setSheet('account')}><User size={18} /></ToolBtn>
          <ToolBtn label="Customize appearance" onClick={() => setSheet('customize')}><Palette size={18} /></ToolBtn>
        </div>

        {intro && <IntroSplash title={app?.title ?? '100Lights'} tagline={app?.tagline} motion={motion} />}

        {tour && tourSteps && <Tour steps={tourSteps} onDone={endTour} />}
        {sheet === 'history' && <HistorySheet history={history} onOpen={(e) => { restoreRef.current?.(e.data); setSheet(null) }} onClose={() => setSheet(null)} />}
        {sheet === 'account' && <AccountSheet motion={motion} setMotion={setMotion} settings={appSettings} onCustomize={() => setSheet('customize')} onClose={() => setSheet(null)} />}
        {sheet === 'customize' && <CustomizeSheet onClose={() => setSheet(null)} />}
      </div>
    </Ctx.Provider>
  )
}

// A toolbar button with the shared press/hover animation.
function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="app-btn app-tool"
      style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 11, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.18)' }}>
      {children}
    </button>
  )
}

// ── Loading intro ──────────────────────────────────────────────────────────────
function IntroSplash({ title, tagline, motion }: { title: string; tagline?: string; motion: Motion }) {
  return (
    <div className="app-intro" data-off={motion === 'off' ? '1' : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
        <div className="app-intro-lights" aria-hidden="true" style={{ display: 'flex', gap: 9 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <i key={i} style={{ ['--i' as string]: i, width: 12, height: 12, borderRadius: 999, background: 'var(--accent)' }} />
          ))}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{title}</div>
          {tagline && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 260 }}>{tagline}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Interactive guided tour (coach marks) ────────────────────────────────────────
// Spotlights a real element on screen and coaches from a bar at the bottom. The hole
// over the highlighted element stays clickable so the user can actually try it; a
// floating Skip is always reachable. Auto-plays first open; the Learn button replays.
function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const lastRef = useRef<DOMRect | null>(null)
  const step = steps[Math.min(i, steps.length - 1)]

  useEffect(() => {
    let raf = 0
    const measure = () => {
      const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null
      if (!el) { if (lastRef.current) { lastRef.current = null; setRect(null) }; return }
      const r = el.getBoundingClientRect()
      const l = lastRef.current
      if (!l || l.top !== r.top || l.left !== r.left || l.width !== r.width || l.height !== r.height) { lastRef.current = r; setRect(r) }
    }
    if (step?.target) document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    measure()
    const loop = () => { measure(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [step])

  const next = () => { if (i + 1 < steps.length) setI(i + 1); else onDone() }
  const p = 8
  const dim = (s: React.CSSProperties): React.CSSProperties => ({ position: 'fixed', background: 'rgba(6,5,10,0.64)', pointerEvents: 'auto', ...s })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }}>
      {rect ? (
        <>
          <div style={dim({ left: 0, top: 0, width: '100%', height: Math.max(0, rect.top - p) })} />
          <div style={dim({ left: 0, top: rect.bottom + p, width: '100%', bottom: 0 })} />
          <div style={dim({ left: 0, top: Math.max(0, rect.top - p), width: Math.max(0, rect.left - p), height: rect.height + p * 2 })} />
          <div style={dim({ left: rect.right + p, top: Math.max(0, rect.top - p), right: 0, height: rect.height + p * 2 })} />
          <div style={{ position: 'fixed', left: rect.left - p, top: rect.top - p, width: rect.width + p * 2, height: rect.height + p * 2, borderRadius: 10, border: '2px solid var(--accent)', pointerEvents: 'none', animation: 'app-tour-glow 1.5s ease-in-out infinite' }} />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,5,10,0.64)', pointerEvents: 'auto' }} />
      )}

      <button type="button" onClick={onDone}
        style={{ position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))', left: 12, zIndex: 72, pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
        <X size={14} /> Skip tour
      </button>

      <div className="app-tour-coach" style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 72, pointerEvents: 'auto', maxWidth: 460, margin: '0 auto', padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        {step.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 3 }}>{step.title}</div>}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1} / {steps.length}</span>
          <button type="button" onClick={next} className="app-btn" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            {i + 1 < steps.length ? <>Next <ArrowRight size={15} /></> : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── History sheet ────────────────────────────────────────────────────────────────
function HistorySheet({ history, onOpen, onClose }: { history: ReturnType<typeof useAppHistory>; onOpen: (e: AppHistoryEntry) => void; onClose: () => void }) {
  const { entries, remove, clear } = history
  return (
    <Sheet onClose={onClose} title="History">
      {entries.length === 0 ? (
        <div style={{ padding: '26px 8px', textAlign: 'center' }}>
          <HistoryIcon size={26} style={{ color: 'var(--text-muted)', margin: '0 auto 10px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Nothing saved yet. Your saved work shows up here so you can pick it back up.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((e, i) => (
              <div key={e.id} className="app-step" style={{ ['--i' as string]: i, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                {e.thumb
                  ? <img src={e.thumb} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  : <span style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg-card)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--accent)' }}><Sparkles size={17} /></span>}
                <button type="button" onClick={() => onOpen(e)} className="app-btn" style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.subtitle, relTime(e.ts)].filter(Boolean).join(' · ')}</div>
                </button>
                <button type="button" onClick={() => remove(e.id)} aria-label="Delete" className="app-btn" style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={clear} className="app-btn" style={{ marginTop: 14, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Clear all</button>
        </>
      )}
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {history.synced
          ? 'Saved on this device and synced to your account — your history follows you across devices.'
          : <>Saved on this device. <Link href="/sign-in" style={{ color: 'var(--accent)', fontWeight: 700 }}>Sign in</Link> to sync it to your account across devices.</>}
      </p>
    </Sheet>
  )
}

// ── Account & settings sheet ─────────────────────────────────────────────────────
function AccountSheet({ motion, setMotion, settings, onCustomize, onClose }: { motion: Motion; setMotion: (m: Motion) => void; settings?: React.ReactNode; onCustomize: () => void; onClose: () => void }) {
  const { isSignedIn, user } = useUser()
  return (
    <Sheet onClose={onClose} title="Account & settings">
      {settings ? <Section label="This app">{settings}</Section> : null}
      <Section label="Account">
        {isSignedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 42, height: 42, borderRadius: 999, background: 'var(--accent)', color: '#0e0d12', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17, flexShrink: 0 }}>
              {(user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? 'U').toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}</div>
              <Link href="/dashboard" className="app-btn" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Dashboard <ArrowRight size={13} /></Link>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 9 }}>
            <Link href="/sign-in" className="app-btn" style={{ flex: 1, textAlign: 'center', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700 }}>Sign in</Link>
            <Link href="/sign-up" className="app-btn" style={{ flex: 1, textAlign: 'center', padding: '10px 14px', borderRadius: 10, background: 'var(--accent)', color: '#0e0d12', fontSize: 14, fontWeight: 800 }}>Create account</Link>
          </div>
        )}
      </Section>

      <Section label="Motion">
        <Segmented value={motion} onChange={setMotion} options={[
          { value: 'full', label: 'Full', icon: <Zap size={14} /> },
          { value: 'subtle', label: 'Subtle' },
          { value: 'off', label: 'Off' },
        ]} />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>How much the buttons and menus animate.</p>
      </Section>

      <Section label="Appearance">
        <button type="button" onClick={onCustomize} className="app-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          <Palette size={17} style={{ color: 'var(--accent)' }} /> Theme, colors & pattern <ArrowRight size={15} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
        </button>
      </Section>

      <Section label="Privacy & data">
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 10px' }}>
          <ShieldCheck size={13} style={{ display: 'inline', verticalAlign: '-2px', color: 'var(--accent)', marginRight: 4 }} />
          Your work stays on your device — captions, transcription, and audio are processed locally and only leave your device if you export or choose to sync.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/legal/privacy" className="app-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700 }}>Privacy policy <ArrowRight size={13} /></Link>
          <Link href="/settings" className="app-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700 }}>Your data &amp; deletion <ArrowRight size={13} /></Link>
        </div>
      </Section>
    </Sheet>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className="app-btn"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: active ? 'var(--accent)' : 'transparent', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>
            {o.icon}{o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Global animation styles (gated by data-anim on the shell root) ──────────────
function ShellStyles() {
  return (
    <style>{`
      @keyframes app-sheet-up { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes app-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes app-step-in { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes app-tool-in { from { transform: scale(.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes app-light { 0%,100% { opacity: .25; transform: scale(.8) } 50% { opacity: 1; transform: scale(1.15); box-shadow: 0 0 14px 2px var(--accent) } }
      @keyframes app-intro-out { to { opacity: 0; visibility: hidden } }
      @keyframes app-tour-glow { 0%,100% { box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 0 14px 2px var(--accent) } 50% { box-shadow: 0 0 0 4px rgba(255,255,255,.22), 0 0 26px 6px var(--accent) } }
      @keyframes app-coach-in { from { transform: translateY(16px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      [data-anim="full"] .app-tour-coach { animation: app-coach-in .3s cubic-bezier(.22,1,.36,1) both }

      [data-anim="full"] .app-btn, [data-anim="subtle"] .app-btn { transition: transform .12s ease, background .18s ease, box-shadow .18s ease, color .18s ease, border-color .18s ease }
      [data-anim="full"] .app-btn:hover, [data-anim="subtle"] .app-btn:hover { transform: translateY(-1px) }
      [data-anim="full"] .app-btn:active, [data-anim="subtle"] .app-btn:active { transform: scale(.94) }
      [data-anim="full"] .app-tool:hover { box-shadow: 0 3px 16px rgba(0,0,0,0.28); border-color: var(--accent) }

      [data-anim="full"] .app-sheet-panel { animation: app-sheet-up .30s cubic-bezier(.22,1,.36,1) both }
      [data-anim="subtle"] .app-sheet-panel { animation: app-fade .18s ease both }
      [data-anim="full"] .app-sheet-backdrop { animation: app-fade .22s ease both }

      [data-anim="full"] .app-step { animation: app-step-in .34s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i, 0) * 45ms) }
      [data-anim="full"] .app-toolbar .app-tool { animation: app-tool-in .32s cubic-bezier(.34,1.56,.64,1) both }
      [data-anim="full"] .app-toolbar .app-tool:nth-child(2) { animation-delay: .05s }
      [data-anim="full"] .app-toolbar .app-tool:nth-child(3) { animation-delay: .1s }
      [data-anim="full"] .app-toolbar .app-tool:nth-child(4) { animation-delay: .15s }

      .app-intro { animation: app-intro-out .45s ease .65s forwards }
      .app-intro[data-off] { animation: app-intro-out .2s ease .05s forwards }
      [data-anim="full"] .app-intro-lights i, [data-anim="subtle"] .app-intro-lights i { animation: app-light 1s ease-in-out infinite; animation-delay: calc(var(--i) * .12s) }

      @media (prefers-reduced-motion: reduce) {
        [data-anim] .app-btn, [data-anim] .app-sheet-panel, [data-anim] .app-step, [data-anim] .app-tool, .app-intro-lights i { animation: none !important; transition: none !important }
      }
    `}</style>
  )
}

// ── Existing exports (kept stable for apps that import them) ─────────────────────

// The mobile Customize sheet — same shared theme model + persistence as the studio.
export function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const { theme, update, setTheme, reset } = useWorkshopTheme()
  const accent = resolveColor(theme, 'accent')
  const bg = resolveColor(theme, 'bgBase')
  return (
    <Sheet onClose={onClose} title="Customize">
      <Section label="Presets">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {BUILTIN_PRESETS.map(p => {
            const a = resolveColor(p, 'accent'), b = resolveColor(p, 'bgBase')
            return (
              <button key={p.id} type="button" onClick={() => setTheme({ ...p, id: theme.id })} className="app-btn" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 11, border: '1px solid var(--border)', background: b, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ display: 'flex', gap: 4 }}>
                  <i style={{ width: 16, height: 16, borderRadius: 5, background: a }} />
                  <i style={{ width: 16, height: 16, borderRadius: 5, background: resolveColor(p, 'border') }} />
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: resolveColor(p, 'textPrimary') }}>{p.name}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section label="Colors">
        <div style={{ display: 'flex', gap: 18 }}>
          <ColorField label="Accent" value={accent} onChange={v => update({ colors: { ...theme.colors, accent: v } })} />
          <ColorField label="Background" value={bg} onChange={v => update({ colors: { ...theme.colors, bgBase: v } })} />
        </div>
      </Section>
      <Section label="Pattern">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {PATTERN_TYPES.map(pt => {
            const active = (theme.pattern?.type ?? 'none') === pt.type
            return (
              <button key={pt.type} type="button" onClick={() => update({ pattern: { ...theme.pattern, type: pt.type } })} className="app-btn" style={{ padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-base)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>
                {pt.label}
              </button>
            )
          })}
        </div>
      </Section>
      <button type="button" onClick={reset} className="app-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        <RotateCcw size={14} /> Reset to default
      </button>
    </Sheet>
  )
}

// Shared bottom-sheet chrome (also used by Firefly's export/sketches sheets).
export function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} onClick={onClose} className="app-sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} className="app-sheet-panel" style={{ width: '100%', maxHeight: '82dvh', overflowY: 'auto', background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--border)', borderBottom: 'none', padding: '10px 18px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--border)', margin: '4px auto 14px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="app-btn" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 10px' }}>{label}</p>
      {children}
    </section>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
      {label}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 56, height: 40, padding: 0, border: '1px solid var(--border)', borderRadius: 9, background: 'none', cursor: 'pointer' }} />
    </label>
  )
}
