import type { SlashCommandHost } from './dispatch';

/**
 * /improve-harness command — lets the agent analyze and improve its own harness.
 *
 * This command triggers a self-improvement loop where the agent:
 * 1. Analyzes the current harness code structure
 * 2. Identifies areas for improvement (performance, UX, reliability)
 * 3. Proposes and implements improvements
 * 4. Validates the improvements with tests
 *
 * Usage:
 *   /improve-harness              - Start interactive improvement session
 *   /improve-harness <area>       - Focus on a specific area (e.g., "tui", "tools", "performance")
 *   /improve-harness --auto       - Run autonomous improvement loop
 */

export interface ImproveHarnessOptions {
  readonly area?: string;
  readonly auto?: boolean;
}

export function parseImproveHarnessCommand(rawArgs: string): ImproveHarnessOptions {
  const args = rawArgs.trim();
  if (args.length === 0) return {};

  const tokens = args.split(/\s+/);
  const options: ImproveHarnessOptions = {};

  for (const token of tokens) {
    if (token === '--auto') {
      options.auto = true;
    } else if (!token.startsWith('-')) {
      options.area = token;
    }
  }

  return options;
}

const IMPROVEMENT_AREAS = [
  'tui',
  'tools',
  'performance',
  'reliability',
  'ux',
  'docs',
  'tests',
] as const;

type ImprovementArea = (typeof IMPROVEMENT_AREAS)[number];

function isImprovementArea(value: string): value is ImprovementArea {
  return (IMPROVEMENT_AREAS as readonly string[]).includes(value);
}

export async function handleImproveHarnessCommand(
  host: Pick<SlashCommandHost, 'state' | 'session' | 'requireSession' | 'showError' | 'showStatus' | 'sendNormalUserInput'>,
  rawArgs: string,
): Promise<void> {
  const session = host.requireSession();
  if (!session) return;

  const options = parseImproveHarnessCommand(rawArgs);

  // Validate area if specified
  if (options.area && !isImprovementArea(options.area)) {
    host.showError(
      `Unknown improvement area: ${options.area}\n` +
      `Available areas: ${IMPROVEMENT_AREAS.join(', ')}`,
    );
    return;
  }

  const area = options.area ?? 'general';
  const autoMode = options.auto ?? false;

  // Build the improvement prompt
  const prompt = buildImprovementPrompt(area, autoMode);

  host.showStatus(`🔧 Starting harness improvement session (${area})...`);

  // Send the prompt to the agent
  host.sendNormalUserInput(prompt, {
    displayText: `/improve-harness ${area}${autoMode ? ' --auto' : ''}`,
  });
}

function buildImprovementPrompt(area: string, autoMode: boolean): string {
  const basePrompt = `You are now in harness self-improvement mode. Your task is to analyze and improve the SuperLiora harness codebase.

Focus area: ${area}

Instructions:
1. Analyze the current implementation in the focus area
2. Identify specific improvements (performance, reliability, UX, code quality)
3. Implement the improvements with minimal, focused changes
4. Run tests to validate the improvements
5. Commit the changes with clear commit messages

Constraints:
- Keep changes minimal and focused
- Do not break existing functionality
- Follow the existing code style and patterns
- Update tests if needed
- Do not modify AGENTS.md unless the instructions themselves need to change

`;

  if (autoMode) {
    return basePrompt + `
Autonomous mode: Continue improving until you have made 3-5 meaningful improvements or encounter a blocker. Use the goal system to track your progress.

Start by creating a goal with CreateGoal, then proceed with the improvements.`;
  }

  return basePrompt + `
Interactive mode: Make one improvement at a time and explain your changes. Wait for user feedback before proceeding to the next improvement.

Start by analyzing the codebase and proposing your first improvement.`;
}
