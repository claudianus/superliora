/**
 * Platform / arch helpers for the SuperLiora installer.
 */

import { homedir } from 'node:os';

export const DEFAULT_NODE_MIN = '24.15.0';
export const DEFAULT_REPO = 'https://github.com/claudianus/superliora.git';
export const DEFAULT_REF = 'main';
export const DEFAULT_MANIFEST_URL =
  'https://github.com/claudianus/superliora/releases/latest/download/manifest.json';
export const GITHUB_RELEASES_BASE =
  'https://github.com/claudianus/superliora/releases';
export const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/claudianus/superliora/main';

/** Normalize `0.5.0` / `v0.5.0` → tag `v0.5.0`. */
export function releaseTagForVersion(version) {
  const trimmed = String(version ?? '').trim();
  if (!trimmed) throw new Error('release version is required');
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

/** Manifest URL for a pinned release tag (not `/latest`). */
export function manifestUrlForVersion(version) {
  const tag = releaseTagForVersion(version);
  return `${GITHUB_RELEASES_BASE}/download/${tag}/manifest.json`;
}

export const STAGE_MARKER_PREFIX = '__LIORA_UPGRADE_STAGE__=';

/** @returns {'darwin'|'linux'|'win32'} */
export function platformId(platform = process.platform) {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform;
  throw new Error(`Unsupported platform: ${platform}`);
}

/** @returns {'x64'|'arm64'} */
export function archId(arch = process.arch) {
  if (arch === 'x64' || arch === 'arm64') return arch;
  if (arch === 'amd64') return 'x64';
  throw new Error(`Unsupported architecture: ${arch}`);
}

/** Native release target triple, e.g. darwin-arm64 */
export function releaseTarget(platform = process.platform, arch = process.arch) {
  return `${platformId(platform)}-${archId(arch)}`;
}

export function defaultHome() {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

export function defaultInstallDir() {
  return `${defaultHome()}/.superliora/source`;
}

export function defaultBinDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? `${defaultHome()}/AppData/Local`;
    return `${base}/SuperLiora/bin`;
  }
  return `${defaultHome()}/.local/bin`;
}

export function defaultRuntimeNodeDir() {
  return `${defaultHome()}/.superliora/runtime/node`;
}

export function nodeDistSlug(version, platform = process.platform, arch = process.arch) {
  const p = platformId(platform);
  const a = archId(arch);
  if (p === 'win32') return `node-v${version}-win-${a}`;
  if (p === 'darwin') return `node-v${version}-darwin-${a}`;
  return `node-v${version}-linux-${a}`;
}

export function nodeDistUrl(version, platform = process.platform, arch = process.arch) {
  const slug = nodeDistSlug(version, platform, arch);
  const ext = platformId(platform) === 'win32' ? 'zip' : 'tar.gz';
  return `https://nodejs.org/dist/v${version}/${slug}.${ext}`;
}

/** Compare semver triples; true when actual >= required. */
export function versionGte(actual, required) {
  const a = String(actual).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const r = String(required).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const rv = r[i] ?? 0;
    if (av > rv) return true;
    if (av < rv) return false;
  }
  return true;
}

export function githubArchiveUrl(repoUrl, ref) {
  // https://github.com/owner/repo.git → https://github.com/owner/repo/archive/refs/heads/main.tar.gz
  const trimmed = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const m = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!m) return null;
  const [, owner, repo] = m;
  // Prefer heads; tags also work via refs/tags/ — callers may pass tag names.
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(ref)}.tar.gz`;
}

export function githubArchiveZipUrl(repoUrl, ref) {
  const trimmed = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const m = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!m) return null;
  const [, owner, repo] = m;
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(ref)}.zip`;
}
