#!/usr/bin/env node
/**
 * Changeset-powered version bumper for the SuperLiora release train.
 *
 * Consumes every pending `.changeset/*.md`, applies semver bumps to the named
 * workspace packages, prepends a CHANGELOG section for @superliora/liora, and
 * refreshes the CDN tip files (`latest`, `latest.json`) that
 * publish-native-release.yml asserts against the release tag.
 *
 * Usage:
 *   node scripts/release-version.mjs            # apply
 *   node scripts/release-version.mjs --dry-run  # print the plan, write nothing
 *
 * Committing and tagging stays with .github/workflows/auto-release.yml.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const changesetDir = join(repoRoot, '.changeset');
const DRY_RUN = process.argv.includes('--dry-run');
const BUMP_ORDER = { major: 0, minor: 1, patch: 2 };
const SECTION_BY_LEVEL = { major: 'Major Changes', minor: 'Minor Changes', patch: 'Patch Changes' };

/**
 * Only consume changesets added after the last `chore(liora): release`
 * commit. Older files are long-lived inventory ("changesets on main are
 * inventory until someone versions"); auto-releasing them would re-document
 * changes that already shipped.
 */
function lastReleaseSha() {
  const res = spawnSync(
    'git',
    ['log', '-1', '--pretty=%H', '--grep=^chore[(]liora[)]: release'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const sha = res.stdout?.trim();
  return sha !== undefined && sha.length > 0 ? sha : undefined;
}

function changesetsAddedSince(sha) {
  const res = spawnSync('git', ['diff', '--name-only', `${sha}..HEAD`, '--', '.changeset'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error(`release-version: git diff against ${sha} failed: ${res.stderr?.trim()}`);
    process.exit(2);
  }
  return new Set(
    res.stdout
      .split('\n')
      .map((line) => line.trim().split(/[\\/]/).pop())
      .filter((name) => name !== undefined && name.endsWith('.md')),
  );
}

function listPendingChangesets() {
  if (!existsSync(changesetDir)) return [];
  const lastSha = lastReleaseSha();
  const addedSince = lastSha !== undefined ? changesetsAddedSince(lastSha) : undefined;
  if (lastSha === undefined) {
    console.log(
      'release-version: no previous release commit found — refusing to ship the whole inventory (cut one release manually first)',
    );
    process.exit(0);
  }
  return readdirSync(changesetDir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .filter((name) => addedSince.has(name))
    .map((name) => {
      const raw = readFileSync(join(changesetDir, name), 'utf8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      if (match === null) throw new Error(`changeset ${name}: missing frontmatter`);
      const releases = {};
      for (const line of match[1].split(/\r?\n/)) {
        const entry = line.match(/^['"]?([^'":]+)['"]?\s*:\s*(major|minor|patch)\s*$/);
        if (entry !== null) releases[entry[1].trim()] = entry[2];
      }
      if (Object.keys(releases).length === 0) {
        throw new Error(`changeset ${name}: no package bumps in frontmatter`);
      }
      const body = raw.slice(match[0].length).trim();
      return { file: name, releases, body };
    });
}

function bumpVersion(version, level) {
  const parts = version.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`cannot bump non-semver version: ${version}`);
  }
  if (level === 'major') return `${parts[0] + 1}.0.0`;
  if (level === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

const changesets = listPendingChangesets();
if (changesets.length === 0) {
  console.log('release-version: no pending changesets — nothing to release');
  process.exit(0);
}

// ---- plan -----------------------------------------------------------------
const lioraDir = join(repoRoot, 'apps', 'liora');
const lioraPkgPath = join(lioraDir, 'package.json');
const lioraPkg = readJson(lioraPkgPath);

const bumps = new Map(); // package name -> { dir, pkgPath, from, to }
for (const entry of changesets) {
  for (const [name, level] of Object.entries(entry.releases)) {
    const current = bumps.get(name);
    if (current === undefined || BUMP_ORDER[level] < BUMP_ORDER[current.level]) {
      bumps.set(name, { level });
    }
  }
}

// Resolve each named package's package.json without assuming the layout.
function packageJsonPath(name) {
  const candidates = [
    join(repoRoot, 'apps', 'liora', 'package.json'),
    ...readdirSync(join(repoRoot, 'packages'))
      .map((dir) => join(repoRoot, 'packages', dir, 'package.json')),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      if (readJson(path).name === name) return path;
    } catch {
      // unparseable package.json — not our candidate
    }
  }
  return undefined;
}

for (const [name, bump] of bumps) {
  const path = packageJsonPath(name);
  if (path === undefined) throw new Error(`changeset names unknown package: ${name}`);
  const pkg = readJson(path);
  bump.dir = path;
  bump.from = pkg.version;
  bump.to = bumpVersion(pkg.version, bump.level);
}

// liora release level: its own named bump, else patch (repo convention).
const lioraLevel =
  bumps.get(lioraPkg.name)?.level ?? 'patch';
const lioraVersion = bumpVersion(lioraPkg.version, lioraLevel);
const lioraBump = { dir: lioraPkgPath, from: lioraPkg.version, to: lioraVersion, level: lioraLevel };

// Group changelog bullets by the liora-effective level of each changeset.
const sections = { major: [], minor: [], patch: [] };
for (const entry of changesets) {
  const level = entry.releases[lioraPkg.name] ?? 'patch';
  for (const line of entry.body.split(/\r?\n/)) {
    const bullet = line.trim().replace(/^-\s+/, '');
    if (bullet.length > 0) sections[level].push(bullet);
  }
}

// ---- report ---------------------------------------------------------------
console.log(`release-version: plan (@superliora/liora ${lioraBump.from} -> ${lioraBump.to}, ${lioraLevel})`);
for (const [name, bump] of bumps) {
  console.log(`  ${name}: ${bump.from} -> ${bump.to} (${bump.level})`);
}
for (const level of ['major', 'minor', 'patch']) {
  for (const bullet of sections[level]) console.log(`  [${level}] ${bullet}`);
}
if (DRY_RUN) {
  console.log('release-version: dry run — no files written');
  process.exit(0);
}

// ---- apply ----------------------------------------------------------------
if (lioraVersion === lioraBump.from) throw new Error('liora version did not change');

for (const [, bump] of bumps) {
  const pkg = readJson(bump.dir);
  pkg.version = bump.to;
  writeJson(bump.dir, pkg);
}
// liora's own bump (already covered when named, still apply when defaulted).
if (!bumps.has(lioraPkg.name)) {
  const pkg = readJson(lioraPkgPath);
  pkg.version = lioraVersion;
  writeJson(lioraPkgPath, pkg);
}

const changelogPath = join(lioraDir, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');
if (changelog.includes(`## ${lioraVersion}`)) {
  throw new Error(`CHANGELOG already has a ${lioraVersion} section`);
}
const titleEnd = changelog.indexOf('\n', changelog.indexOf('# @superliora/liora')) + 1;
const lines = ['', `## ${lioraVersion}`, ''];
for (const level of ['major', 'minor', 'patch']) {
  if (sections[level].length === 0) continue;
  lines.push(`### ${SECTION_BY_LEVEL[level]}`, '');
  for (const bullet of sections[level]) lines.push(`- ${bullet}`);
  lines.push('');
}
writeFileSync(changelogPath, changelog.slice(0, titleEnd) + lines.join('\n') + changelog.slice(titleEnd));

// CDN tip files.
writeFileSync(join(repoRoot, 'latest'), lioraVersion);
const latestJsonPath = join(repoRoot, 'latest.json');
const latestJson = readJson(latestJsonPath);
latestJson.version = lioraVersion;
latestJson.publishedAt = new Date().toISOString();
writeJson(latestJsonPath, latestJson);

for (const entry of changesets) {
  rmSync(join(changesetDir, entry.file));
}

console.log(`release-version: applied ${lioraBump.from} -> ${lioraVersion} (${changesets.length} changeset(s) consumed)`);
