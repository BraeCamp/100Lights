'use client'

import { useEffect } from 'react'
import { markArticleRead } from './usePathProgress'

// Mounted on an article page; records that this browser has read the slug so
// learning-path progress (checkmarks, resume) reflects it. Renders nothing.
export default function MarkArticleRead({ slug }: { slug: string }) {
  useEffect(() => { markArticleRead(slug) }, [slug])
  return null
}
