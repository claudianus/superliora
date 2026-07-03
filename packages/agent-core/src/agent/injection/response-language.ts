import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context';
import { DynamicInjector } from './injector';

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
    if (
      this.injectedAt !== null &&
      this.lastInjectedKey === key &&
      !this.hasRealUserPromptSinceInjection()
    ) {
      return undefined;
    }

    this.lastInjectedKey = key;
    return [
      '<response_language>',
      `Preferred response language: ${preference.label} (${preference.code}).`,
      `Write user-facing prose in ${preference.label}. Keep code, commands, file paths, identifiers, API names, quoted source text, and tool arguments in their original language. If the latest user message explicitly asks for another response language, follow that latest explicit request.`,
      '</response_language>',
    ].join('\n');
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
}
