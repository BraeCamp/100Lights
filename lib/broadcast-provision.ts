// Fleet PROVISIONER — the piece that turns "I run a box" into "the platform runs the fleet". The
// control plane knows how many channels should be live; this ensures enough worker machines EXIST to
// run them, creating/destroying them via a cloud provider's API so you pay only while streaming.
//
// Provider-abstracted on purpose (Brae wants no lock-in): a driver just has to ensure N workers exist.
//   • 'manual'  — default. Does nothing; you run agents yourself (a Mac, a free VM). Safe no-op.
//   • 'fly'     — Fly.io Machines: create/destroy micro-VMs by API, per-second billing, boots in
//                 seconds — the ideal elastic primitive for this control plane. Needs FLY_API_TOKEN,
//                 FLY_APP_NAME, and the streamer image pushed to that app.
// Add Hetzner/DO/etc. later by writing another driver with the same shape.
import { listRuntime, listAgents } from '@/lib/broadcast-control'

// How many live channels one worker box can carry. The browserless renderer is light, so a real box
// runs several; the browser renderer ~1. Tune per your worker sizing.
const STREAMS_PER_WORKER = Math.max(1, parseInt(process.env.BROADCAST_STREAMS_PER_WORKER || '1', 10))

export interface FleetResult { driver: string; want: number; running: number; created: number; destroyed: number; note?: string }

export interface ProvisionDriver {
  name: string
  /** Make the fleet exactly `want` workers. Returns what it did. */
  scale(want: number): Promise<{ running: number; created: number; destroyed: number; note?: string }>
}

// ── manual (default) ──────────────────────────────────────────────────────────
const manualDriver: ProvisionDriver = {
  name: 'manual',
  async scale() {
    const agents = await listAgents()
    return { running: agents.filter(a => !a.stale).length, created: 0, destroyed: 0, note: 'manual mode — run agents yourself' }
  },
}

// ── Fly.io Machines ───────────────────────────────────────────────────────────
// REST: https://api.machines.dev/v1/apps/<app>/machines  (Bearer FLY_API_TOKEN)
function flyDriver(): ProvisionDriver {
  const token = process.env.FLY_API_TOKEN!
  const app = process.env.FLY_APP_NAME!
  const region = process.env.FLY_REGION || 'iad'
  const image = process.env.FLY_STREAMER_IMAGE || `registry.fly.io/${app}:latest`
  const api = 'https://api.machines.dev/v1'
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  // Only touch machines WE manage (tagged via metadata) so we never disturb others in the app.
  const TAG = 'lb-broadcast-worker'

  const list = async () => {
    const r = await fetch(`${api}/apps/${app}/machines`, { headers: h })
    if (!r.ok) throw new Error(`fly list ${r.status}`)
    const all = await r.json() as { id: string; state: string; config?: { metadata?: Record<string, string> } }[]
    return all.filter(m => m.config?.metadata?.role === TAG)
  }
  const create = async () => {
    const body = {
      region,
      config: {
        image,
        auto_destroy: true,
        restart: { policy: 'always' },
        guest: { cpu_kind: 'shared', cpus: parseInt(process.env.FLY_CPUS || '1', 10), memory_mb: parseInt(process.env.FLY_MEMORY_MB || '1024', 10) },
        metadata: { role: TAG },
        env: {
          AGENT: '1',
          RENDERER: process.env.BROADCAST_RENDERER || 'ffmpeg',   // browserless by default — light + cheap
          CONTROL_URL: process.env.BROADCAST_CONTROL_URL || 'https://100lights.com',
          AGENT_TOKEN: process.env.BROADCAST_AGENT_TOKEN || '',
          CAPACITY: String(STREAMS_PER_WORKER),
          KEYS: process.env.BROADCAST_STREAM_KEYS || '{}',   // {"slug":"key",…} for channels this fleet may run
        },
      },
    }
    const r = await fetch(`${api}/apps/${app}/machines`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`fly create ${r.status}: ${await r.text().catch(() => '')}`)
  }
  const destroy = async (id: string) => {
    await fetch(`${api}/apps/${app}/machines/${id}?force=true`, { method: 'DELETE', headers: h }).catch(() => {})
  }

  return {
    name: 'fly',
    async scale(want) {
      const machines = await list()
      let created = 0, destroyed = 0
      for (let i = machines.length; i < want; i++) { await create(); created++ }
      for (let i = want; i < machines.length; i++) { await destroy(machines[i].id); destroyed++ }
      return { running: Math.max(want, machines.length), created, destroyed }
    },
  }
}

export function getDriver(): ProvisionDriver {
  if (process.env.FLY_API_TOKEN && process.env.FLY_APP_NAME) return flyDriver()
  return manualDriver
}

/** Ensure the fleet matches demand: enough workers for the currently desired-live channels. Safe to
 *  call on a cron (e.g. every minute) and whenever a channel is started/stopped. Never scales below
 *  what's needed to keep running channels up. */
export async function reconcileFleet(): Promise<FleetResult> {
  const runtime = await listRuntime()
  const wantChannels = runtime.filter(r => r.desiredLive && r.enabled).length
  const want = Math.ceil(wantChannels / STREAMS_PER_WORKER)
  const driver = getDriver()
  const res = await driver.scale(want)
  return { driver: driver.name, want, ...res }
}
