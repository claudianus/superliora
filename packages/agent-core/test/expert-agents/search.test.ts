import { describe, expect, it } from 'vitest';

import { globalExpertSearchEngine } from '../../src/expert-agents/search';
import { globalUltraSwarmOrchestrator } from '../../src/expert-agents/orchestrator';
import { inferExpertTaskProfile } from '../../src/expert-agents/task-profile';
import { EXPERT_CATALOG_EXTENSIONS } from '../../src/expert-agents/catalog-extensions';
import {
  buildExpertAssignmentPrompt,
  renderExpertSystemPrompt,
  resolveExpertWhenToUse,
} from '../../src/expert-agents/expert-persona';
import { EXPERT_CATALOG_BY_ID, EXPERT_CATALOG_META_BY_ID, hydrateExpertCatalogEntry } from '../../src/expert-agents/catalog';

describe('ExpertSearchEngine', () => {
  it('ranks terminal UI work ahead of sales coaches for technical TUI queries', async () => {
    await globalExpertSearchEngine.initialize();
    const query = 'Improve terminal dashboard renderer TypeScript components';
    const results = globalExpertSearchEngine.search({ query, topK: 8, taskDescription: query });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.expert.id === 'engineering-terminal-ui-engineer')).toBe(true);
    expect(results[0]?.expert.division).not.toBe('sales');
    expect(results.some((result) => result.expert.id === 'sales-coach')).toBe(false);
  });

  it('still returns sales coaches for explicit coaching queries', async () => {
    await globalExpertSearchEngine.initialize();
    const query = 'sales coaching pipeline review rep development';
    const results = globalExpertSearchEngine.search({ query, topK: 5, taskDescription: query });

    expect(results[0]?.expert.id).toBe('sales-coach');
  });

  it('includes multi-source catalog extensions in listAll()', async () => {
    await globalExpertSearchEngine.initialize();
    const ids = globalExpertSearchEngine.listAll().map((expert) => expert.id);
    expect(ids).toContain('agentcrow-qa-engineer');
    expect(ids.some((id) => id.startsWith('volt-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('ericgrill-'))).toBe(true);
    for (const expert of EXPERT_CATALOG_EXTENSIONS) {
      expect(ids).toContain(expert.id);
    }
  });
});

describe('inferExpertTaskProfile', () => {
  it('marks TUI engineering tasks as technical and excludes sales divisions', () => {
    const profile = inferExpertTaskProfile('Refactor terminal swarm dashboard components in TypeScript');
    expect(profile.technical).toBe(true);
    expect(profile.excludedDivisions).toContain('sales');
    expect(profile.preferredDivisions).toContain('engineering');
  });
});

describe('UltraSwarmOrchestrator', () => {
  it('does not staff sales coaches for TUI engineering swarms', async () => {
    const plan = await globalUltraSwarmOrchestrator.buildSwarmPlan(
      'Improve terminal dashboard feed layout and expert search accuracy for terminal UI work',
      undefined,
      { intensity: 'premium', maxExperts: 8 },
    );

    const ids = plan.experts.map((expert) => expert.expertId);
    expect(ids).not.toContain('sales-coach');
    expect(ids.some((id) =>
      id === 'engineering-terminal-ui-engineer' ||
      id === 'engineering-frontend-developer' ||
      id === 'design-ui-designer',
    )).toBe(true);
  });

  it('maps sales experts away from product_requirements lanes', async () => {
    const plan = await globalUltraSwarmOrchestrator.buildSwarmPlan(
      'Ship enterprise CRM expansion playbook with MEDDPICC coaching',
      undefined,
      { intensity: 'balanced', maxExperts: 6 },
    );

    const salesExpert = plan.experts.find((expert) => expert.division === 'sales');
    if (salesExpert !== undefined) {
      expect(salesExpert.coverageLane).not.toBe('product_requirements');
    }
  });
});

describe('Expert persona composition', () => {
  it('fills whenToUse for catalog entries that omit it', () => {
    const expert = EXPERT_CATALOG_BY_ID['sales-coach'];
    expect(expert).toBeDefined();
    const whenToUse = resolveExpertWhenToUse(expert!);
    expect(whenToUse.length).toBeGreaterThan(20);
    expect(whenToUse.toLowerCase()).toContain('sales');
  });

  it('wraps expert system prompts with persona-as-code spec and handoff schema', () => {
    const expert = EXPERT_CATALOG_BY_ID['engineering-frontend-developer']!;
    const prompt = renderExpertSystemPrompt('Base profile prompt.', expert, 'coder');
    expect(prompt).toContain('<role_declaration>');
    expect(prompt).toContain('<persona_spec>');
    expect(prompt).toContain('<persona_instruction_mitigation>');
    expect(prompt).toContain('<reasoning_protocol>');
    expect(prompt).toContain('<handoff_format>');
    expect(prompt).toContain('<expert_persona>');
    expect(prompt).not.toContain('SuperLiora');
    expect(prompt).not.toContain('LioraContext');
  });

  it('builds assignment prompts without project-specific keywords', () => {
    const expert = EXPERT_CATALOG_EXTENSIONS[0]!;
    const prompt = buildExpertAssignmentPrompt(expert, {
      taskDescription: 'Improve terminal dashboard feed readability',
    });
    expect(prompt).toContain('<assignment>');
    expect(prompt).toContain('<subagent_contract>');
    expect(prompt).not.toContain('SuperLiora');
    expect(prompt).not.toContain('UltraSwarm');
  });


  it('truncates oversized personaText before embedding it in expert prompts', () => {
    const expert = EXPERT_CATALOG_BY_ID['engineering-frontend-developer']!;
    const oversized = {
      ...expert,
      personaText: `${'A'.repeat(6_000)}\n\n## Tail that must not ship\n${'B'.repeat(200)}`,
    };
    const prompt = renderExpertSystemPrompt('Base profile prompt.', oversized, 'coder');
    expect(prompt).toContain('<expert_persona>');
    expect(prompt).not.toContain('## Tail that must not ship');
    const personaBlock = prompt.match(/<expert_persona>\n([\s\S]*?)\n<\/expert_persona>/)?.[1] ?? '';
    expect(personaBlock.length).toBeLessThanOrEqual(4_100);
    expect(personaBlock.endsWith('…')).toBe(true);
  });
});

describe('Expert catalog lazy persona hydration', () => {
  it('keeps meta entries empty until hydrateExpertCatalogEntry runs', () => {
    const meta = EXPERT_CATALOG_META_BY_ID['engineering-frontend-developer'];
    expect(meta).toBeDefined();
    expect(meta!.personaText).toBe('');
    const hydrated = hydrateExpertCatalogEntry(meta);
    expect(hydrated?.personaText.length).toBeGreaterThan(100);
    expect(EXPERT_CATALOG_BY_ID['engineering-frontend-developer']?.personaText.length).toBeGreaterThan(100);
  });
});
