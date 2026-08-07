import { DynamicInjector } from './injector';

const ASK_MODE_REFRESH_TURNS = 6;

export class AskModeInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'ask_mode';
  private wasActive = false;

  override onContextClear(): void {
    super.onContextClear();
    this.wasActive = this.agent.askMode.isActive;
  }

  override async getInjection(): Promise<string | undefined> {
    const isActive = this.agent.askMode.isActive;
    if (!isActive) {
      if (!this.wasActive) return undefined;
      this.wasActive = false;
      this.injectedAt = null;
      return EXIT_REMINDER;
    }
    if (!this.wasActive) {
      this.wasActive = true;
      this.injectedAt = null;
      return ASK_MODE_REMINDER;
    }
    if (this.injectedAt !== null && this.assistantTurnsSinceInjection() < ASK_MODE_REFRESH_TURNS) {
      return undefined;
    }
    return ASK_MODE_REMINDER;
  }

  private assistantTurnsSinceInjection(): number {
    if (this.injectedAt === null) return Number.POSITIVE_INFINITY;
    const history = this.agent.context.history;
    let turns = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      if (history[i]?.role === 'assistant') turns++;
    }
    return turns;
  }
}

const ASK_MODE_REMINDER = [
  'Ask mode is active.',
  '',
  'The user is deciding what to do, not asking for it to be done. Investigate and answer:',
  '- Read files, search the codebase, and look things up on the web.',
  '- Say what you found, what the options are, and what you would recommend.',
  '- When you are unsure, say so and name what would settle it.',
  '',
  'You cannot edit files, run commands that change anything, delegate to workers or subagents, queue jobs, or create goals — those calls are denied. Do not plan around the denial or ask for permission; answer with what reading and searching can establish. The user leaves ask mode when they want the work done.',
].join('\n');

const EXIT_REMINDER =
  'Ask mode is off. Edits, commands, and delegation are available again — proceed with the work.';
