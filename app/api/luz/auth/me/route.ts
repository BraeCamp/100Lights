import { resolveUser, jsonError } from '@/lib/luz-cloud';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await resolveUser(request);
  if (!user) return jsonError('Sign in to your 100Lights account first.', 401);

  return Response.json({
    userId: user.userId,
    displayName: user.displayName,
    email: user.email,
    plan: user.plan,
  });
}
