import type { Message } from '@superliora/kosong';
import { APIEmptyResponseError, APIStatusError, ChatProviderError } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  buildEmergencyBackstopSummary,
  shouldUseClassicalCompactionFallback,
} from '../../../src/agent/compaction/backstop';
import { LioraError, ErrorCodes } from '../../../src/errors';

function statusError(status: number, message = 'status error'): APIStatusError {
  return new APIStatusError({ statusCode: status, message });
}

function chatProviderError(): ChatProviderError {
  return new ChatProviderError('chat provider failed', 'provider.chat_error');
}

describe('shouldUseClassicalCompactionFallback', () => {
  // The classical fallback runs when the LLM summarizer fails so the agent
  // can still resume. Pin every branch so a future rewrite does not silently
  // drop a category and strand a long session without a summary.

  it('returns false for abort errors', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(shouldUseClassicalCompactionFallback(err)).toBe(false);
  });

  it('returns false for AUTH_LOGIN_REQUIRED so the user is prompted', () => {
    const err = new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, 'login required');
    expect(shouldUseClassicalCompactionFallback(err)).toBe(false);
  });

  it('returns true for APIEmptyResponseError', () => {
    const err = new APIEmptyResponseError({ message: 'empty' });
    expect(shouldUseClassicalCompactionFallback(err)).toBe(true);
  });

  it('returns true for 4xx / 5xx APIStatusError', () => {
    expect(shouldUseClassicalCompactionFallback(statusError(400))).toBe(true);
    expect(shouldUseClassicalCompactionFallback(statusError(429))).toBe(true);
    expect(shouldUseClassicalCompactionFallback(statusError(500))).toBe(true);
  });

  it('returns true for ChatProviderError', () => {
    expect(shouldUseClassicalCompactionFallback(chatProviderError())).toBe(true);
  });

  it('returns true when the message matches known provider signals', () => {
    expect(
      shouldUseClassicalCompactionFallback(
        new Error('does not support parameter `reasoning_effort`'),
      ),
    ).toBe(true);
    expect(
      shouldUseClassicalCompactionFallback(new Error('invalid_request: 400')),
    ).toBe(true);
    expect(
      shouldUseClassicalCompactionFallback(new Error('context overflow')),
    ).toBe(true);
    expect(
      shouldUseClassicalCompactionFallback(new Error('response truncated')),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(shouldUseClassicalCompactionFallback(new Error('boom'))).toBe(false);
    expect(shouldUseClassicalCompactionFallback(undefined)).toBe(false);
    expect(shouldUseClassicalCompactionFallback(null)).toBe(false);
  });
});

describe('buildEmergencyBackstopSummary', () => {
  it('mentions the latest user prompt and the emergency backstop marker', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'ship the auth flow' }],
        toolCalls: [],
      } as unknown as Message,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'working on it' }],
        toolCalls: [],
      } as unknown as Message,
    ];
    const plan = { compactedTokens: 1234, rawRefs: [] } as never;
    const summary = buildEmergencyBackstopSummary(messages, plan);
    expect(summary).toContain('ship the auth flow');
    expect(summary).toContain('Emergency extractive backstop');
    expect(summary).toContain('1234');
  });

  it('falls back to a default line when no user prompt is present', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'thinking' }],
        toolCalls: [],
      } as unknown as Message,
    ];
    const plan = { compactedTokens: 100, rawRefs: [] } as never;
    const summary = buildEmergencyBackstopSummary(messages, plan);
    expect(summary).toContain('Continue the active task');
  });
});
