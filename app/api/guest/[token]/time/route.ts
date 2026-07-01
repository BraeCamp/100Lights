// Returns server time so the guest browser can calculate its clock offset (NTP-style).
// Called multiple times; client takes the median of (serverTime + rtt/2).
export async function GET() {
  return Response.json({ serverTime: Date.now() })
}
