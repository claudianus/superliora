import { describe, expect, it } from 'vitest';

import {
  NO_AI_SLOP_PROSE_GATE,
  NO_AI_SLOP_SKILL_NAMES,
  NO_AI_SLOP_SKILL_ROUTING,
} from '../../src/anti-slop/contract';

describe('anti-slop contract', () => {
  it('lists core harness skill names in routing guidance', () => {
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain(NO_AI_SLOP_SKILL_NAMES.router);
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain(NO_AI_SLOP_SKILL_NAMES.audit);
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain('anti slop ui design');
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain('anti slop changelog pr');
  });

  it('uses dynamic SearchSkill routing instead of mandatory locale hardcoding', () => {
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain('SearchSkill');
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain('response language');
    expect(NO_AI_SLOP_SKILL_ROUTING).toContain('do not assume any default locale');
    expect(NO_AI_SLOP_PROSE_GATE).toContain('Skip anti-slop skill loads');
    expect(NO_AI_SLOP_PROSE_GATE).not.toContain('MANDATORY');
    // Injected into Ultra Plan write/exit phases — keep routing compact.
    expect(NO_AI_SLOP_SKILL_ROUTING.length).toBeLessThan(900);
  });
});
