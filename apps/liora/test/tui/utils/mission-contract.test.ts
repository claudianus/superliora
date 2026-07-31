import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { UltraworkRun } from '@superliora/sdk';

import {
  MISSION_CONTRACT_STUB_TIP,
  buildMissionPrompt,
  isActiveMissionRun,
  isActiveUltraworkRun,
  missionModeDisableBlockedMessage,
  parseMissionCommand,
  ultraworkModeDisableBlockedMessage,
} from '#/tui/utils/mission/mission-contract';

const SRC_ROOT = join(__dirname, '..', '..', '..', 'src');
const MISSION_CONTRACT_PATH = 'tui/utils/mission/mission-contract.ts';
const ULTRAWORK_CONTRACT_PATH = 'tui/commands/ultrawork/ultrawork-contract.ts';

const ULTRAWORK_CONTRACT_IMPORT =
  /from\s+['"](?:\.\/ultrawork-contract|#\/tui\/commands\/ultrawork\/ultrawork-contract)['"]/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, files);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

const activeRun = {
  id: 'run-mission-wire',
  objective: 'Wire mission contract stub',
  status: 'running',
  stage: 'plan',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as UltraworkRun;

describe('mission-contract stub — W5 soft re-export', () => {
  it('documents the TUI import-path tip', () => {
    expect(MISSION_CONTRACT_STUB_TIP).toContain('mission-contract');
    expect(MISSION_CONTRACT_STUB_TIP).toContain('ultrawork-contract stays on disk');
  });

  it('re-exports active-run guard under mission alias', () => {
    expect(isActiveMissionRun(activeRun)).toBe(true);
    expect(isActiveUltraworkRun(activeRun)).toBe(true);
    expect(isActiveMissionRun({ ...activeRun, status: 'done' })).toBe(false);
  });

  it('re-exports mode-disable message under mission alias', () => {
    const message = missionModeDisableBlockedMessage(activeRun);
    expect(message).toBe(ultraworkModeDisableBlockedMessage(activeRun));
    expect(message).toContain('Mission mode stays on');
    expect(message).toContain('/mission pause');
  });

  it('parses create commands via mission alias', () => {
    const parsed = parseMissionCommand('ship mission contract wire');
    expect(parsed).toEqual({
      kind: 'create',
      objective: 'ship mission contract wire',
      replace: false,
    });
  });

  it('builds mission-branded prompt via mission alias', () => {
    const prompt = buildMissionPrompt('verify settings panel', 'manual');
    expect(prompt).toContain('<ultrawork_flow>');
    expect(prompt).toContain('brand: Mission');
    expect(prompt).toContain('verify settings panel');
  });

  it('forbids direct ultrawork-contract cross-imports outside the SSOT stub', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).replaceAll('\\', '/');
      if (rel === MISSION_CONTRACT_PATH || rel === ULTRAWORK_CONTRACT_PATH) continue;
      const content = readFileSync(file, 'utf8');
      if (ULTRAWORK_CONTRACT_IMPORT.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
