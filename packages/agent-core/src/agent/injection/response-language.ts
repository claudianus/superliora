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
const RESPONSE_LANGUAGE_REFRESH_ASSISTANT_TURNS = 2;

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

const USER_FACING_ARTIFACTS = [
  'answers and preambles',
  'status updates and summaries',
  'plan files and every plan section',
  'wiki / project docs',
  'AskUserQuestion tool calls — question text, headers, option labels, and option descriptions',
  'interview and clarification questions',
  'todo items and confirmations',
  'user-visible errors and warnings',
].join('; ');

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
    `MANDATORY response language LOCKED: ${preference.label} (${preference.code}). This lock NEVER lapses — not in long chats, after compaction, tool-heavy runs, or foreign-language code context.`,
    `Write ALL user-facing text in ${preference.label}: ${USER_FACING_ARTIFACTS}.`,
    'Keep code, shell commands, file paths, identifiers, APIs, quoted source text, and tool argument values in their original language.',
    `Do NOT drift to any other natural language. A later explicit user override may change this; until then every user-visible artifact stays in ${preference.label}.`,
    `Before calling AskUserQuestion or writing plan/wiki content, verify the text is in ${preference.label}; rewrite if not.`,
    `If system reminders are in another language, still produce every user-visible artifact in ${preference.label}.`,
  ].join('\n');
  if (options.wrapped === false) return body;
  return `<response_language>\n${body}\n</response_language>`;
}
