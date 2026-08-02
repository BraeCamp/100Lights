import type { CSSProperties } from 'react'

// The 100Lights icon mark — the transparent circular spotlight badge. Sits next
// to the "100Lights" wordmark in headers. `object-fit: contain` keeps the circle
// round at any square `size` (the source isn't exactly square).
export function LogoMark({ size = 24, style, className }: { size?: number; style?: CSSProperties; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/FullLogo_Transparent.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flexShrink: 0, objectFit: 'contain', ...style }}
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
