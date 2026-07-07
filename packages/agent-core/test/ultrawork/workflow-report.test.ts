import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { UltraworkMode } from '../../src/ultrawork/mode';
import {
  recordUltraworkWorkflowStage,
  seedUltraworkWorkflowReport,
  WORKFLOW_REPORT_FILENAME,
  WORKFLOW_STAGES_FILENAME,
} from '../../src/ultrawork/workflow-report';

function mockAgent(workDir: string) {
  const reminders: string[] = [];
  return {
    reminders,
    kaos: { getcwd: () => workDir },
    log: { warn: () => {} },
    records: { logRecord: () => {}, flush: async () => {} },
    emitEvent: () => {},
    context: {
      appendSystemReminder: (text: string) => {
        reminders.push(text);
      },
    },
    swarmMode: { isActive: false, exit: () => {} },
    goal: { getGoal: () => ({ goal: undefined }), pauseGoal: async () => {}, resumeGoal: async () => {}, cancelGoal: async () => {} },
    tools: { getStore: () => ({ get: () => undefined }), updateStore: () => {} },
    planMode: { isActive: false, isUltraMode: false, captureStateCheckpoint: () => undefined, planFilePath: undefined, phase: undefined, interviewRoundCount: 0 },
    background: { list: () => [] },
  } as unknown as import('../../src/agent').Agent;
}

describe('ultrawork workflow report harness', () => {
  it('seeds workflow-report.md and workflow-stages.json under the evidence root', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'uw-workflow-seed-'));
    const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-1';
    try {
      const paths = seedUltraworkWorkflowReport({
        workDir,
        evidenceRoot,
        runId: 'run-1',
        objective: 'Ship feature X',
        createdAt: '2026-07-07T00:00:00.000Z',
        source: 'manual',
      });

      expect(paths.reportPath).toContain(WORKFLOW_REPORT_FILENAME);
      expect(paths.stagesPath).toContain(WORKFLOW_STAGES_FILENAME);
      const report = readFileSync(join(workDir, paths.reportPath), 'utf8');
      expect(report).toContain('mandatory transparency ledger');
      expect(report).toContain('### plan');
      expect(report).toContain('### learn');
      const ledger = JSON.parse(readFileSync(join(workDir, paths.stagesPath), 'utf8')) as {
        kind: string;
        transitions: Array<{ to: string }>;
      };
      expect(ledger.kind).toBe('ultrawork-workflow-stages');
      expect(ledger.transitions[0]?.to).toBe('intake');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('records stage transitions and injects documentation reminders', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'uw-workflow-stage-'));
    const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-2';
    try {
      seedUltraworkWorkflowReport({
        workDir,
        evidenceRoot,
        runId: 'run-2',
        objective: 'Document workflow',
        createdAt: '2026-07-07T00:00:00.000Z',
        source: 'manual',
      });

      const agent = mockAgent(workDir);
      const mode = new UltraworkMode(agent);
      mode.create({
        id: 'run-2',
        objective: 'Document workflow',
        activation: {
          source: 'manual',
          replaceGoal: false,
          evidenceRoot,
          workDir,
        },
      });

      expect(existsSync(join(workDir, evidenceRoot, WORKFLOW_REPORT_FILENAME))).toBe(true);
      expect(agent.reminders.some((text) => text.includes('<ultrawork_workflow_report>'))).toBe(true);

      const run = mode.getRun();
      expect(run).not.toBeNull();
      recordUltraworkWorkflowStage({
        workDir,
        evidenceRoot,
        run: run!,
        from: 'plan',
        to: 'research',
        reason: 'Research prelude',
      });
      const report = readFileSync(join(workDir, evidenceRoot, WORKFLOW_REPORT_FILENAME), 'utf8');
      expect(report).toContain('|');
      expect(report).toContain('plan');
      expect(report).toContain('research');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
