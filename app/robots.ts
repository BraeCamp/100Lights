import type { MetadataRoute } from 'next'

// ── AI opt-out: SEARCH is allowed, TRAINING is not ────────────────────────────
// Policy: AI answer/search engines may crawl us for discoverability, but our
// pages must NOT be used to train large language models or be scraped into AI
// training datasets. So we block ONLY the known training / dataset crawlers
// below. robots.txt is honored voluntarily by well-behaved bots — see also the
// `noai` / `tdm-reservation` meta tags in app/layout.tsx (both anti-training).
//
// Intentionally LEFT ALLOWED (AI search / answers, keeps us citable):
//   OAI-SearchBot & ChatGPT-User (ChatGPT search/browse), PerplexityBot,
//   Amazonbot (Alexa), DuckAssistBot, YouBot, Applebot (Siri/Spotlight),
//   Googlebot/Bingbot (normal search). Google-Extended / Applebot-Extended below
//   are TRAINING-only opt-outs and do NOT affect Google or Apple search ranking.
const AI_TRAINING_CRAWLERS = [
  'GPTBot', 'Google-Extended', 'Applebot-Extended', 'ClaudeBot', 'anthropic-ai',
  'CCBot', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'Omgilibot',
  'AI2Bot', 'ImagesiftBot', 'Timpibot', 'PanguBot', 'Kangaroo Bot', 'Webzio-Extended',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/sign-in', '/sign-up', '/legal/'],
        disallow: ['/dashboard', '/projects/', '/settings', '/admin', '/trash', '/new', '/api/', '/share/', '/assistant', '/inspector'],
      },
      // No LLM training: block the AI training/dataset crawlers from everything.
      { userAgent: AI_TRAINING_CRAWLERS, disallow: ['/'] },
    ],
    sitemap: 'https://100lights.com/sitemap.xml',
  }
}
