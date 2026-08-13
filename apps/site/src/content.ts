/** Product facts for the public landing. Tests import this module — do not duplicate. */

export const INSTALL_SH =
  'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash';

export const INSTALL_PS =
  'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex';

export const NODE_REQUIREMENT = 'Node.js ≥ 24.15.0';

export const LANDING_SECTION_IDS = ['features', 'usage', 'workflow', 'install'] as const;
export type LandingSectionId = (typeof LANDING_SECTION_IDS)[number];

export const USAGE_COMMANDS = [
  { id: 'liora', cmd: 'liora' },
  { id: 'continue', cmd: 'liora --continue' },
  { id: 'plan', cmd: 'liora --plan' },
  { id: 'login', cmd: '/login' },
  { id: 'model', cmd: '/model' },
] as const;

export type UsageCommandId = (typeof USAGE_COMMANDS)[number]['id'];

export const WORKFLOW_STEP_IDS = ['write', 'job', 'inbox', 'land'] as const;
export type WorkflowStepId = (typeof WORKFLOW_STEP_IDS)[number];

export const WORKFLOW_KEYS = {
  jobDeck: 'Alt+J',
  inbox: 'Alt+I',
} as const;
