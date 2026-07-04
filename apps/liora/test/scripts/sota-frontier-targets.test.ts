import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  evaluateFrontierTargetGate,
  frontierTargetMarkdownLines,
} from '../../../../scripts/liora-frontier-targets.mjs';

interface ObservedTarget {
  id: string;
  target: number;
}

const criteria = JSON.parse(
  readFileSync(new URL('../../../../.superliora/bench/sota-criteria.json', import.meta.url), 'utf8'),
);

describe('frontier benchmark targets', () => {
  it('keeps Claude Sonnet 5 benchmark targets source-backed and complete', () => {
    const gate = evaluateFrontierTargetGate(criteria);

    expect(gate.status).toBe('PASS');
    expect(gate.observed.model).toBe('Claude Sonnet 5');
    expect(gate.observed.source.systemCardPdfUrl).toContain('www-cdn.anthropic.com');
    expect(gate.observed.source.verificationStatus).toBe('official-source-checked');
    const targets = gate.observed.targets as ObservedTarget[];
    expect(Object.fromEntries(targets.map((target) => [target.id, target.target]))).toEqual({
      'swe-bench-pro': 63.2,
      'terminal-bench-2-1': 80.4,
      'hle-no-tools': 43.2,
      'hle-with-tools': 57.4,
      'osworld-verified': 81.2,
      'gdpval-aa-v2': 1609,
    });
  });

  it('renders the target table without claiming local SuperLiora scores', () => {
    const gate = evaluateFrontierTargetGate(criteria);
    const markdown = frontierTargetMarkdownLines(gate.observed).join('\n');

    expect(markdown).toContain('Claude Sonnet 5');
    expect(markdown).toContain('| Agentic coding | SWE-bench Pro | 63.2% | pass rate |');
    expect(markdown).toContain('| Computer use | OSWorld-Verified | 81.2% | first-attempt success rate |');
    expect(markdown).toContain('| Knowledge work | GDPval-AA v2 | 1609 score | ELO |');
    expect(markdown).toContain('not claimed local SuperLiora scores');
  });
});

describe('free web research harness criteria', () => {
  it('requires a no-subscription WebSearch and FetchURL research path', () => {
    const harness = criteria.freeWebResearchHarness;

    expect(harness.priority).toBe('primary-ultrawork-capability');
    expect(harness.principle).toContain('without a paid search subscription');
    expect(harness.requirements.join('\n')).toContain('local no-subscription provider');
    expect(harness.requirements.join('\n')).toContain('Use FetchURL to fetch primary sources');
    expect(harness.requirements.join('\n')).toContain('3-12 keyword queries');
    expect(harness.requirements.join('\n')).toContain('Liora Knowledge Map, memory, benchmark radar, or SOTA criteria');
    expect(harness.requirements.join('\n')).toContain('Scrapling-class ideas');
    expect(harness.requirements.join('\n')).toContain('adaptive element relocation');
    expect(harness.requirements.join('\n')).toContain('TUI status surface');
    expect(harness.requirements.join('\n')).toContain('without configuring MCP first');
    expect(harness.safetyBoundaries.join('\n')).toContain('Authorized/public access is the boundary');
    expect(harness.safetyBoundaries.join('\n')).toContain('do not defeat CAPTCHA, paywall, login');
  });
});
