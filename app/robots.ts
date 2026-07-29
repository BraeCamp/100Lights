import type { MetadataRoute } from 'next'

// ── AI / LLM opt-out ──────────────────────────────────────────────────────────
// 100Lights does NOT permit its pages to be used to train large language models
// or other AI systems, or to be scraped into AI datasets. The user-agents below
// are the known AI training / dataset crawlers; we disallow them from the whole
// site. robots.txt is honored voluntarily by well-behaved bots — see also the
// `noai` / `tdm-reservation` meta tags in app/layout.tsx, which cover every page.
const AI_CRAWLERS = [
  'GPTBot', 'Google-Extended', 'Applebot-Extended', 'ClaudeBot', 'anthropic-ai',
  'CCBot', 'Bytespider', 'PerplexityBot', 'Amazonbot', 'meta-externalagent',
  'FacebookBot', 'cohere-ai', 'Diffbot', 'Omgilibot', 'AI2Bot', 'ImagesiftBot',
  'Timpibot', 'YouBot', 'PanguBot', 'Kangaroo Bot', 'DuckAssistBot', 'Webzio-Extended',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/sign-in', '/sign-up', '/legal/'],
        disallow: ['/dashboard', '/projects/', '/settings', '/admin', '/trash', '/new', '/api/', '/share/', '/assistant', '/inspector'],
      },
      // No LLM learning: block the AI training/dataset crawlers from everything.
      { userAgent: AI_CRAWLERS, disallow: ['/'] },
    ],
    sitemap: 'https://100lights.com/sitemap.xml',
  }
}
