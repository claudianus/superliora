import { describe, expect, it } from 'vitest';

import { SessionSkillRegistry, ULTRAWORK_SKILL, registerBuiltinSkills } from '../../src/skill';

describe('builtin skill: ultrawork', () => {
  it('has the expected identity and inline metadata', () => {
    expect(ULTRAWORK_SKILL.name).toBe('ultrawork');
    expect(ULTRAWORK_SKILL.source).toBe('builtin');
    expect(ULTRAWORK_SKILL.description.length).toBeGreaterThan(0);
    expect(ULTRAWORK_SKILL.metadata.type).toBe('inline');
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(ULTRAWORK_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    const skill = registry.getSkill('ultrawork');
    expect(skill).toBeDefined();
    expect(skill?.metadata.disableModelInvocation).not.toBe(true);
  });

  it('carries the full workflow methodology the lean activation prompt no longer injects', () => {
    const content = ULTRAWORK_SKILL.content;

    // Workflow spine and activation.
    expect(content).toContain('UltraResearch prelude -> UltraPlan interview -> UltraGoal');
    expect(content).toContain('Ultra Plan Research first');
    expect(content).toContain('Shift-Tab turns Ultrawork mode ON');
    expect(content).toContain('Headless/auto without TUI defaults to Manual');
    expect(content).toContain('울트라플랜');

    // Research / interview rules.
    expect(content).toContain('Investigation only');
    expect(content).toContain('Context7Resolve/Context7Docs');
    expect(content).toContain('LocalResearchStack');
    expect(content).toContain('Baseline + Upgrade');
    expect(content).toContain('NextPhase({ phase: "interview" })');
    expect(content).toContain('NextPhase({ phase: "design" })');

    // Plan artifacts and swarm decision.
    expect(content).toContain('Seed Spec');
    expect(content).toContain('AC Tree');
    expect(content).toContain('WorkGraph');
    expect(content).toContain('Evaluation Plan');
    expect(content).toContain('Execution Plan');
    expect(content).toContain('Swarm decision: ENGAGE|DEFER');
    expect(content).toContain('Capability Coverage Matrix');

    // Evidence ledger and core operating rules.
    expect(content).toContain('workflow-report.md');
    expect(content).toContain('workflow-stages.json');
    expect(content).toContain('liora_recall');
    expect(content).toContain('llm_wiki');
    expect(content).toContain('wrote|skipped|blocked');
    expect(content).toContain('Liora Knowledge Map');
    expect(content).toContain('EXTRACTED');
    expect(content).toContain('Definition of Done');
    expect(content).toContain('Premium injector owns the full bar');
    expect(content).toContain('Art Direction Brief');

    // Surface capability sections.
    expect(content).toContain('Browser / computer-use verification');
    expect(content).toContain('LioraBench');
    expect(content).toContain('node scripts/liora-agent-sota-gate.mjs');
    expect(content).toContain('C001');
    expect(content).toContain('C002');
    expect(content).toContain('C003');
  });
});
