import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAIN_AGENT_PROFILE_NAME,
  MAIN_AGENT_PROFILE_ENV,
  resolveMainAgentProfile,
  resolveMainAgentProfileName,
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_CORE_PROFILE_NAME,
  SOVEREIGN_UMBRELLA_ENV,
} from '../../src/profile/main-profile';
import { DEFAULT_AGENT_PROFILES } from '../../src/profile/default';

describe('resolveMainAgentProfile', () => {
  it('defaults to conductor when env and config are unset', () => {
    expect(resolveMainAgentProfileName(undefined, {})).toBe(SOVEREIGN_CONDUCTOR_PROFILE_NAME);
    expect(resolveMainAgentProfile(DEFAULT_AGENT_PROFILES, undefined, {}).name).toBe('conductor');
    const tools = resolveMainAgentProfile(DEFAULT_AGENT_PROFILES, undefined, {}).tools;
    expect(tools.length).toBeLessThanOrEqual(30);
    expect(tools).toEqual(expect.arrayContaining(['NextPhase', 'JobCreate', 'RecordInterviewFinding']));
    expect(tools).not.toContain('UltraworkGraph');
  });

  it('still resolves conductor when SUPERLIORA_SOVEREIGN_CORE=1 and profile unset', () => {
    expect(
      resolveMainAgentProfileName(undefined, { [SOVEREIGN_CORE_DEFAULT_ENV]: '1' }),
    ).toBe(SOVEREIGN_CONDUCTOR_PROFILE_NAME);
    expect(
      resolveMainAgentProfile(DEFAULT_AGENT_PROFILES, undefined, {
        [SOVEREIGN_CORE_DEFAULT_ENV]: '1',
      }).name,
    ).toBe('conductor');
  });

  it('still resolves conductor when SUPERLIORA_SOVEREIGN=1 and profile unset', () => {
    expect(
      resolveMainAgentProfileName(undefined, { [SOVEREIGN_UMBRELLA_ENV]: '1' }),
    ).toBe(SOVEREIGN_CONDUCTOR_PROFILE_NAME);
    expect(
      resolveMainAgentProfile(DEFAULT_AGENT_PROFILES, undefined, {
        [SOVEREIGN_UMBRELLA_ENV]: 'true',
      }).name,
    ).toBe('conductor');
  });

  it('prefers SUPERLIORA_PROFILE over config', () => {
    expect(
      resolveMainAgentProfileName(
        { agent: { profile: 'agent' } },
        { [MAIN_AGENT_PROFILE_ENV]: 'core' },
      ),
    ).toBe(SOVEREIGN_CORE_PROFILE_NAME);
  });

  it('allows wide waist via SUPERLIORA_PROFILE=agent', () => {
    expect(
      resolveMainAgentProfileName(undefined, {
        [MAIN_AGENT_PROFILE_ENV]: DEFAULT_MAIN_AGENT_PROFILE_NAME,
      }),
    ).toBe(DEFAULT_MAIN_AGENT_PROFILE_NAME);
  });

  it('reads agent.profile from config when env is unset', () => {
    expect(
      resolveMainAgentProfileName({ agent: { profile: 'core' } }, {}),
    ).toBe(SOVEREIGN_CORE_PROFILE_NAME);
    const profile = resolveMainAgentProfile(
      DEFAULT_AGENT_PROFILES,
      { agent: { profile: 'core' } },
      {},
    );
    expect(profile.tools).toHaveLength(12);
    expect(profile.tools).toEqual(expect.arrayContaining(['ApplyPatch', 'RepoQuery']));
    expect(profile.tools).not.toContain('UltraworkGraph');
    for (const legacy of [
      'LioraRead',
      'LioraTree',
      'LioraSymbol',
      'LioraCallgraph',
      'LioraExpand',
      'LioraReview',
    ]) {
      expect(profile.tools).not.toContain(legacy);
    }
  });

  it('throws for unknown profile names', () => {
    expect(() =>
      resolveMainAgentProfile(DEFAULT_AGENT_PROFILES, { agent: { profile: 'missing' } }, {}),
    ).toThrow(/Agent profile "missing" was not found/);
  });
});
