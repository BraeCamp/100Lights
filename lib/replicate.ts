const BASE = 'https://api.replicate.com/v1'

function headers() {
  return {
    'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Prefer': 'wait=60',  // ask Replicate to wait up to 60s before returning (reduces polling)
  }
}

export interface Prediction {
  id:     string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output: unknown
  error:  string | null
  urls:   { get: string }
}

// Submit a new prediction. version = full model version SHA.
export async function createPrediction(version: string, input: Record<string, unknown>): Promise<Prediction> {
  const res = await fetch(`${BASE}/predictions`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ version, input }),
  })
  if (!res.ok) throw new Error(`Replicate error ${res.status}: ${await res.text()}`)
  return res.json()
}

// Poll an existing prediction by ID.
export async function getPrediction(id: string): Promise<Prediction> {
  const res = await fetch(`${BASE}/predictions/${id}`, { headers: headers() })
  if (!res.ok) throw new Error(`Replicate poll error ${res.status}: ${await res.text()}`)
  return res.json()
}
