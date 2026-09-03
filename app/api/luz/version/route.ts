export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({
    product: url.searchParams.get('product') ?? 'luz',
    latest: process.env.LUZ_LATEST_VERSION ?? '1.0.0',
    // The plug-in shows this to a user checking for updates, so it has to be a
    // page that exists. It defaulted to 100lights.app, a domain with no
    // nameservers — the same dead host that was baked into the binary.
    url: process.env.LUZ_DOWNLOAD_URL ?? 'https://100lights.com/store/plugins',
    notes: process.env.LUZ_RELEASE_NOTES ?? '',
  });
}
