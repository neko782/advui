import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Both artifacts identify the same source, including uncommitted changes.
const hash = createHash('sha256');
async function hashSources(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await hashSources(file);
    else { hash.update(file); hash.update(await readFile(file)); }
  }
}
await hashSources('src');
await hashSources('public');
await hashSources('scripts');
for (const file of ['index.html', 'vite.config.ts', 'svelte.config.js', 'package.json', 'bun.lock']) {
  hash.update(await readFile(file));
}
hash.update(JSON.stringify(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')).sort()));
const version = hash.digest('hex').slice(0, 16);
process.env.ADVUI_BUILD_VERSION = version;
const { build } = await import('vite');
const temporary = await mkdtemp(join(tmpdir(), 'advui-offline-'));
try {
  process.env.ADVUI_OFFLINE = '1';
  await build({ build: { outDir: temporary, emptyOutDir: true, copyPublicDir: false } });
  const offlineHtml = await readFile(join(temporary, 'index.html'));
  delete process.env.ADVUI_OFFLINE;
  await build();
  await writeFile('dist/advui-offline.html', offlineHtml);
  await writeFile('dist/version.json', JSON.stringify({ version, builtAt: new Date().toISOString() }));
} finally {
  delete process.env.ADVUI_OFFLINE;
  await rm(temporary, { recursive: true, force: true });
}
