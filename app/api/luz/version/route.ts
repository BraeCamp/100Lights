export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({
    product: url.searchParams.get('product') ?? 'luz',
    latest: process.env.LUZ_LATEST_VERSION ?? '1.0.0',
    url: process.env.LUZ_DOWNLOAD_URL ?? 'https://100lights.app/luz',
    notes: process.env.LUZ_RELEASE_NOTES ?? '',
  });
}
