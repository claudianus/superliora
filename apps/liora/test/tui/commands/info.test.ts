import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadStatusRecoveryReadiness } from '#/tui/commands/info';

let workDir: string;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

describe('status command recovery readiness', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'kimi-status-recovery-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('marks recovery ready from a passing SOTA summary with live workflow evidence', () => {
    const summaryPath = join(workDir, '.superliora', 'evidence', 'sota', 'sota-gate-summary.json');
    writeJson(summaryPath, {
      status: 'PASS',
      completedAt: '2026-06-30T19:10:26.399Z',
      tuiWorkflowProof: { status: 'PASS' },
      tuiUltraworkProof: { status: 'PASS' },
      harnessRadarGate: { status: 'PASS' },
    });

    expect(loadStatusRecoveryReadiness(workDir)).toEqual({
      ready: true,
      evidencePath: '.superliora/evidence/sota/sota-gate-summary.json',
      nextAction: 'Recovery evidence ready.',
    });
  });

  it('keeps recovery advisory when no SOTA evidence exists', () => {
    expect(loadStatusRecoveryReadiness(workDir)).toEqual({
      ready: false,
      nextAction: 'Run live TUI SOTA gate to capture recovery evidence.',
    });
  });
});
