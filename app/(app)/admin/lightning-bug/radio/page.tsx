import { redirect } from 'next/navigation'

// The radio/station editor is now a tab in the consolidated admin.
export default function RadioRedirect() {
  redirect('/admin/lightning-bug?tab=radio')
}
