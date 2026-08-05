import coreYaml from './core.yaml?raw';
import conductorYaml from './conductor.yaml?raw';
import agentYaml from './agent.yaml?raw';
import coderYaml from './coder.yaml?raw';
import exploreYaml from './explore.yaml?raw';
import fullYaml from './full.yaml?raw';
import goalDriverYaml from './goal-driver.yaml?raw';
import initMd from './init.md?raw';
import planYaml from './plan.yaml?raw';
import subagentBaseYaml from './subagent-base.yaml?raw';
import systemMd from './system.md?raw';
import ultraPlanYaml from './ultra-plan.yaml?raw';
import { loadAgentProfilesFromSources } from '../load';

// Keyed by the source path the profile loader expects: profile YAML files
// plus any file referenced through `systemPromptPath`.
const PROFILE_SOURCES: Record<string, string> = {
  'profile/default/core.yaml': coreYaml,
  'profile/default/conductor.yaml': conductorYaml,
  'profile/default/agent.yaml': agentYaml,
  'profile/default/coder.yaml': coderYaml,
  'profile/default/explore.yaml': exploreYaml,
  'profile/default/full.yaml': fullYaml,
  'profile/default/goal-driver.yaml': goalDriverYaml,
  'profile/default/plan.yaml': planYaml,
  'profile/default/subagent-base.yaml': subagentBaseYaml,
  'profile/default/ultra-plan.yaml': ultraPlanYaml,
  'profile/default/system.md': systemMd,
};

export const DEFAULT_INIT_PROMPT = initMd;

/**
 * Sovereign Core waist (Core≤12 SSOT) — recommended default.
 * Opt-in: `SUPERLIORA_PROFILE=core`, `agent.profile = "core"`, `SUPERLIORA_SOVEREIGN_CORE=1`, or `SUPERLIORA_SOVEREIGN=1`.
 */
export const SOVEREIGN_CORE_WAIST_PROFILE = 'core';

export const DEFAULT_AGENT_PROFILES = loadAgentProfilesFromSources(
  ['core.yaml', 'conductor.yaml', 'agent.yaml', 'subagent-base.yaml', 'coder.yaml', 'explore.yaml', 'full.yaml', 'goal-driver.yaml', 'plan.yaml', 'ultra-plan.yaml'].map(
    (file) => `profile/default/${file}`,
  ),
  PROFILE_SOURCES,
);
