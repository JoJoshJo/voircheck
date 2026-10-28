import type { MetadataRoute } from 'next';

// Demo stores must never be indexed (spec 5.8).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
