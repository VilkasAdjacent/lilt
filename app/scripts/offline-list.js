// Rewrites src/offline.json, the service worker's precache list: every published file.
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
export const publishedFiles = () => ['./', 'index.html', 'manifest.webmanifest',
  ...['src', 'vendor'].flatMap((dir) => walk(join(root, dir)))
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((p) => !p.endsWith('.md'))
    .sort()];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'src/offline.json'), `${JSON.stringify(publishedFiles(), null, 2)}\n`);
}
