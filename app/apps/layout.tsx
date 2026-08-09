// Plain passthrough for the public /apps/* mini-app section. These are
// chrome-free tools that render under only the root layout (no DAW nav), unlike
// app/(app)/apps/[module] which lives inside the authenticated DAW shell.
export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
