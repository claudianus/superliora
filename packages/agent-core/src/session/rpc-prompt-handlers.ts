import type { ConversationLoopState } from '../agent/conversation-loop';
import type { ConversationLoopStateData } from '#/rpc';
import { titleFromPromptMetadataText } from './prompt-metadata';
import type { Session, SessionMeta } from '.';
import { truncateLastPrompt } from './session-meta-format';

export function toConversationLoopStateData(state: ConversationLoopState): ConversationLoopStateData {
  return {
    id: state.id,
    prompt: state.config.prompt,
    intervalMs: state.config.intervalMs,
    maxIterations: state.config.maxIterations,
    expiresAt: state.config.expiresAt,
    status: state.status,
    iterations: state.iterations,
    createdAt: state.createdAt,
    lastFiredAt: state.lastFiredAt,
    stopReason: state.stopReason,
  };
}


export function isUntitled(title: unknown): boolean {
  return typeof title !== 'string' || title.trim().length === 0 || title === 'New Session';
}

export function hasCustomTitle(metadata: SessionMeta): boolean {
  if (metadata.isCustomTitle) return true;
  return typeof (metadata as SessionMeta & { customTitle?: unknown }).customTitle === 'string';
}

export function needUpdateEasyTitle(metadata: SessionMeta): boolean {
  if (hasCustomTitle(metadata)) return false;
  if (!isUntitled(metadata.title)) return false;
  return true;
}

export async function updatePromptMetadata(
  session: Session,
  lastPrompt: string | undefined,
): Promise<void> {
  if (lastPrompt === undefined) return;

  const storedPrompt = truncateLastPrompt(lastPrompt);
  const title = needUpdateEasyTitle(session.metadata)
    ? titleFromPromptMetadataText(storedPrompt)
    : undefined;
  const now = new Date().toISOString();
  const nextMetadata = {
    ...session.metadata,
    lastPrompt: storedPrompt,
    updatedAt: now,
  };
  if (title !== undefined) {
    nextMetadata.title = title;
    nextMetadata.isCustomTitle = false;
  }

  session.metadata = nextMetadata;
  await session.writeMetadata();
  await session.rpc.emitEvent({
    type: 'session.meta.updated',
    agentId: 'main',
    title,
    patch: {
      title,
      isCustomTitle: title === undefined ? undefined : false,
      lastPrompt: storedPrompt,
    },
  });
}

