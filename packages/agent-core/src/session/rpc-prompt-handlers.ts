import type { PromptPayload } from '#/rpc';
import type { ConversationLoopState } from '../agent/conversation-loop';
import type { ConversationLoopStateData } from '#/rpc';
import { maybeTransformPromptForInterruptedWorkResume } from '#/mission';
import { sessionMediaOriginalsDir } from '../tools/support/image-originals';
import {
  DEFAULT_NON_VISION_FALLBACK,
  isVisionMediaPart,
  transformMediaForNonVisionModel,
  type NonVisionFallbackPolicy,
} from './vision-analyzer';
import {
  promptMetadataTextFromPayload,
  titleFromPromptMetadataText,
} from './prompt-metadata';
import {
  resolveResponseLanguagePreference,
  responseLanguagePreferenceFromUnknown,
} from './response-language';
import { detectResponseLanguageWithLlm } from './response-language-llm';
import type { Session, SessionMeta } from '.';

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

export function responseLanguagePreferencesEqual(
  a: ReturnType<typeof responseLanguagePreferenceFromUnknown>,
  b: ReturnType<typeof responseLanguagePreferenceFromUnknown>,
): boolean {
  return (
    a?.code === b?.code &&
    a?.source === b?.source &&
    a?.locked === b?.locked
  );
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

  const title = needUpdateEasyTitle(session.metadata)
    ? titleFromPromptMetadataText(lastPrompt)
    : undefined;
  const now = new Date().toISOString();
  const nextMetadata = {
    ...session.metadata,
    lastPrompt,
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
      lastPrompt,
    },
  });
}

export async function maybeResumeInterruptedWorkPrompt(
  session: Session,
  agentId: string,
  payload: PromptPayload,
): Promise<PromptPayload> {
  const transformed = await maybeResumeInterruptedWorkInput(session, agentId, payload.input);
  if (transformed === undefined) return payload;
  return { input: transformed };
}

export async function maybeResumeInterruptedWorkInput(
  session: Session,
  agentId: string,
  input: PromptPayload['input'],
): Promise<PromptPayload['input'] | undefined> {
  const text = promptMetadataTextFromPayload({ input });
  if (text === undefined) return undefined;
  const agent = await session.ensureAgentResumed(agentId);
  const resumed = await maybeTransformPromptForInterruptedWorkResume(agent, text, {
    signal: AbortSignal.timeout(8_000),
  });
  if (resumed === undefined) return undefined;
  return [{ type: 'text', text: resumed.promptText }];
}

/**
 * Vision analyzer fallback: when the target agent's current model cannot
 * consume attached media, replace media parts with analyzer text (policy
 * 'analyze') or path-only notes ('path'). 'block' is enforced by clients
 * before submission. Returns undefined when nothing was transformed.
 * Analyzer failures degrade to path notes — never block the prompt.
 */
export async function maybeTransformNonVisionMedia(
  session: Session,
  agentId: string,
  input: PromptPayload['input'],
): Promise<PromptPayload['input'] | undefined> {
  const providerManager = session.options.providerManager;
  if (providerManager === undefined) return undefined;
  if (!input.some(isVisionMediaPart)) return undefined;

  const policy: NonVisionFallbackPolicy =
    providerManager.currentConfig().media?.nonVisionFallback ?? DEFAULT_NON_VISION_FALLBACK;
  if (policy === 'block') return undefined;

  const agent = await session.ensureAgentResumed(agentId);
  const result = await transformMediaForNonVisionModel(
    {
      generate: agent.generate,
      providerManager,
      currentModelAlias: agent.config.modelAlias,
      currentCapabilities: agent.config.modelCapabilities,
    },
    input,
    { policy, originalsDir: sessionMediaOriginalsDir(session.options.homedir) },
  );
  if (result.analyzedCount === 0 && result.pathOnlyCount === 0) return undefined;
  if (result.analyzedCount > 0) {
    await session.rpc.emitEvent({
      type: 'warning',
      agentId,
      code: 'vision_analyzer.analyzed',
      message: `Analyzed ${result.analyzedCount} media attachment(s) with ${result.analyzerModels.join(', ')} because the current model is text-only.`,
      details: {
        analyzerModel: result.analyzerModels.join(', '),
        kind:
          result.analyzedKinds.length === 1
            ? (result.analyzedKinds[0] as string)
            : 'mixed',
        count: result.analyzedCount,
      },
    });
  }
  return result.parts;
}

export async function updateResponseLanguagePreference(
  session: Session,
  input: PromptPayload['input'],
): Promise<void> {
  const current = responseLanguagePreferenceFromUnknown(
    session.metadata.custom['responseLanguage'],
  );
  const mainAgent = await session.ensureAgentResumed('main');
  const next = await resolveResponseLanguagePreference(current, input, {
    env: process.env,
    detectWithLlm: async (text, currentPreference, hostLocale) => {
      const provider = mainAgent.config.provider;
      if (provider === undefined) return undefined;
      return detectResponseLanguageWithLlm(
        { generate: mainAgent.generate, provider },
        {
          text,
          current: currentPreference,
          hostLocale,
          signal: AbortSignal.timeout(8_000),
        },
      );
    },
  });
  if (next === current || responseLanguagePreferencesEqual(next, current)) return;

  session.metadata = {
    ...session.metadata,
    updatedAt: new Date().toISOString(),
    custom: {
      ...session.metadata.custom,
      responseLanguage: next,
    },
  };
  await session.writeMetadata();
}
