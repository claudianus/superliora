import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
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

export default defineConfig({
  base: '/superliora/',
  plugins: [react(), tailwindcss()],
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
