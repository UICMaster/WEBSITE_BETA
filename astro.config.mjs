// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDev = process.argv.includes('dev');
const base = isDev ? '/' : (process.env.BASE_PATH || '/WEBSITE_BETA');
const site = base === '/' ? 'https://ultrainstinctcrew.com' : 'https://uicmaster.github.io';

function basePathPrefixer(basePath) {
  return {
    name: 'base-path-prefixer',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        if (!basePath || basePath === '/') return;
        const outDir = fileURLToPath(dir);
        const cleanBase = basePath.replace(/\/+$/, '');

        function walk(currentDir) {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (/\.(html|js|css|xml|json)$/i.test(entry.name)) {
              let text = fs.readFileSync(fullPath, 'utf8');
              let updated = text;

              // 1. HTML attributes: href, src, action, poster (ignoring //, http:, https:, data:)
              updated = updated.replace(/(href|src|action|poster)=["']\/([^\/][^"']*)["']/g, (m, attr, rest) => {
                if (rest.startsWith(cleanBase.slice(1) + '/')) return m;
                return `${attr}="${cleanBase}/${rest}"`;
              });

              // 2. CSS url(/...)
              updated = updated.replace(/url\(\s*["']?\/([^\/][^"')]+)["']?\s*\)/g, (m, rest) => {
                if (rest.startsWith(cleanBase.slice(1) + '/')) return m;
                return `url("${cleanBase}/${rest}")`;
              });

              // 3. JS string literals for known static folders (/assets/, /data/)
              updated = updated.replace(/["']\/(assets|data)\/([^"']*)["']/g, (m, folder, rest) => {
                return `"${cleanBase}/${folder}/${rest}"`;
              });

              if (updated !== text) {
                fs.writeFileSync(fullPath, updated, 'utf8');
              }
            }
          }
        }

        walk(outDir);
      }
    }
  };
}

export default defineConfig({
  site,
  base,
  compressHTML: true,
  integrations: [basePathPrefixer(base)],
  build: {
    format: 'directory',
    inlineStylesheets: 'always'
  }
});
