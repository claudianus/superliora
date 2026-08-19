import { delimiter, dirname } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureNode } from '../../../../scripts/install/ensure-node.mjs';

const originalPath = process.env['PATH'];

describe('scripts/install/ensure-node', () => {
  afterEach(() => {
    process.env['PATH'] = originalPath;
  });

  it('publishes the resolved Node on PATH for child processes', async () => {
    // install.ps1 / install.sh start the orchestrator by absolute path, so an
    // already-good Node can be invisible to children: corepack then goes missing
    // and standalone pnpm falls back to its bundled Node for engines.node.
    process.env['PATH'] = '';

    const info = await ensureNode({ nodeMin: '1.0.0' });

    expect(info.bootstrapped).toBe(false);
    expect(info.binDir).toBe(dirname(info.nodePath));
    expect((process.env['PATH'] ?? '').split(delimiter)).toContain(info.binDir);
  });

  it('leaves PATH untouched when the Node directory already leads it', async () => {
    const nodeDir = dirname(process.execPath);
    const path = `${nodeDir}${delimiter}${dirname(nodeDir)}`;
    process.env['PATH'] = path;

    await ensureNode({ nodeMin: '1.0.0' });

    expect(process.env['PATH']).toBe(path);
  });
});
