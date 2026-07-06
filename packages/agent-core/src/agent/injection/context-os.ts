import { isRealUserPromptOrigin, type ContextMessage } from '../context/types';

import { DynamicInjector } from './injector';

export class ContextOSInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'context_os';
  private lastAttemptSignature: string | null = null;

  override onContextClear(): void {
    super.onContextClear();
    this.lastAttemptSignature = null;
  }

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    const latest = latestUserPrompt(this.agent.context.history);
    if (latest === undefined) return undefined;
    const trailing = this.agent.context.history.slice(latest.index + 1);
    if (
      trailing.some(
        (message) => message.role !== 'user' || message.origin?.kind !== 'injection',
      )
    ) {
      return undefined;
    }
    const signature = `${String(latest.index)}:${String(this.agent.contextOS.revision)}`;
    if (signature === this.lastAttemptSignature) return undefined;
    this.lastAttemptSignature = signature;
    return this.agent.contextOS.buildInjection(latest.text);
  }
}

function latestUserPrompt(
  history: readonly ContextMessage[],
): { readonly index: number; readonly text: string } | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message === undefined) continue;
    if (message.role !== 'user') continue;
    if (!isRealUserPromptOrigin(message.origin)) continue;
    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter((partText) => partText.trim().length > 0)
      .join('\n')
      .trim();
    if (text.length > 0) return { index, text };
  }
  return undefined;
}
