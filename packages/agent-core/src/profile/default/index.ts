import agentYaml from './agent.yaml?raw';
import coderYaml from './coder.yaml?raw';
import exploreYaml from './explore.yaml?raw';
import fullYaml from './full.yaml?raw';
import initMd from './init.md?raw';
import planYaml from './plan.yaml?raw';
import systemMd from './system.md?raw';
import ultraPlanYaml from './ultra-plan.yaml?raw';
import { loadAgentProfilesFromSources } from '../load';

// Keyed by the source path the profile loader expects: profile YAML files
// plus any file referenced through `systemPromptPath`.
const PROFILE_SOURCES: Record<string, string> = {
  'profile/default/agent.yaml': agentYaml,
  'profile/default/coder.yaml': coderYaml,
  'profile/default/explore.yaml': exploreYaml,
  'profile/default/full.yaml': fullYaml,
  'profile/default/plan.yaml': planYaml,
  'profile/default/ultra-plan.yaml': ultraPlanYaml,
  'profile/default/system.md': systemMd,
};

export const DEFAULT_INIT_PROMPT = initMd;

export const DEFAULT_AGENT_PROFILES = loadAgentProfilesFromSources(
  ['agent.yaml', 'coder.yaml', 'explore.yaml', 'full.yaml', 'plan.yaml', 'ultra-plan.yaml'].map(
    (file) => `profile/default/${file}`,
  ),
  PROFILE_SOURCES,
);
