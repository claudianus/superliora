import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: {
    neverBundle: [
      '@agentclientprotocol/sdk',
      '@superliora/agent-core',
      '@superliora/sdk',
      '@superliora/kosong',
      '@superliora/kaos',
    ],
  },
});
