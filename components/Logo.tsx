import type { CSSProperties } from 'react'

// The 100Lights icon mark. Sits next to the "100Lights" wordmark in headers.
// The transparent (no-background) circular PNG, so the mark sits on any surface
// without a baked-in badge/buffer.
export function LogoMark({ size = 24, style, className }: { size?: number; style?: CSSProperties; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo1yellowNObuffer.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  )
}

// The full lockup: icon mark + "100Lights" wordmark.
export function Logo({ size = 26, gap = 8, textStyle }: { size?: number; gap?: number; textStyle?: CSSProperties }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', ...textStyle }}>100Lights</span>
    </span>
  )
}
