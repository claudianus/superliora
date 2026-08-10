import { describe, expect, it } from 'vitest';

import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import {
  applySurfaceKindToContract,
  verificationVisualBlocksMergeForSurface,
  visualProofRejectReason,
} from '../../src/tools/builtin/job/job-surface';

describe('job-surface contract helpers', () => {
  it('blocks web/tui/mixed without visual=passed; never blocks none/undefined', () => {
    const missing = {
      tests: 'passed' as const,
      typecheck: 'passed' as const,
      lint: 'passed' as const,
      visual: 'not_run' as const,
    };
    expect(verificationVisualBlocksMergeForSurface(missing, undefined)).toBe(false);
    expect(verificationVisualBlocksMergeForSurface(missing, 'none')).toBe(false);
    expect(verificationVisualBlocksMergeForSurface(missing, 'web')).toBe(true);
    expect(verificationVisualBlocksMergeForSurface(missing, 'tui')).toBe(true);
    expect(
      verificationVisualBlocksMergeForSurface(
        { ...missing, visual: 'passed', interaction: 'passed', craft: 'passed' },
        'web',
      ),
    ).toBe(false);
    expect(
      verificationVisualBlocksMergeForSurface(
        { ...missing, visual: 'passed', interaction: 'not_applicable', craft: 'not_applicable' },
        'tui',
      ),
    ).toBe(false);
  });

  it('names TUI smoke in reject reasons', () => {
    expect(visualProofRejectReason('tui', 'not_run')).toMatch(/smoke:visual/);
    expect(visualProofRejectReason('web', 'not_run')).toMatch(/VerifySurface/);
  });

  it('remaps none/tui contracts away from web axis requirements', () => {
    const base = buildSubagentResultContract({
      agentId: 'a',
      profile: 'coder',
      summary: 'x',
      filesChanged: ['apps/liora/src/tui/components/idle-stage.ts'],
      verification: {
        tests: 'passed',
        typecheck: 'passed',
        lint: 'passed',
        visual: 'not_applicable',
        interaction: 'not_run',
        craft: 'not_run',
      },
    });
    const none = applySurfaceKindToContract(base, 'none');
    expect(none.verification.visual).toBe('not_applicable');
    expect(none.verification.interaction).toBe('not_applicable');

    const tuiSmoke = applySurfaceKindToContract(base, 'tui', { ledgerVisual: 'passed' });
    expect(tuiSmoke.verification.visual).toBe('passed');
    expect(tuiSmoke.verification.interaction).toBe('not_applicable');
    expect(tuiSmoke.verification.craft).toBe('not_applicable');
  });
});
