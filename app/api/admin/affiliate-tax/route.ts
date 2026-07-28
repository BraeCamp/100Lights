import { isAdmin } from '@/lib/admin-auth'
import { taxReport } from '@/lib/affiliates'

export const runtime = 'nodejs'

// GET /api/admin/affiliate-tax?year=YYYY[&format=csv]
// The 1099 picture for a calendar year: who to file for, who's covered by a
// processor, W-9 status, YTD paid. ?format=csv downloads the filing sheet.
export async function GET(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear()
  const rows = await taxReport(year)

  if (url.searchParams.get('format') === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Affiliate', 'Contact', 'Legal name', 'Business name', 'Address', 'Tax class', 'YTD paid', 'W-9 on file', 'Needs 1099-NEC', 'DE 542 (CA)', 'Payment methods']
    const lines = rows.map(r => [
      r.name, r.contact, r.legalName, r.businessName, r.address, r.taxClass,
      r.ytdPaid.toFixed(2), r.w9Received ? 'yes' : 'no', r.needs1099 ? 'yes' : 'no', r.de542Due ? 'yes' : 'no', r.methods,
    ].map(esc).join(','))
    const csv = [header.map(esc).join(','), ...lines].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="affiliate-1099-${year}.csv"`,
      },
    })
  }

  return Response.json({ year, rows })
}
