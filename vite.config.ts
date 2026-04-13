import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import Icons from 'unplugin-icons/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';
import { execSync } from 'child_process';

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
  plugins: [
    svelte(),
    Icons({
      compiler: 'svelte',
    }),
    viteSingleFile(),
    process.env.ANALYZE === '1'
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
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
