import { isRealUserPromptOrigin, type ContextMessage } from '../context/types';
import { buildCurrentTimeReminder, formatCurrentTimeSnapshot } from '../../utils/current-time';

import { DynamicInjector } from './injector';

export class CurrentTimeInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'current_time';
  private lastInjectedUserMessageAt: number | null = null;

  override onContextClear(): void {
    super.onContextClear();
    this.lastInjectedUserMessageAt = null;
  }

  override onContextCompacted(compactedCount: number): void {
    super.onContextCompacted(compactedCount);
    this.lastInjectedUserMessageAt = null;
  }

  override onContextMessageRemoved(index: number): void {
    super.onContextMessageRemoved(index);
    if (this.lastInjectedUserMessageAt === null) return;
    if (index < this.lastInjectedUserMessageAt) {
      this.lastInjectedUserMessageAt -= 1;
    } else if (index === this.lastInjectedUserMessageAt) {
      this.lastInjectedUserMessageAt = null;
    }
  }

  protected override getInjection(): string | undefined {
    const latest = latestUserPrompt(this.agent.context.history);
    if (latest === undefined) return undefined;
    if (latest.index === this.lastInjectedUserMessageAt) return undefined;
    this.lastInjectedUserMessageAt = latest.index;
    return buildCurrentTimeReminder(formatCurrentTimeSnapshot());
  }
}

function latestUserPrompt(
  history: readonly ContextMessage[],
): { readonly index: number } | undefined {
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
    if (text.length > 0) return { index };
  }
  return undefined;
}
