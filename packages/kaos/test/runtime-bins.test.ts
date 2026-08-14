/**
 * Windows SuperLiora runtime bin resolution (Job 1).
 *
 * Pins:
 *   - resolveRuntimeBins finds git/cmd, git/bin/bash, node-v{version}/node.exe under HOME
 *   - runtimePathPrepend puts those dirs first on PATH
 *   - resolveRuntimeExecutable maps git/node/bash to absolute runtime paths
 *   - non-win32 is a no-op
 */

import { describe, expect, it } from 'vitest';

import {
  resolveRuntimeBins,
  resolveRuntimeExecutable,
  runtimePathPrepend,
  type RuntimeBinPaths,
} from '#/runtime-bins';

const HOME = 'C:\\Users\\me';
const GIT_EXE = `${HOME}\\.superliora\\runtime\\git\\cmd\\git.exe`;
const BASH_EXE = `${HOME}\\.superliora\\runtime\\git\\bin\\bash.exe`;
const NODE_EXE = `${HOME}\\.superliora\\runtime\\node\\node-v24.15.0-win-x64\\node.exe`;
const NODE_DIR = `${HOME}\\.superliora\\runtime\\node\\node-v24.15.0-win-x64`;
const GIT_CMD_DIR = `${HOME}\\.superliora\\runtime\\git\\cmd`;
const GIT_BIN_DIR = `${HOME}\\.superliora\\runtime\\git\\bin`;

function stubFiles(paths: readonly string[]): {
  isFile: (path: string) => boolean;
  listDir: (path: string) => readonly string[];
} {
  const files = new Set(paths.map((p) => p.replaceAll('/', '\\').toLowerCase()));
  const dirs = new Map<string, Set<string>>();
  for (const path of paths) {
    const normalized = path.replaceAll('/', '\\');
    const parent = normalized.slice(0, normalized.lastIndexOf('\\'));
    const name = normalized.slice(normalized.lastIndexOf('\\') + 1);
    const key = parent.toLowerCase();
    if (!dirs.has(key)) dirs.set(key, new Set());
    dirs.get(key)!.add(name);
    // Also register node slug parent listing
    if (name.toLowerCase() === 'node.exe') {
      const nodeRoot = parent.slice(0, parent.lastIndexOf('\\'));
      const slug = parent.slice(parent.lastIndexOf('\\') + 1);
      const rootKey = nodeRoot.toLowerCase();
      if (!dirs.has(rootKey)) dirs.set(rootKey, new Set());
      dirs.get(rootKey)!.add(slug);
    }
  }
  return {
    isFile: (path: string) => files.has(path.replaceAll('/', '\\').toLowerCase()),
    listDir: (path: string) => [...(dirs.get(path.replaceAll('/', '\\').toLowerCase()) ?? [])],
  };
}

describe('resolveRuntimeBins', () => {
  it('returns empty pathDirs on non-win32', () => {
    const bins = resolveRuntimeBins({
      platform: 'linux',
      env: { HOME: '/home/me' },
      isFile: () => true,
    });
    expect(bins.pathDirs).toEqual([]);
    expect(bins.gitExe).toBeUndefined();
  });

  it('resolves PortableGit git.exe + bash.exe and node under USERPROFILE', () => {
    const fs = stubFiles([GIT_EXE, BASH_EXE, NODE_EXE]);
    const bins = resolveRuntimeBins({
      platform: 'win32',
      env: { USERPROFILE: HOME },
      isFile: fs.isFile,
      listDir: fs.listDir,
    });
    expect(bins.gitExe).toBe(GIT_EXE);
    expect(bins.bashExe).toBe(BASH_EXE);
    expect(bins.nodeExe).toBe(NODE_EXE);
    expect(bins.pathDirs).toContain(GIT_CMD_DIR);
    expect(bins.pathDirs).toContain(GIT_BIN_DIR);
    expect(bins.pathDirs).toContain(NODE_DIR);
  });

  it('picks the newest node-v* slug when several exist', () => {
    const older = `${HOME}\\.superliora\\runtime\\node\\node-v20.0.0-win-x64\\node.exe`;
    const newer = NODE_EXE;
    const fs = stubFiles([GIT_EXE, BASH_EXE, older, newer]);
    const bins = resolveRuntimeBins({
      platform: 'win32',
      env: { HOME },
      isFile: fs.isFile,
      listDir: fs.listDir,
    });
    expect(bins.nodeExe).toBe(newer);
  });

  it('works with only runtime git when node is absent', () => {
    const fs = stubFiles([GIT_EXE, BASH_EXE]);
    const bins = resolveRuntimeBins({
      platform: 'win32',
      env: { HOME },
      isFile: fs.isFile,
      listDir: fs.listDir,
    });
    expect(bins.gitExe).toBe(GIT_EXE);
    expect(bins.bashExe).toBe(BASH_EXE);
    expect(bins.nodeExe).toBeUndefined();
  });
});

describe('runtimePathPrepend', () => {
  it('prepends runtime dirs ahead of existing PATH on win32', () => {
    const bins: RuntimeBinPaths = {
      gitExe: GIT_EXE,
      bashExe: BASH_EXE,
      nodeExe: NODE_EXE,
      pathDirs: [GIT_CMD_DIR, GIT_BIN_DIR, NODE_DIR],
    };
    const next = runtimePathPrepend(
      { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd', USERPROFILE: HOME },
      { platform: 'win32', bins },
    );
    const path = next['PATH']!;
    expect(path.startsWith(`${GIT_CMD_DIR};${GIT_BIN_DIR};${NODE_DIR};`)).toBe(true);
    expect(path).toContain('C:\\Windows\\System32');
    // Runtime must come before Program Files Git so bare bash/git hit PortableGit.
    expect(path.indexOf(GIT_BIN_DIR)).toBeLessThan(path.indexOf('Program Files\\Git'));
  });

  it('is a no-op when pathDirs is empty', () => {
    const next = runtimePathPrepend(
      { PATH: '/usr/bin' },
      { platform: 'linux', bins: { pathDirs: [] } },
    );
    expect(next['PATH']).toBe('/usr/bin');
  });
});

describe('resolveRuntimeExecutable', () => {
  const bins: RuntimeBinPaths = {
    gitExe: GIT_EXE,
    bashExe: BASH_EXE,
    nodeExe: NODE_EXE,
    pathDirs: [GIT_CMD_DIR, GIT_BIN_DIR, NODE_DIR],
  };

  it('maps git / git.exe to runtime git.exe', () => {
    expect(resolveRuntimeExecutable('git', bins, 'win32')).toBe(GIT_EXE);
    expect(resolveRuntimeExecutable('git.exe', bins, 'win32')).toBe(GIT_EXE);
  });

  it('maps node / node.exe to runtime node.exe', () => {
    expect(resolveRuntimeExecutable('node', bins, 'win32')).toBe(NODE_EXE);
    expect(resolveRuntimeExecutable('node.exe', bins, 'win32')).toBe(NODE_EXE);
  });

  it('maps bash / bash.exe to runtime bash.exe', () => {
    expect(resolveRuntimeExecutable('bash', bins, 'win32')).toBe(BASH_EXE);
    expect(resolveRuntimeExecutable('bash.exe', bins, 'win32')).toBe(BASH_EXE);
  });

  it('returns the input unchanged for unrelated commands', () => {
    expect(resolveRuntimeExecutable('rg', bins, 'win32')).toBe('rg');
    expect(resolveRuntimeExecutable('C:\\tools\\custom.exe', bins, 'win32')).toBe(
      'C:\\tools\\custom.exe',
    );
  });

  it('returns the input when the runtime binary is missing', () => {
    const empty: RuntimeBinPaths = { pathDirs: [] };
    expect(resolveRuntimeExecutable('git', empty, 'win32')).toBe('git');
    expect(resolveRuntimeExecutable('node.exe', empty, 'win32')).toBe('node.exe');
  });
});
