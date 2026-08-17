import { describe, expect, it } from 'vitest';

import {
  commandFileName,
  DEFAULT_PNPM_VERSION,
  githubArchiveUrl,
  manifestUrlForVersion,
  nodeDistUrl,
  pnpmRuntimeBin,
  pnpmStandaloneFilename,
  pnpmStandaloneUrl,
  releaseTagForVersion,
  releaseTarget,
  seaBinaryName,
  versionGte,
} from '../../../../scripts/install/platform.mjs';
import { commandNeedsWindowsShell, quoteCmdArgument } from '../../../../scripts/install/spawn.mjs';
import { mergeUserPath } from '../../../../scripts/install/path.mjs';
import {
  WRAPPER_MARKER,
  renderPosixWrapper,
  renderWindowsCmdWrapper,
} from '../../../../scripts/install/wrappers.mjs';
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
    expect(pnpmStandaloneFilename('win32', 'x64')).toBe('pnpm-win-x64.exe');
    expect(pnpmStandaloneFilename('linux', 'arm64')).toBe('pnpm-linux-arm64');
    expect(pnpmStandaloneFilename('darwin', 'arm64')).toBe('pnpm-macos-arm64');
    expect(pnpmStandaloneUrl(DEFAULT_PNPM_VERSION, 'win32', 'x64')).toBe(
      `https://github.com/pnpm/pnpm/releases/download/v${DEFAULT_PNPM_VERSION}/pnpm-win-x64.exe`,
    );
    expect(pnpmRuntimeBin('rt-pnpm', 'win32')).toBe(join('rt-pnpm', 'pnpm.exe'));
    expect(pnpmRuntimeBin('rt-pnpm', 'linux')).toBe(join('rt-pnpm', 'pnpm'));
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

  it('names the invocable command per platform', () => {
    expect(commandFileName('liora', 'linux')).toBe('liora');
    expect(commandFileName('liora', 'darwin')).toBe('liora');
    expect(commandFileName('liora', 'win32')).toBe('liora.cmd');
    expect(seaBinaryName('liora', 'linux')).toBe('liora');
    expect(seaBinaryName('liora', 'win32')).toBe('liora.exe');
  });
});

describe('scripts/install/spawn', () => {
  it('routes Windows shims through cmd.exe and leaves POSIX / .exe alone', () => {
    expect(commandNeedsWindowsShell('corepack', 'win32')).toBe(true);
    expect(commandNeedsWindowsShell('pnpm', 'win32')).toBe(true);
    expect(commandNeedsWindowsShell('liora.cmd', 'win32')).toBe(true);
    expect(commandNeedsWindowsShell('C:\\bin\\liora.exe', 'win32')).toBe(false);
    expect(commandNeedsWindowsShell('corepack', 'linux')).toBe(false);
    expect(commandNeedsWindowsShell('liora.cmd', 'darwin')).toBe(false);
  });

  it('quotes cmd.exe arguments that contain spaces', () => {
    expect(quoteCmdArgument('simple')).toBe('simple');
    expect(quoteCmdArgument('C:\\Program Files\\liora.cmd')).toBe('"C:\\Program Files\\liora.cmd"');
  });
});

describe('scripts/install/path mergeUserPath', () => {
  it('prepends a missing bin dir and is idempotent', () => {
    const first = mergeUserPath('C:\\Windows', 'C:\\Apps\\SuperLiora\\bin');
    expect(first.changed).toBe(true);
    expect(first.next.startsWith('C:\\Apps\\SuperLiora\\bin;')).toBe(true);
    const again = mergeUserPath(first.next, 'C:\\Apps\\SuperLiora\\bin');
    expect(again.changed).toBe(false);
    expect(again.next).toBe(first.next);
  });

  it('treats slash and backslash forms as the same User PATH entry', () => {
    const merged = mergeUserPath('C:\\Apps\\SuperLiora\\bin;C:\\Windows', 'C:/Apps/SuperLiora/bin');
    expect(merged.changed).toBe(false);
  });
});

describe('scripts/install/wrappers', () => {
  it('encodes POSIX source fallback and Windows dist fallback', () => {
    const posix = renderPosixWrapper('/repo/apps/liora', '24');
    expect(posix).toContain(WRAPPER_MARKER);
    expect(posix).toContain('dist/main.mjs');
    expect(posix).toContain('pnpm -C "$app_root" run dev:cli-only');
    expect(posix).toContain('$HOME/.superliora/runtime/pnpm/pnpm');
    expect(posix).not.toMatch(/SUPERLIORA_NO_AUTO_UPDATE=.*:-1/);

    const cmd = renderWindowsCmdWrapper('C:\\repo\\apps\\liora', {
      mainFile: 'C:\\repo\\apps\\liora\\dist\\main.mjs',
      nodeFallback: 'C:\\nodejs\\node.exe',
    });
    expect(cmd).toContain(WRAPPER_MARKER);
    expect(cmd).toContain('dist\\main.mjs');
    expect(cmd).toContain('dev:cli-only');
    expect(cmd).toContain('LIORA_NODE=C:\\nodejs\\node.exe');
    expect(cmd).toContain('.superliora\\runtime\\pnpm\\pnpm.exe');
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
