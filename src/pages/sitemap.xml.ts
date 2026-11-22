import type { APIRoute } from 'astro';
import { honoredPlayers } from '../utils/honoredData';

export const GET: APIRoute = () => {
  const lastmod = new Date().toISOString().split('T')[0];
  const pages = [
    { loc: 'https://ultrainstinctcrew.com/', priority: '1.00', changefreq: 'daily' },
    { loc: 'https://ultrainstinctcrew.com/ruhmeshalle/', priority: '0.85', changefreq: 'weekly' },
    ...honoredPlayers.map((p) => ({
      loc: `https://ultrainstinctcrew.com/ruhmeshalle/${p.slug}/`,
      priority: '0.75',
      changefreq: 'monthly'
    })),
    { loc: 'https://ultrainstinctcrew.com/brandkit/', priority: '0.75', changefreq: 'monthly' },
    { loc: 'https://ultrainstinctcrew.com/obs/', priority: '0.70', changefreq: 'weekly' },
    { loc: 'https://ultrainstinctcrew.com/impressum/', priority: '0.30', changefreq: 'yearly' },
    { loc: 'https://ultrainstinctcrew.com/datenschutzbestimmungen/', priority: '0.30', changefreq: 'yearly' }
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
};
