import { redirect } from 'next/navigation'

// The Inspector became the Assistant — keep the old URL working.
export default function InspectorRedirect() {
  redirect('/assistant')
}
