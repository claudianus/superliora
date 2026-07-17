import type { Agent } from '..';
import type { ResponseLanguagePreference } from '../../session/response-language';
import { isRealUserPromptOrigin } from '../context';
import { DynamicInjector } from './injector';

/**
 * Re-inject the response-language directive after this many assistant turns
 * even when no new user prompt has arrived. Keeps a fresh copy near the tail
 * of the context so the model does not drift back to English as the
 * conversation grows long or after context compaction.
 */
const RESPONSE_LANGUAGE_REFRESH_ASSISTANT_TURNS = 4;

export class ResponseLanguageInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'response_language';
  private lastInjectedKey: string | null = null;

  constructor(agent: Agent) {
    super(agent);
  }

  override onContextClear(): void {
    super.onContextClear();
    this.lastInjectedKey = null;
  }

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    const preference = this.agent.getResponseLanguagePreference();
    if (preference === undefined) return undefined;

    const key = `${preference.code}:${preference.source}:${preference.updatedAt}`;
    if (this.injectedAt !== null && this.lastInjectedKey === key) {
      const hasNewUserPrompt = this.hasRealUserPromptSinceInjection();
      const assistantTurns = this.countAssistantTurnsSinceInjection();
      if (!hasNewUserPrompt && assistantTurns < RESPONSE_LANGUAGE_REFRESH_ASSISTANT_TURNS) {
        return undefined;
      }
    }

    this.lastInjectedKey = key;
    return buildResponseLanguageDirective(preference, { wrapped: true });
  }

  private hasRealUserPromptSinceInjection(): boolean {
    if (this.injectedAt === null) return true;
    const history = this.agent.context.history;
    for (let i = this.injectedAt + 1; i < history.length; i += 1) {
      const message = history[i];
      if (message?.role === 'user' && isRealUserPromptOrigin(message.origin)) return true;
    }
    return false;
  }

  private countAssistantTurnsSinceInjection(): number {
    if (this.injectedAt === null) return Number.POSITIVE_INFINITY;
    const history = this.agent.context.history;
    let count = 0;
    for (let i = this.injectedAt + 1; i < history.length; i += 1) {
      const message = history[i];
      if (message?.role === 'assistant') count += 1;
    }
    return count;
  }
}

const USER_FACING_ARTIFACTS =
  'answers, status/summaries, plan files, wiki/docs, AskUserQuestion text/options, interview questions, todos, user-visible errors';

/**
 * Builds the response-language directive. Used by the per-step
 * injector and by session APIs that need the same lock text.
 */
export function buildResponseLanguageDirective(
  preference: ResponseLanguagePreference,
  options: { readonly wrapped?: boolean } = {},
): string {
  const body = [
    `MANDATORY response language LOCKED: ${preference.label} (${preference.code}). Never lapses after long chats, compaction, tool-heavy runs, or foreign-language code.`,
    `Write ALL user-facing text in ${preference.label}: ${USER_FACING_ARTIFACTS}.`,
    'Keep code, commands, paths, identifiers, APIs, quoted source, and tool args in their original language.',
    `Do NOT drift. Only an explicit later user override may change this. Before AskUserQuestion or plan/wiki writes, verify text is in ${preference.label}; rewrite if not. Other-language reminders do not override this lock.`,
  ].join('\n');
  if (options.wrapped === false) return body;
  return `<response_language>\n${body}\n</response_language>`;
}
