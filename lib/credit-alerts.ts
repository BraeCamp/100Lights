// ── Telling someone before the money runs out, not after ────────────────────
//
// Brae: "users will only get credits by buying them or enabling credits through
// a credit card with price limits and a notification when they hit 50%, 75%,
// 90%, and 100% of their allowed balance used."
//
// The buying half needs Stripe. This half does not, and it is the half that
// protects people: an allowance that vanishes silently and then blocks a
// command mid-session is a bad surprise, and the first a user hears of it is
// usually a refusal in the middle of doing something.
//
// The rules that make a threshold useful rather than annoying:
//
//   ONCE PER CYCLE, PER LEVEL. Crossing 50% should be said once, not on every
//   call that keeps you above it. The highest level reached is remembered and
//   only a HIGHER one speaks again.
//
//   ON THE CROSSING, NOT THE STATE. Somebody who tops up and drops back to 40%
//   should hear 50% again next time they reach it, so the mark resets when the
//   allowance does.
//
//   AGAINST THE ALLOWANCE, NOT THE BALANCE. "90% used" means 90% of what you
//   were given this cycle. Without a monthly grant there is no denominator and
//   no percentage worth reporting — a one-off top-up is measured differently and
//   is deliberately left alone here.

/** The marks Brae specified. Ascending, and used in that order. */
export const CREDIT_ALERT_LEVELS = [50, 75, 90, 100] as const
export type CreditAlertLevel = (typeof CREDIT_ALERT_LEVELS)[number]

export interface CreditAlert {
  level: CreditAlertLevel
  /** Whole percent of the cycle's allowance consumed. */
  usedPct: number
  balance: number
  monthlyGrant: number
  /** What a person should be told, in their terms. */
  message: string
}

/**
 * Which threshold, if any, this spend just crossed.
 *
 * Pure: it takes the balance before and after and the marks already reported,
 * and returns at most one alert. Keeping the decision out of the database makes
 * it testable, and there is exactly one rule to get right — say the HIGHEST
 * newly-crossed level, not every level below it, or a single large spend
 * announces itself four times.
 */
export function creditAlertFor(opts: {
  balanceBefore: number
  balanceAfter: number
  monthlyGrant: number
  /** The highest level already reported this cycle, or 0. */
  alreadyReported: number
}): CreditAlert | null {
  const { balanceAfter, monthlyGrant, alreadyReported } = opts
  // No allowance means no denominator. A pay-as-you-go top-up is a different
  // thing and reporting "you have used 90% of it" would be misleading.
  if (!monthlyGrant || monthlyGrant <= 0) return null

  const used = Math.max(0, monthlyGrant - Math.max(0, balanceAfter))
  const usedPct = Math.min(100, Math.round((used / monthlyGrant) * 100))

  let crossed: CreditAlertLevel | null = null
  for (const level of CREDIT_ALERT_LEVELS) {
    if (usedPct >= level && level > alreadyReported) crossed = level
  }
  if (crossed == null) return null

  return {
    level: crossed,
    usedPct,
    balance: Math.max(0, balanceAfter),
    monthlyGrant,
    message: messageFor(crossed, Math.max(0, balanceAfter)),
  }
}

/**
 * Say what happened and what it means, without alarming anyone at 50%.
 *
 * The tone climbs with the number because the situations genuinely differ: half
 * an allowance in hand is information, none left is a thing you must act on to
 * carry on working.
 */
function messageFor(level: CreditAlertLevel, balance: number): string {
  switch (level) {
    case 50:
      return `You've used half your AI credits this cycle. ${balance.toLocaleString()} left.`
    case 75:
      return `Three quarters of your AI credits are gone — ${balance.toLocaleString()} left this cycle.`
    case 90:
      return `You're down to your last 10% of AI credits (${balance.toLocaleString()}). Top up to avoid interruptions.`
    case 100:
      return 'Your AI credits for this cycle are used up. Everything that does not need AI still works.'
  }
}

/**
 * Reset the mark when the allowance is renewed or topped up.
 *
 * Called when the balance goes UP: the marks describe a journey through one
 * cycle's allowance, and more credits start that journey again. Without this, a
 * user who topped up would never be warned a second time.
 */
export function shouldResetAlerts(balanceBefore: number, balanceAfter: number): boolean {
  return balanceAfter > balanceBefore
}
