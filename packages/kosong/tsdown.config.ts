import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    './src/index.ts',
    './src/providers/kimi/index.ts',
    './src/providers/openai-legacy/index.ts',
    './src/providers/openai-responses.ts',
    './src/providers/anthropic/index.ts',
    './src/providers/google-genai.ts',
    './src/providers/openai-common.ts',
  ],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
});
