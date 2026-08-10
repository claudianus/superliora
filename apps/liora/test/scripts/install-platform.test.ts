import { describe, expect, it } from 'vitest';

import {
  githubArchiveUrl,
  manifestUrlForVersion,
  nodeDistUrl,
  releaseTagForVersion,
  releaseTarget,
  versionGte,
} from '../../../../scripts/install/platform.mjs';
import {
  installBinaryAtomically,
  restoreBinaryBackup,
} from '../../../../scripts/install/prebuilt.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('pins release manifest URLs to a tag', () => {
    expect(releaseTagForVersion('0.5.0')).toBe('v0.5.0');
    expect(releaseTagForVersion('v0.5.0')).toBe('v0.5.0');
    expect(manifestUrlForVersion('0.5.0')).toBe(
      'https://github.com/claudianus/superliora/releases/download/v0.5.0/manifest.json',
    );
  });
});

describe('scripts/install/prebuilt atomic replace', () => {
  it('parks the previous binary at .bak and can restore it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liora-prebuilt-'));
    const dest = join(dir, 'liora');
    const next = join(dir, 'liora-next');
    await writeFile(dest, 'old-binary\n', { mode: 0o755 });
    await writeFile(next, 'new-binary\n', { mode: 0o755 });

    await installBinaryAtomically(next, dest);
    expect(await readFile(dest, 'utf8')).toBe('new-binary\n');
    expect(await readFile(`${dest}.bak`, 'utf8')).toBe('old-binary\n');

    await writeFile(dest, 'broken\n', { mode: 0o755 });
    expect(await restoreBinaryBackup(dest)).toBe(true);
    expect(await readFile(dest, 'utf8')).toBe('old-binary\n');
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
