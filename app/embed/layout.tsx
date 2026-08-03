// Minimal, chrome-free wrapper for embeddable players — this renders inside an
// <iframe> on other sites, so no app nav/header, just the widget.
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 10, background: 'transparent',
    }}>
      {children}
    </div>
  )
}
