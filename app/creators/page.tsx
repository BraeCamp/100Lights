import CreatorsApplyForm from './CreatorsApplyForm'

export const runtime = 'nodejs'

const TERMS = [
  { k: '30%', l: 'recurring commission' },
  { k: '12 mo', l: 'paid per referred user' },
  { k: '+30 days', l: 'free Pro for your fans' },
  { k: '25', l: 'founding seats' },
]

const WHY = [
  {
    h: 'Recurring income, not a one-off',
    p: 'Earn a share of every producer you refer, month after month — your back catalog keeps paying you as it keeps sending signups.',
  },
  {
    h: 'A real gift for your audience',
    p: 'Your link gives your followers a free month of Pro. You’re handing them something, not pushing a coupon — the kind of thing people actually click.',
  },
  {
    h: 'They can try it mid-video',
    p: 'A full studio that runs in the browser — no download, no plugins, works on a Chromebook or a phone. Your audience opens it while they’re watching you.',
  },
]

const STEPS = [
  { n: '1', h: 'Apply', p: 'Tell us where you create. We review founding-seat applications by hand.' },
  { n: '2', h: 'Get your kit', p: 'Approved creators get a referral link plus ready-to-post clips, thumbnails, and captions.' },
  { n: '3', h: 'Earn', p: 'Share it however you like. You earn on every fan who upgrades — tracked in your dashboard.' },
]

export default function CreatorsPage() {
  const c = {
    text: 'var(--text-primary, #f0effe)',
    text2: 'var(--text-secondary, #b8b3ca)',
    muted: 'var(--text-muted, #7d7d9c)',
    accent: 'var(--accent-light, #8b5cf6)',
    card: 'var(--bg-card, #181828)',
    surface: 'var(--bg-surface, #131320)',
    border: 'var(--border, #252540)',
  }
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '56px 22px 100px' }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 44 }}>
        <span style={{
          display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: c.accent, background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(139,92,246,0.32)',
          borderRadius: 999, padding: '5px 14px', marginBottom: 20,
        }}>Founding Affiliate Beta · Limited seats</span>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 52px)', lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 800, color: c.text, margin: '0 0 18px', textWrap: 'balance' }}>
          Get paid to put a studio in your audience&apos;s hands
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2.2vw, 19px)', color: c.text2, maxWidth: '58ch', margin: '0 auto', lineHeight: 1.6 }}>
          100Lights is a full music studio that runs in any browser. Refer the producers already in your audience and earn recurring commission — while they get free Pro to start.
        </p>
        <a href="#apply" style={{
          display: 'inline-block', marginTop: 26, padding: '13px 26px', borderRadius: 12, fontSize: 15, fontWeight: 700,
          background: 'var(--accent, #7c3aed)', color: '#fff', textDecoration: 'none',
        }}>Apply for a founding seat →</a>
      </div>

      {/* Terms */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 56 }}>
        {TERMS.map(t => (
          <div key={t.l} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(26px, 4vw, 34px)', fontWeight: 800, color: c.accent, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{t.k}</div>
            <div style={{ fontSize: 12.5, color: c.muted, marginTop: 10 }}>{t.l}</div>
          </div>
        ))}
      </div>

      {/* Why join */}
      <h2 style={{ fontSize: 'clamp(22px, 3.4vw, 28px)', fontWeight: 750, color: c.text, letterSpacing: '-0.015em', margin: '0 0 22px', textWrap: 'balance' }}>Why creators join</h2>
      <div style={{ display: 'grid', gap: 14, marginBottom: 56 }}>
        {WHY.map(w => (
          <div key={w.h} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 14, padding: '20px 22px' }}>
            <h3 style={{ fontSize: 16.5, fontWeight: 700, color: c.text, margin: '0 0 6px' }}>{w.h}</h3>
            <p style={{ fontSize: 14.5, color: c.text2, margin: 0, lineHeight: 1.6 }}>{w.p}</p>
          </div>
        ))}
      </div>

      {/* How it works */}
      <h2 style={{ fontSize: 'clamp(22px, 3.4vw, 28px)', fontWeight: 750, color: c.text, letterSpacing: '-0.015em', margin: '0 0 22px', textWrap: 'balance' }}>How it works</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 60 }}>
        {STEPS.map(s => (
          <div key={s.n} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 14, padding: '20px' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(124,58,237,0.16)', color: c.accent, fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>{s.n}</div>
            <h3 style={{ fontSize: 15.5, fontWeight: 700, color: c.text, margin: '0 0 5px' }}>{s.h}</h3>
            <p style={{ fontSize: 13.5, color: c.text2, margin: 0, lineHeight: 1.55 }}>{s.p}</p>
          </div>
        ))}
      </div>

      {/* Apply */}
      <div id="apply" style={{ scrollMarginTop: 70, background: c.card, border: `1px solid ${c.border}`, borderRadius: 18, padding: 'clamp(24px, 4vw, 40px)' }}>
        <h2 style={{ fontSize: 'clamp(22px, 3.4vw, 28px)', fontWeight: 750, color: c.text, letterSpacing: '-0.015em', margin: '0 0 8px' }}>Apply for a founding seat</h2>
        <p style={{ fontSize: 14.5, color: c.text2, margin: '0 0 26px', maxWidth: '58ch', lineHeight: 1.6 }}>
          Founding affiliates lock in 30% for life, even after the beta ends. Tell us a bit about you and we&apos;ll be in touch.
        </p>
        <CreatorsApplyForm />
      </div>

    </div>
  )
}
