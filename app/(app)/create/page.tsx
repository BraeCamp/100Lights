import { Suspense } from 'react'
import { getFlags } from '@/lib/platform-flags'
import NewProjectClient from './NewProjectClient'

export default async function NewProjectPage() {
  const flags = await getFlags()
  return (
    <Suspense>
      <NewProjectClient flags={flags} />
    </Suspense>
  )
}
