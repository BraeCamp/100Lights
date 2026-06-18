import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/sign-in', '/sign-up', '/legal/'],
        disallow: ['/dashboard', '/projects/', '/settings', '/admin', '/trash', '/new', '/api/'],
      },
    ],
    sitemap: 'https://100lights.com/sitemap.xml',
  }
}
