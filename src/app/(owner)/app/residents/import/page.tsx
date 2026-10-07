import { redirect } from 'next/navigation'

/** The resident import now lives in the general import wizard. */
export default function ImportResidentsPage() {
  redirect('/app/import?kind=residents')
}
