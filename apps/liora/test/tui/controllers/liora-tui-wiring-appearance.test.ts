import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const wiringPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/tui/controllers/wiring/liora-tui-wiring.ts',
);

describe('liora-tui-wiring getAppearance', () => {
  it('uses the static resolveEffectiveAppearance import (no require / createRequire)', () => {
    const source = readFileSync(wiringPath, 'utf8');
    const getAppearanceBlock = source.match(/getAppearance:\s*\(\)\s*=>\s*\{[\s\S]*?\n    \},/)?.[0];
    expect(getAppearanceBlock).toBeDefined();
    expect(getAppearanceBlock).not.toMatch(/\brequire\s*\(/);
    expect(getAppearanceBlock).not.toMatch(/\bcreateRequire\b/);
    expect(source).toMatch(
      /import\s+\{\s*resolveEffectiveAppearance\s*\}\s+from\s+'[^']*performance-mode'/,
    );
    expect(getAppearanceBlock).toContain('resolveEffectiveAppearance(mode, stored)');
  });
});
