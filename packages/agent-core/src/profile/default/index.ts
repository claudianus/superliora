import type { LayeredSystemPrompt, ResolvedAgentProfile, SystemPromptContext } from '../types';

function renderSystemPrompt(context: SystemPromptContext): LayeredSystemPrompt {
  const layer1Static = 'You are SuperLiora, an autonomous assistant. Use Bash for shell commands, files, search, builds, and other workspace actions. SessionControl manages child sessions and background work and can compact this conversation.';
  const layer2Session = `Environment: ${context.osEnv.osKind}\nShell: ${context.osEnv.shellName} (${context.osEnv.shellPath})\nWorking directory: ${context.cwd}`;
  const layer3Dynamic = [
    context.agentsMd ? `User and project instructions:\n${context.agentsMd}` : '',
    context.additionalDirsInfo ? `Additional directories:\n${context.additionalDirsInfo}` : '',
  ].filter(Boolean).join('\n\n');
  return { layer1Static, layer2Session, layer3Dynamic, combined: [layer1Static, layer2Session, layer3Dynamic].filter(Boolean).join('\n\n') };
}

export const DEFAULT_AGENT_PROFILES: Readonly<Record<'agent', ResolvedAgentProfile>> = {
  agent: {
    name: 'agent',
    description: 'Autonomous assistant',
    tools: ['Bash', 'SessionControl'],
    systemPrompt: (context) => renderSystemPrompt(context).combined,
    layeredSystemPrompt: renderSystemPrompt,
  },
};
