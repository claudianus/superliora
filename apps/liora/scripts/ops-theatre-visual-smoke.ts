/**
 * Ops Theatre visual-smoke slice — deterministic grid + intervention tray snapshot.
 * Invoked from scripts/visual-smoke.mjs (smoke:visual).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderOpsTheatreSmokeSnapshot } from '#/tui/features/ops-theatre/smoke-fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const repoRoot = join(appRoot, '..', '..');
const snapshotDir = join(repoRoot, '.superliora', 'visual-smoke');
const snapshotPath = join(snapshotDir, 'ops-theatre.txt');

const REQUIRED_MARKERS = [
  'Fleet / Agents',
  'Mission / Goal',
  'Git / Workspace',
  'Runtime Health',
  'Goal: active · Ship Ops Theatre grid',
  'Git: main · dirty · 5 files · +12/−3',
  '▼ Intervention tray',
  'Ctrl-S steer mid-turn · /ops auto-refreshes',
] as const;

async function main(): Promise<void> {
  const lines = renderOpsTheatreSmokeSnapshot();
  const text = lines.join('\n');

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(snapshotPath, `${text}\n`, 'utf8');

  const failures = REQUIRED_MARKERS.filter((marker) => !text.includes(marker));
  for (const marker of REQUIRED_MARKERS) {
    console.log(`${failures.includes(marker) ? 'FAIL' : 'PASS'}  ops-theatre: ${marker}`);
  }
  console.log(`ops-theatre-visual-smoke: snapshot at ${snapshotPath}`);
  if (failures.length > 0) {
    console.error(`ops-theatre-visual-smoke: ${String(failures.length)} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `ops-theatre-visual-smoke: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
