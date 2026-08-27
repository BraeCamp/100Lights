import { ENGINE_VERSION } from '@/lib/apollo/engine-version'

/**
 * What build is running, for the studio's admin menu.
 *
 * The commit is injected at build time from Vercel's VERCEL_GIT_COMMIT_SHA
 * (see next.config.ts) and reads 'dev' locally. Without it there was no way to
 * answer "are you on the build I just deployed?" from inside the browser, and
 * that question came up repeatedly while chasing a playback fault — a report
 * made against a stale bundle looks exactly like a fix that did not work.
 */
export function buildInfo(): Record<string, unknown> {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown'
  const deploy = process.env.NEXT_PUBLIC_DEPLOY_ID ?? 'unknown'
  return {
    // The commit where there is one, the deployment otherwise. A CLI deploy may
    // carry no git metadata, and a build that cannot say which build it is
    // would defeat the reason this exists.
    commit: sha === 'dev' ? 'no git metadata' : sha.slice(0, 8),
    deployment: deploy === 'local' ? 'local dev' : deploy,
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? 'unknown',
    apolloEngine: ENGINE_VERSION,
    url: typeof location !== 'undefined' ? location.href : 'n/a',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
  }
}
