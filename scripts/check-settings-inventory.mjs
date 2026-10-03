#!/usr/bin/env node
/**
 * Native operator settings inventory — compare required controls against
 * Settings picker entries and config panel wiring.
 *
 * Usage:
 *   node scripts/check-settings-inventory.mjs          # warn, exit 0
 *   node scripts/check-settings-inventory.mjs --fail   # exit 1 when gaps found
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnGap = process.argv.includes('--fail');

const selectorPath = join(
  repoRoot,
  'apps/liora/src/tui/components/dialogs/picker/settings-selector.ts',
);
const settingsPath = join(repoRoot, 'apps/liora/src/tui/commands/config/settings.ts');
const configDir = join(repoRoot, 'apps/liora/src/tui/commands/config');

/** Required native settings panels. */
const PANEL_REQUIRED = [
  { node: 'Providers & API', value: 'providers-api', panel: 'providers-api-settings.ts' },
  { node: 'Keyboard / Keybindings', value: 'keybindings', panel: 'keybindings-settings.ts' },
  { node: 'Security', value: 'security', panel: 'security-settings.ts' },
  { node: 'Cache', value: 'cache', panel: 'cache-settings.ts' },
  { node: 'Host', value: 'host', panel: 'host-settings.ts' },
  { node: 'Telemetry', value: 'telemetry', panel: 'telemetry-settings.ts' },
  { node: 'Network / Proxy', value: 'network', panel: 'network-settings.ts' },
  { node: 'Storage', value: 'storage', panel: 'storage-settings.ts' },
];

const BASELINE_REQUIRED = [
  { node: 'Model', value: 'model' },
  { node: 'Model fallback', value: 'model-fallback' },
  { node: 'Permission', value: 'permission' },
  { node: 'Accounts', value: 'accounts' },
  { node: 'Execution limits', value: 'limits' },
];

/** Other native picker entries with dedicated settings panels. */
const EXTRA_PANEL_ENTRIES = [
  { node: 'Appearance', value: 'appearance', panel: 'appearance-settings.ts' },
  { node: 'Theme', value: 'theme', panel: 'theme-settings.ts' },
  { node: 'Footer', value: 'footer', panel: 'footer-settings.ts' },
  { node: 'Editor', value: 'editor', panel: 'editor-settings.ts' },
  { node: 'Automatic updates', value: 'upgrade', panel: 'upgrade-settings.ts' },
  { node: 'Usage', value: 'usage', panel: 'usage-settings.ts' },
];

/** Panel basename → SettingsSelection value (top-level Settings → entries). */
const PANEL_VALUE_MAP = Object.fromEntries(
  [...PANEL_REQUIRED, ...BASELINE_REQUIRED, ...EXTRA_PANEL_ENTRIES]
    .filter((row) => row.panel)
    .map((row) => [row.panel, row.value]),
);

function rel(path) {
  return relative(repoRoot, path);
}

function parseSettingsOptions(source) {
  const options = [];
  // Read the definitions before locale-aware label resolution.
  const block =
    source.match(
      /(?:export\s+)?const SETTINGS_OPTIONS_BASE[\s\S]*?\];/,
    ) ?? source.match(/export const SETTINGS_OPTIONS[\s\S]*?\];/);
  if (!block) return options;
  const entryRe = /\{([\s\S]*?)^\s*\},?/gm;
  let match;
  while ((match = entryRe.exec(block[0])) !== null) {
    const value = match[1].match(/\bvalue:\s*'([^']+)'/)?.[1];
    const label = match[1].match(/\blabel:\s*'([^']+)'/)?.[1];
    const labelKey = match[1].match(/\blabelKey:\s*'([^']+)'/)?.[1];
    if (value !== undefined && (label !== undefined || labelKey !== undefined)) {
      options.push({ value, label, labelKey });
    }
  }
  return options;
}

function parseSwitchCases(source) {
  const cases = new Set();
  const caseRe = /case\s+'([^']+)':/g;
  let match;
  while ((match = caseRe.exec(source)) !== null) {
    cases.add(match[1]);
  }
  return cases;
}

function listConfigPanels(dir = configDir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listConfigPanels(full, acc);
    } else if (entry.name.endsWith('-settings.ts')) {
      acc.push(relative(configDir, full));
    }
  }
  return acc.toSorted((a, b) => a.localeCompare(b));
}

function findPanelPath(basename) {
  const panels = listConfigPanels();
  return panels.find((p) => p.endsWith(`/${basename}`) || p === basename);
}

const warns = [];
const errors = [];

const selectorSource = readFileSync(selectorPath, 'utf8');
const settingsSource = readFileSync(settingsPath, 'utf8');
const pickerOptions = parseSettingsOptions(selectorSource);
const pickerByValue = new Map(pickerOptions.map((opt) => [opt.value, opt]));
const switchCases = parseSwitchCases(settingsSource);
const configPanels = listConfigPanels();

console.log('── Native settings inventory ─────────────────');
console.log(`Picker entries: ${pickerOptions.length}`);
console.log(`Config *-settings panels: ${configPanels.length}`);
console.log('');

const requiredRows = [...PANEL_REQUIRED, ...BASELINE_REQUIRED];
const covered = [];
const missing = [];

for (const row of requiredRows) {
  const option = pickerByValue.get(row.value);
  if (option === undefined) {
    missing.push({ ...row, reason: 'missing picker value' });
    continue;
  }
  const label = option.label ?? option.labelKey;
  if (option.label !== undefined && row.node !== option.label) {
    warns.push(
      `${row.node}: label mismatch — expected "${row.node}", got "${label}" (${row.value})`,
    );
  }
  if (row.panel !== undefined && findPanelPath(row.panel) === undefined) {
    missing.push({ ...row, reason: `panel file missing (${row.panel})` });
    continue;
  }
  if (!switchCases.has(row.value)) {
    missing.push({ ...row, reason: 'missing settings.ts switch case' });
    continue;
  }
  covered.push({ ...row, label });
}

console.log('Required native controls:');
for (const row of requiredRows) {
  const ok = covered.some((c) => c.value === row.value);
  const status = ok ? 'ok' : 'MISSING';
  const panelSuffix = row.panel ? ` · ${row.panel}` : '';
  console.log(`  ${status.padEnd(7)} ${row.node.padEnd(22)} ${row.value}${panelSuffix}`);
}
console.log('');

const orphanedPanels = configPanels.filter((panel) => {
  const basename = panel.split('/').pop();
  const value = PANEL_VALUE_MAP[basename];
  return value === undefined || !pickerByValue.has(value);
});

if (orphanedPanels.length > 0) {
  for (const panel of orphanedPanels) {
    warns.push(`Orphaned panel (no top-level picker): ${rel(join(configDir, panel))}`);
  }
}

const extraPicker = pickerOptions.filter(
  (opt) => !requiredRows.some((row) => row.value === opt.value),
);
if (extraPicker.length > 0) {
  console.log(`Extra picker entries (${extraPicker.length}, informational):`);
  for (const opt of extraPicker) {
    console.log(`  + ${(opt.label ?? opt.labelKey).padEnd(22)} ${opt.value}`);
  }
  console.log('');
}

if (warns.length > 0) {
  console.log('Warnings:');
  for (const w of warns) console.log(`  ⚠ ${w}`);
  console.log('');
}

if (missing.length > 0) {
  console.log('Gaps:');
  for (const row of missing) {
    const msg = `${row.node} (${row.value}): ${row.reason}`;
    console.log(`  ✗ ${msg}`);
    errors.push(msg);
  }
  console.log('');
}

const summary =
  missing.length === 0
    ? `PASS — ${covered.length}/${requiredRows.length} required nodes wired`
    : `FAIL — ${missing.length} gap(s), ${covered.length}/${requiredRows.length} wired`;

console.log(summary);

if (missing.length > 0 && failOnGap) {
  process.exit(1);
}
process.exit(0);
