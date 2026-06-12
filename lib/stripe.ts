import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
})

export const PLANS = {
  free: {
    transcriptionsPerMonth: 3,
    aiGenerationsPerMonth: 10,
    storageMb: 500,
  },
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    transcriptionsPerMonth: 30,
    aiGenerationsPerMonth: 100,
    storageMb: 20480, // 20GB
  },
}
