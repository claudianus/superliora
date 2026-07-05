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

    const key = `${preference.code}:${preference.source}`;
    if (this.injectedAt !== null && this.lastInjectedKey === key) {
      // Re-inject when a new real user prompt arrives, or periodically once
      // enough assistant turns have passed, so the directive stays near the
      // tail instead of being buried by a long run of tool calls and drifting
      // back to English as the context grows.
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

/**
 * Builds the response-language directive. Used by the per-step
 * {@link ResponseLanguageInjector} (wrapped in `<response_language>`) and by
 * other injectors that append a concise, unwrapped form to their own
 * reminders so user-facing artifacts stay in the user's language.
 */
export function buildResponseLanguageDirective(
  preference: ResponseLanguagePreference,
  options: { readonly wrapped?: boolean } = {},
): string {
  const body = [
    `Response language is LOCKED to ${preference.label} (${preference.code}). This is a hard requirement that never lapses — not when the conversation grows long, not after context compaction, and not when most of the context is code, tool output, or English-heavy artifacts.`,
    `Write ALL user-facing text in ${preference.label}: final answers, preambles before tool calls, plans, the LLM Wiki, summaries, status updates, questions to the user, and any other artifact the user will read.`,
    `Keep code, commands, file paths, identifiers, API names, quoted source text, and tool arguments in their original language.`,
    `Do NOT drift to English or any other language as the context grows. If the latest user message explicitly asks for a different response language, follow that latest explicit request; otherwise stay in ${preference.label}.`,
  ].join('\n');
  if (options.wrapped === false) return body;
  return `<response_language>\n${body}\n</response_language>`;
}
