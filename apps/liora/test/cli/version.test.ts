import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildLioraDefaultHeaders,
  getHostPackageJsonPath,
  getHostPackageRoot,
  getVersion,
} from '#/cli/version';

describe('cli version helpers', () => {
  it('resolves the host package manifest near apps/liora and reads its version', () => {
    const pkgPath = getHostPackageJsonPath();
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

    expect(pkgPath.endsWith(join('apps', 'liora', 'package.json'))).toBe(true);
    expect(getHostPackageRoot()).toBe(dirname(pkgPath));
    expect(getVersion()).toBe(pkg.version);
  });

  it('builds default headers with the liora-cli user-agent', () => {
    const headers = buildLioraDefaultHeaders('1.2.3');

    expect(headers['User-Agent']).toBe('liora-cli/1.2.3');
  });
});
