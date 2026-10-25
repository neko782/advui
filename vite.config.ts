import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import Icons from 'unplugin-icons/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';
import { execSync } from 'child_process';
import { readFileSync } from 'node:fs';

const offline = process.env.ADVUI_OFFLINE === '1';
const appVersion = process.env.ADVUI_BUILD_VERSION || (process.env.VITEST ? '0000000000000000' : 'dev');

// Get exactly the first 4 characters of the git commit hash
const getGitHash = (): string => {
  try {
    return execSync('git rev-parse HEAD').toString().trim().slice(0, 4);
  } catch {
    return 'dev';
  }
};

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    Icons({
      compiler: 'svelte',
    }),
    offline ? viteSingleFile() : null,
    offline ? {
      name: 'offline-document',
      transformIndexHtml(html: string) {
        const icon = readFileSync(new URL('./public/advui-icon.jpg', import.meta.url)).toString('base64');
        return html.replace('href="/advui-icon.jpg"', `href="data:image/jpeg;base64,${icon}"`)
          .replace('</head>', '<meta name="advui-offline" content="true"><meta name="advui-update-url" content=""></head>');
      },
    } : null,
    !offline && process.env.ANALYZE === '1'
      ? visualizer({
          filename: 'stats.json',
          template: 'raw-data',
          gzipSize: true,
          brotliSize: true,
        })
      : null,
  ].filter(Boolean),
  define: {
    __GIT_HASH__: JSON.stringify(getGitHash()),
    __APP_VERSION__: JSON.stringify(appVersion),
    __OFFLINE_BUILD__: JSON.stringify(offline),
  },
  // Vitest runs components in happy-dom; make Svelte resolve its client build
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
