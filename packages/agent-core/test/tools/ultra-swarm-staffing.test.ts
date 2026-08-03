import { describe, expect, it } from 'vitest';

import type { ExpertAssignment } from '../../src/expert-agents/types';
import type { UltraSwarmRenderedResult } from '../../src/tools/builtin/fleet/ultra-swarm-phase';
import {
  buildInitialSpecs,
  renderUltraSwarmResults,
} from '../../src/tools/builtin/fleet/ultra-swarm-phase';

function assignment(overrides: Partial<ExpertAssignment> = {}): ExpertAssignment {
  return {
    expertId: 'backend-architect',
    expertName: 'Backend Architect',
    prompt: 'Do the backend work',
    emoji: '🛠',
    color: '#336699',
    ...overrides,
  };
}

describe('UltraSwarm staffing audit (T4-7a)', () => {
  it('fills a default selection reason when the catalog gives none', () => {
    const specs = buildInitialSpecs({
      experts: [
        assignment({ division: 'Engineering' }),
        assignment({
          expertId: 'qa-reviewer',
          expertName: 'QA Reviewer',
          selectionReason: 'Explicit caller pick.',
        }),
      ],
      focus: 'implement',
      runId: 'run-staff',
      workNodeIds: [],
      requiredExpertIds: new Set<string>(),
    });

    expect(specs[0]?.selectionReason).toContain('Catalog match');
    expect(specs[0]?.selectionReason).toContain('Engineering');
    expect(specs[1]?.selectionReason).toBe('Explicit caller pick.');
  });

  it('renders a staffing preview block ahead of expert bodies', () => {
    const specs = buildInitialSpecs({
      experts: [assignment()],
      focus: 'implement',
      runId: 'run-staff',
      workNodeIds: [],
      requiredExpertIds: new Set<string>(),
    });
    const rendered: UltraSwarmRenderedResult[] = specs.map((spec) => ({
      spec,
      status: 'completed',
      verdict: 'PASS',
      evidenceIds: [],
      result: 'VERDICT: PASS\nfiles_changed: src/a.ts',
    }));

    const xml = renderUltraSwarmResults(
      rendered,
      { taskDescription: 'build it', strategy: 'parallel' },
      'run-staff',
    );

    expect(xml).toContain('<staffing experts="1">');
    expect(xml).toMatch(/<staff expert_id="backend-architect"[^>]*reason="Catalog match/);
    expect(xml.indexOf('<staffing')).toBeLessThan(xml.indexOf('<expert '));
    expect(xml.indexOf('<staffing')).toBeLessThan(xml.indexOf('<integration_report'));
  });
});
