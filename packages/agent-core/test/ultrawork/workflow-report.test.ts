import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { UltraworkMode } from '../../src/ultrawork/mode';
import { testKaos } from '../fixtures/test-kaos';
import {
  ensureUltraworkWorkflowArtifacts,
  isUltraworkWorkflowReportWritePath,
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
    records: { logRecord: () => {}, flush: async () => {}, recordCount: () => 0 },
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
      expect((agent as unknown as { reminders: string[] }).reminders.some((text: string) => text.includes('<ultrawork_workflow_report>'))).toBe(true);

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

  it('ensures missing workflow artifacts on resume', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'uw-workflow-ensure-'));
    const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-ensure';
    try {
      const agent = new Agent({ kaos: testKaos.withCwd(workDir) });
      agent.ultrawork.restoreRun({
        type: 'ultrawork.run',
        run: {
          id: 'run-ensure',
          objective: 'Ensure workflow files',
          status: 'blocked',
          stage: 'verify',
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
        activation: {
          source: 'manual',
          replaceGoal: false,
          evidenceRoot,
          workDir,
        },
        time: Date.now(),
      });

      ensureUltraworkWorkflowArtifacts(agent);

      expect(existsSync(join(workDir, evidenceRoot, WORKFLOW_REPORT_FILENAME))).toBe(true);
      expect(existsSync(join(workDir, evidenceRoot, WORKFLOW_STAGES_FILENAME))).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('matches workflow-report.md write paths relative to the evidence root', () => {
    const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-1';
    const workDir = '/workspace/project';
    const reportPath = `${evidenceRoot}/workflow-report.md`;

    expect(isUltraworkWorkflowReportWritePath(reportPath, evidenceRoot, workDir)).toBe(true);
    expect(
      isUltraworkWorkflowReportWritePath(
        `${workDir}/${reportPath}`,
        evidenceRoot,
        workDir,
      ),
    ).toBe(true);
    expect(
      isUltraworkWorkflowReportWritePath(
        `${evidenceRoot}/workflow-stages.json`,
        evidenceRoot,
        workDir,
      ),
    ).toBe(false);
    expect(
      isUltraworkWorkflowReportWritePath('/workspace/project/src/main.ts', evidenceRoot, workDir),
    ).toBe(false);
  });
});
