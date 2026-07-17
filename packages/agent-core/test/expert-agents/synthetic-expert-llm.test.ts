import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDeterministicSyntheticExpert,
  parseSyntheticExpertsResponse,
} from '../../src/expert-agents/synthetic-expert-llm';
import {
  clearSyntheticExpertsForTests,
  getSyntheticExpert,
  registerSyntheticExpert,
} from '../../src/expert-agents/synthetic-expert-registry';
import { resolveExpertCatalogEntry } from '../../src/expert-agents/catalog-extensions';
import { planFromSyntheticExperts } from '../../src/tools/builtin/collaboration/ultra-swarm-helpers';

describe('synthetic expert LLM fallback', () => {
  afterEach(() => {
    clearSyntheticExpertsForTests();
  });

  it('parses high-quality LLM JSON into catalog experts', () => {
    const text = JSON.stringify({
      experts: [
        {
          slug: 'quantum-protocol-auditor',
          name: 'Quantum Protocol Auditor',
          emoji: '🔬',
          color: '#6366F1',
          division: 'security',
          description: 'Audits post-quantum crypto protocols for real-world deployments.',
          vibe: 'rigorous · adversarial · precise',
          tags: ['crypto', 'pqc'],
          capabilities: ['protocol review', 'threat modeling'],
          when_to_use: 'When post-quantum cryptography needs expert review.',
          coverage_lane: 'security_privacy',
          persona_markdown: [
            '# Quantum Protocol Auditor',
            '',
            'You are a principal security researcher specializing in post-quantum cryptography.',
            'Demand formal threat models, concrete attack surface enumeration, and testable mitigations.',
            'Never accept hand-wavy "quantum-safe" claims without evidence.',
          ].join('\n'),
        },
      ],
    });

    const experts = parseSyntheticExpertsResponse(text, 2);
    expect(experts).toHaveLength(1);
    expect(experts[0]!.id).toBe('synthetic-quantum-protocol-auditor');
    expect(experts[0]!.personaText).toContain('post-quantum');
    expect(experts[0]!.division).toBe('security');
    expect(experts[0]!.tags).toContain('security_privacy');
  });

  it('rejects incomplete LLM payloads', () => {
    expect(parseSyntheticExpertsResponse('{"experts":[{"name":"x"}]}', 2)).toEqual([]);
    expect(parseSyntheticExpertsResponse('not json', 2)).toEqual([]);
  });

  it('builds deterministic fallback expert with non-empty persona', () => {
    const expert = buildDeterministicSyntheticExpert(
      'Implement a lock-free SPSC ring buffer in Rust',
      'architecture_implementation',
    );
    expect(expert.id.startsWith('synthetic-')).toBe(true);
    expect(expert.personaText.length).toBeGreaterThan(200);
    expect(expert.division).toBe('engineering');
  });

  it('registers synthetic experts for resolveExpertCatalogEntry / spawn', () => {
    const expert = buildDeterministicSyntheticExpert('Niche domain task');
    registerSyntheticExpert(expert);
    expect(getSyntheticExpert(expert.id)?.name).toBe(expert.name);
    expect(resolveExpertCatalogEntry(expert.id)?.id).toBe(expert.id);
  });

  it('planFromSyntheticExperts produces assignments with selection reason', () => {
    const expert = buildDeterministicSyntheticExpert('Ship a premium TUI meter');
    const plan = planFromSyntheticExperts('Ship a premium TUI meter', [expert]);
    expect(plan.experts).toHaveLength(1);
    expect(plan.experts[0]!.selectionReason).toContain('LLM-synthesized');
    expect(plan.experts[0]!.prompt.length).toBeGreaterThan(50);
  });
});
