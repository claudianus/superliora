import { describe, expect, it } from 'vitest';

import {
  githubArchiveUrl,
  nodeDistUrl,
  releaseTarget,
  versionGte,
} from '../../../../scripts/install/platform.mjs';
import { parseUpgradeStageLine } from '#/cli/update/install-stages';
import { renderLines } from '../../../../scripts/install/theatre.mjs';

describe('scripts/install/platform', () => {
  it('builds release targets and node dist URLs', () => {
    expect(releaseTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(releaseTarget('win32', 'x64')).toBe('win32-x64');
    expect(nodeDistUrl('24.15.0', 'linux', 'x64')).toContain(
      'node-v24.15.0-linux-x64.tar.gz',
    );
    expect(nodeDistUrl('24.15.0', 'win32', 'arm64')).toContain(
      'node-v24.15.0-win-arm64.zip',
    );
  });

  it('compares semver floors', () => {
    expect(versionGte('24.15.0', '24.15.0')).toBe(true);
    expect(versionGte('24.15.1', '24.15.0')).toBe(true);
    expect(versionGte('24.14.0', '24.15.0')).toBe(false);
  });

  it('derives GitHub archive URLs', () => {
    expect(githubArchiveUrl('https://github.com/claudianus/superliora.git', 'main')).toBe(
      'https://github.com/claudianus/superliora/archive/refs/heads/main.tar.gz',
    );
  });
});

describe('install stage markers', () => {
  it('parses bootstrapping and sidecars', () => {
    expect(parseUpgradeStageLine('__LIORA_UPGRADE_STAGE__=bootstrapping')).toBe('bootstrapping');
    expect(parseUpgradeStageLine('__LIORA_UPGRADE_STAGE__=sidecars')).toBe('sidecars');
    expect(parseUpgradeStageLine('__LIORA_UPGRADE_STAGE__=nope')).toBeNull();
  });
});

describe('install theatre', () => {
  it('renders checklist lines without throwing', () => {
    const lines = renderLines({
      title: 'Installing SuperLiora',
      mode: 'prebuilt',
      stage: 'downloading',
      detail: 'Fetching release manifest',
      startedAtMs: Date.now() - 1000,
      pipeline: [
        'checking',
        'bootstrapping',
        'downloading',
        'installing',
        'sidecars',
        'done',
      ],
    });
    expect(lines.some((l) => l.includes('Installing SuperLiora'))).toBe(true);
    expect(lines.some((l) => l.includes('Downloading') || l.includes('downloading'))).toBe(true);
  });
});
