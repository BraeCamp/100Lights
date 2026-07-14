import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://100lights.com'
  return [
    { url: base,                   lastModified: new Date(), changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/#audio-editor`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/#video-editor`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/#pricing`,     lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/community`,    lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${base}/sign-up`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/sign-in`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/legal/terms`,  lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/legal/privacy`,lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
  ]
}
