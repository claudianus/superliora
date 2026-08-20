import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const daemonSrc = resolve(import.meta.dirname, '..', 'src');

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(path));
      continue;
    }
    if (name.endsWith('.ts') || name.endsWith('.js') || name.endsWith('.mjs')) {
      out.push(path);
    }
  }
  return out;
}

function sourceBlob(): string {
  return walkSourceFiles(daemonSrc)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('packages/server/src anti-corruption', () => {
  it('has zero @superliora/sdk / LioraHarness / createRPC / SDKRpcClient references', () => {
    expect(sourceBlob()).not.toMatch(/@superliora\/sdk|LioraHarness\b|createRPC\b|SDKRpcClient\b/);
  });

  it('imports shared filesystem, file store, logger, and workspace services from @superliora/agent-core', () => {
    expect(sourceBlob()).not.toMatch(/['"]#\/services\/(fileStore|fs|logger|workspace)(\/|['"])/);
  });
});
