import { ErrorCodes, LioraError, type LioraErrorCode } from '@superliora/agent-core';

import type { PermissionMode, PromptInput, ResumedSessionState, SessionSummary } from '#/types';

export function normalizePromptInput(input: string | PromptInput): PromptInput {
  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      throw new LioraError(ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY, 'Prompt input cannot be empty');
    }
    return [{ type: 'text', text: input }];
  }

  if (input.length === 0) {
    throw new LioraError(ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY, 'Prompt input cannot be empty');
  }

  for (const part of input) {
    switch (part.type) {
      case 'text':
        if (part.text.trim().length === 0) {
          throw new LioraError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty text parts',
          );
        }
        break;
      case 'image_url':
        if (part.imageUrl.url.trim().length === 0) {
          throw new LioraError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty image URLs',
          );
        }
        break;
      case 'video_url':
        if (part.videoUrl.url.trim().length === 0) {
          throw new LioraError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty video URLs',
          );
        }
        break;
    }
  }
  return input;
}

export function normalizeRequiredString(
  value: string,
  message: string,
  code: LioraErrorCode,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new LioraError(code, message);
  }
  return normalized;
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'yolo' || value === 'manual' || value === 'auto';
}

const KNOWN_THINKING_LEVELS = new Set(['off', 'on', 'low', 'medium', 'high', 'xhigh', 'max']);

export function isKnownThinkingLevel(value: string): boolean {
  return KNOWN_THINKING_LEVELS.has(value.toLowerCase());
}

export function resumeStateFromSummary(
  summary: SessionSummary | undefined,
): ResumedSessionState | undefined {
  if (!hasResumeState(summary)) return undefined;
  return {
    sessionMetadata: summary.sessionMetadata,
    agents: summary.agents,
    warning: summary.warning,
  };
}

function hasResumeState(
  summary: SessionSummary | undefined,
): summary is SessionSummary & ResumedSessionState {
  return (
    summary !== undefined &&
    typeof (summary as { readonly sessionMetadata?: unknown }).sessionMetadata === 'object' &&
    (summary as { readonly sessionMetadata?: unknown }).sessionMetadata !== null &&
    typeof (summary as { readonly agents?: unknown }).agents === 'object' &&
    (summary as { readonly agents?: unknown }).agents !== null
  );
}
