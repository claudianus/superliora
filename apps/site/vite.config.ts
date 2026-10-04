import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const docSlugs = [
  'getting-started',
  'how-conductor-works',
  'jobs',
  'control-tower',
  'reference',
] as const;

const docsInput = Object.fromEntries(
  docSlugs.flatMap((slug) => [
    [`docs-${slug}`, resolve(__dirname, `docs/${slug}.html`)],
    [`en-docs-${slug}`, resolve(__dirname, `en/docs/${slug}.html`)],
  ]),
);

// The release line is @superliora/liora; the landing reads it at build time so the
// header badge cannot drift from what `liora --version` prints.
const lioraVersion = (
  JSON.parse(readFileSync(resolve(__dirname, '../liora/package.json'), 'utf8')) as { version: string }
).version;

export default defineConfig({
  base: '/superliora/',
  define: {
    __LIORA_VERSION__: JSON.stringify(lioraVersion),
  },
  plugins: [react(), tailwindcss()],
  server: {
    // Dev-only: allow sandboxed/cloud preview hosts. No production impact.
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        en: resolve(__dirname, 'en/index.html'),
        ...docsInput,
      },
    },
  },
});
