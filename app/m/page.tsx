import MobileDawClient from '@/components/mobile/MobileDawClient'

export default function MobilePage() {
  return (
    <>
      {/* The studio itself is client-only; this is the page's main heading for
          assistive tech and crawlers, which see the page before it hydrates. */}
      <h1 className="sr-only">Make a beat on your phone</h1>
      <MobileDawClient />
    </>
  )
}
