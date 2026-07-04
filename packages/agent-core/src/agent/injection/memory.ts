import { isRealUserPromptOrigin, type ContextMessage } from '../context/types';

import { DynamicInjector } from './injector';

export class MemoryInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'liora_recall';
  private lastAttemptedUserMessageAt: number | null = null;

  override onContextClear(): void {
    super.onContextClear();
    this.lastAttemptedUserMessageAt = null;
  }

  override onContextCompacted(compactedCount: number): void {
    super.onContextCompacted(compactedCount);
    if (this.lastAttemptedUserMessageAt !== null) {
      const next = this.lastAttemptedUserMessageAt - compactedCount + 1;
      this.lastAttemptedUserMessageAt = next >= 0 ? next : null;
    }
  }

  override onContextMessageRemoved(index: number): void {
    super.onContextMessageRemoved(index);
    if (this.lastAttemptedUserMessageAt === null) return;
    if (index < this.lastAttemptedUserMessageAt) {
      this.lastAttemptedUserMessageAt -= 1;
    } else if (index === this.lastAttemptedUserMessageAt) {
      this.lastAttemptedUserMessageAt = null;
    }
  }

  protected override async getInjection(): Promise<string | undefined> {
    if (this.agent.type !== 'main') return undefined;
    const memory = this.agent.memory;
    if (memory === undefined || !memory.isEnabled()) return undefined;
    const latest = latestUserPrompt(this.agent.context.history);
    if (latest === undefined) return undefined;
    if (latest.index === this.lastAttemptedUserMessageAt) return undefined;
    this.lastAttemptedUserMessageAt = latest.index;
    return memory.getInjection(latest.text);
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
