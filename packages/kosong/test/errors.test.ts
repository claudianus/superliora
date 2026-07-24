import {
  APIConnectionError,
  APIContextOverflowError,
  APIEmptyResponseError,
  APIProviderRateLimitError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
  isProviderRateLimitError,
  isRecoverableRequestStructureError,
  isRetryableGenerateError,
  isToolExchangeAdjacencyError,
  isTransientProviderError,
  normalizeAPIStatusError,
} from '#/errors';
import { describe, expect, it } from 'vitest';

describe('ChatProviderError', () => {
  it('is an instance of Error', () => {
    const err = new ChatProviderError('base error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err.message).toBe('base error');
    expect(err.name).toBe('ChatProviderError');
  });
});

describe('APIConnectionError', () => {
  it('extends ChatProviderError', () => {
    const err = new APIConnectionError('connection refused');
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('APIConnectionError');
    expect(err.message).toBe('connection refused');
  });
});

describe('APITimeoutError', () => {
  it('extends ChatProviderError', () => {
    const err = new APITimeoutError('request timed out after 30s');
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('APITimeoutError');
    expect(err.message).toBe('request timed out after 30s');
  });
});

describe('APIStatusError', () => {
  it('extends ChatProviderError and stores status code', () => {
    const err = new APIStatusError(429, 'rate limited', 'req-abc');
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('APIStatusError');
    expect(err.message).toBe('rate limited');
    expect(err.statusCode).toBe(429);
    expect(err.requestId).toBe('req-abc');
  });

  it('accepts null requestId', () => {
    const err = new APIStatusError(500, 'server error', null);
    expect(err.statusCode).toBe(500);
    expect(err.requestId).toBeNull();
  });

  it('defaults requestId to null when omitted', () => {
    const err = new APIStatusError(502, 'bad gateway');
    expect(err.statusCode).toBe(502);
    expect(err.requestId).toBeNull();
  });
});

describe('APIEmptyResponseError', () => {
  it('extends ChatProviderError', () => {
    const err = new APIEmptyResponseError('empty response');
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('APIEmptyResponseError');
    expect(err.message).toBe('empty response');
    expect(err.finishReason).toBeNull();
    expect(err.rawFinishReason).toBeNull();
  });

  it('preserves provider finish reason details', () => {
    const err = new APIEmptyResponseError('empty response', {
      finishReason: 'filtered',
      rawFinishReason: 'content_filter',
    });

    expect(err.finishReason).toBe('filtered');
    expect(err.rawFinishReason).toBe('content_filter');
  });
});

describe('APIContextOverflowError', () => {
  it('extends APIStatusError and preserves HTTP details', () => {
    const err = new APIContextOverflowError(400, 'Context length exceeded', 'req-context');
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err.name).toBe('APIContextOverflowError');
    expect(err.statusCode).toBe(400);
    expect(err.requestId).toBe('req-context');
  });
});

describe('APIProviderRateLimitError', () => {
  it('extends APIStatusError and preserves HTTP details', () => {
    const err = new APIProviderRateLimitError('Rate limited', 'req-rate');
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err.name).toBe('APIProviderRateLimitError');
    expect(err.statusCode).toBe(429);
    expect(err.requestId).toBe('req-rate');
  });
});

describe('isRetryableGenerateError', () => {
  it('matches transient provider errors and empty generate responses', () => {
    expect(isRetryableGenerateError(new APIConnectionError('conn'))).toBe(true);
    expect(isRetryableGenerateError(new APITimeoutError('timeout'))).toBe(true);
    expect(isRetryableGenerateError(new APIEmptyResponseError('empty'))).toBe(true);
  });

  it.each([429, 500, 502, 503, 504])('treats HTTP %i as retryable', (statusCode) => {
    expect(isRetryableGenerateError(new APIStatusError(statusCode, 'retryable'))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats HTTP %i as non-retryable', (statusCode) => {
    expect(isRetryableGenerateError(new APIStatusError(statusCode, 'non-retryable'))).toBe(false);
  });

  it('does not retry context overflow or unknown errors', () => {
    expect(
      isRetryableGenerateError(new APIContextOverflowError(400, 'Context length exceeded')),
    ).toBe(false);
    expect(isRetryableGenerateError(new Error('boom'))).toBe(false);
    expect(isRetryableGenerateError('boom')).toBe(false);
  });
});

describe('error hierarchy instanceof checks', () => {
  it('all error types are instanceof ChatProviderError', () => {
    const errors = [
      new APIConnectionError('conn'),
      new APITimeoutError('timeout'),
      new APIStatusError(400, 'status', null),
      new APIContextOverflowError(400, 'context length exceeded'),
      new APIEmptyResponseError('empty'),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(ChatProviderError);
    }
  });

  it('specific types are distinguishable', () => {
    const connErr = new APIConnectionError('conn');
    const statusErr = new APIStatusError(400, 'status', null);

    expect(connErr).not.toBeInstanceOf(APIStatusError);
    expect(statusErr).not.toBeInstanceOf(APIConnectionError);
  });

  it('can catch with ChatProviderError and inspect subtype', () => {
    const err: ChatProviderError = new APIStatusError(404, 'not found', 'req-123');

    if (err instanceof APIStatusError) {
      expect(err.statusCode).toBe(404);
      expect(err.requestId).toBe('req-123');
    } else {
      expect.unreachable('Expected APIStatusError');
    }
  });
});

describe('normalizeAPIStatusError', () => {
  it('normalizes HTTP 429 to APIProviderRateLimitError', () => {
    const error = normalizeAPIStatusError(429, 'Too many requests', 'req-rate');
    expect(error).toBeInstanceOf(APIProviderRateLimitError);
    expect(error.statusCode).toBe(429);
    expect(error.requestId).toBe('req-rate');
  });

  it.each([
    [400, 'Context length exceeded'],
    [400, 'Exceeded max tokens'],
    [413, 'Context length exceeded'],
    [422, 'Maximum context window exceeded'],
    [400, 'context_length_exceeded'],
    [422, 'Too many tokens in prompt'],
    [400, 'prompt is too long: 210000 tokens exceeds the maximum'],
    [400, 'input token count 131072 exceeds the maximum number of tokens allowed'],
    [400, 'Invalid request: Your request exceeded model token limit: 262144 (requested: 274613)'],
  ])('normalizes %i "%s" to APIContextOverflowError', (statusCode, message) => {
    const error = normalizeAPIStatusError(statusCode, message, 'req-context');
    expect(error).toBeInstanceOf(APIContextOverflowError);
    expect(error.statusCode).toBe(statusCode);
    expect(error.requestId).toBe('req-context');
  });

  it.each([
    [401, 'Context length exceeded'],
    [500, 'Context length exceeded'],
    [400, 'Bad request'],
    [422, 'Invalid tool schema'],
    [400, 'max_tokens must be less than or equal to 4096'],
    [422, 'max_output_tokens must not exceed 8192'],
    [400, 'max tokens must not exceed the configured output limit'],
  ])('keeps %i "%s" as APIStatusError', (statusCode, message) => {
    const error = normalizeAPIStatusError(statusCode, message);
    expect(error).toBeInstanceOf(APIStatusError);
    expect(error).not.toBeInstanceOf(APIContextOverflowError);
  });
});

describe('isToolExchangeAdjacencyError', () => {
  it('matches missing and unexpected tool_result structural errors', () => {
    expect(
      isToolExchangeAdjacencyError(
        new APIStatusError(
          400,
          '`tool_use` ids were found without `tool_result` blocks immediately after',
        ),
      ),
    ).toBe(true);
    expect(
      isToolExchangeAdjacencyError(new APIStatusError(422, 'unexpected `tool_result` block')),
    ).toBe(true);
  });

  it('does not match context overflow, unrelated status errors, or plain errors', () => {
    expect(
      isToolExchangeAdjacencyError(new APIContextOverflowError(400, 'context length exceeded')),
    ).toBe(false);
    expect(isToolExchangeAdjacencyError(new APIStatusError(400, 'Bad request'))).toBe(false);
    expect(
      isToolExchangeAdjacencyError(
        new APIStatusError(500, '`tool_use` without `tool_result`'),
      ),
    ).toBe(false);
    expect(isToolExchangeAdjacencyError(new Error('unexpected `tool_result` block'))).toBe(false);
  });
});

describe('isRecoverableRequestStructureError', () => {
  it('matches strict-provider message-shape validation failures', () => {
    expect(
      isRecoverableRequestStructureError(
        new APIStatusError(400, '`tool_use` ids were found without `tool_result` blocks'),
      ),
    ).toBe(true);
    expect(
      isRecoverableRequestStructureError(
        new APIStatusError(400, 'text content blocks must contain non-whitespace text'),
      ),
    ).toBe(true);
    expect(
      isRecoverableRequestStructureError(
        new APIStatusError(400, 'first message must use the "user" role'),
      ),
    ).toBe(true);
    expect(
      isRecoverableRequestStructureError(new APIStatusError(400, 'roles must alternate')),
    ).toBe(true);
  });

  it('matches the Anthropic duplicate tool_use id rejection', () => {
    expect(
      isRecoverableRequestStructureError(
        new APIStatusError(400, 'messages: `tool_use` ids must be unique'),
      ),
    ).toBe(true);
  });

  it('does not match context overflow, auth, generic bad requests, or non-status errors', () => {
    expect(
      isRecoverableRequestStructureError(
        new APIContextOverflowError(400, 'context length exceeded'),
      ),
    ).toBe(false);
    expect(isRecoverableRequestStructureError(new APIStatusError(401, 'unauthorized'))).toBe(false);
    expect(isRecoverableRequestStructureError(new APIStatusError(400, 'Bad request'))).toBe(false);
    expect(isRecoverableRequestStructureError(new Error('roles must alternate'))).toBe(false);
  });
});

describe('isProviderRateLimitError', () => {
  it('matches explicit HTTP 429 status errors', () => {
    expect(isProviderRateLimitError(new APIProviderRateLimitError('rate limited'))).toBe(true);
    expect(isProviderRateLimitError(new APIStatusError(429, 'rate limited'))).toBe(true);
    expect(isProviderRateLimitError({ response: { status: 429 } })).toBe(true);
    expect(isProviderRateLimitError({ statusCode: 503, message: 'rate limit' })).toBe(false);
  });

  it('matches wrapped provider rate-limit messages without status metadata', () => {
    expect(
      isProviderRateLimitError(
        new Error(
          'APIStatusError: 429 request id: req-429, request reached user+model max RPM: 50',
        ),
      ),
    ).toBe(true);
    expect(
      isProviderRateLimitError(
        "[provider.api_error] We're receiving too many requests at the moment. Please wait.",
      ),
    ).toBe(true);
    expect(isProviderRateLimitError(new Error('[provider.rate_limit] slow down'))).toBe(true);
  });

  it('does not match non-rate-limit provider errors', () => {
    expect(isProviderRateLimitError(new APIStatusError(401, 'unauthorized'))).toBe(false);
    expect(isProviderRateLimitError('APIStatusError: 401 unauthorized')).toBe(false);
    expect(isProviderRateLimitError(new Error('context length exceeded'))).toBe(false);
  });
});

describe('isTransientProviderError', () => {
  it('treats HTTP 5xx status errors as transient', () => {
    expect(isTransientProviderError(new APIStatusError(500, 'internal error'))).toBe(true);
    expect(isTransientProviderError(new APIStatusError(502, 'bad gateway'))).toBe(true);
    expect(isTransientProviderError(new APIStatusError(503, 'service unavailable'))).toBe(true);
    expect(isTransientProviderError(new APIStatusError(529, 'overloaded_error'))).toBe(true);
    expect(isTransientProviderError({ statusCode: 503, message: 'unavailable' })).toBe(true);
    expect(isTransientProviderError({ status: 500, message: 'error' })).toBe(true);
  });

  it('never treats rate limits as transient (dedicated scheduler owns them)', () => {
    expect(isTransientProviderError(new APIProviderRateLimitError('slow down'))).toBe(false);
    expect(isTransientProviderError(new APIStatusError(429, 'too many requests'))).toBe(false);
    expect(isTransientProviderError(new Error('[provider.rate_limit] slow down'))).toBe(false);
  });

  it('never treats permanent 4xx errors as transient', () => {
    expect(isTransientProviderError(new APIStatusError(400, 'bad request'))).toBe(false);
    expect(isTransientProviderError(new APIStatusError(401, 'unauthorized'))).toBe(false);
    expect(isTransientProviderError(new APIStatusError(404, 'not found'))).toBe(false);
    expect(isTransientProviderError(new APIContextOverflowError(400, 'context length'))).toBe(
      false,
    );
    expect(isTransientProviderError(new Error('[provider.auth_error] Invalid API key.'))).toBe(
      false,
    );
    expect(isTransientProviderError(new Error('[provider.api_error] 400 Bad Request'))).toBe(
      false,
    );
  });

  it('treats connection-level network failures as transient', () => {
    expect(isTransientProviderError(new APIConnectionError('connection reset'))).toBe(true);
    expect(
      isTransientProviderError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })),
    ).toBe(true);
    expect(
      isTransientProviderError(
        Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        }),
      ),
    ).toBe(true);
    expect(isTransientProviderError(new Error('socket hang up'))).toBe(true);
    expect(isTransientProviderError(new Error('fetch failed'))).toBe(true);
    expect(
      isTransientProviderError(new Error('[provider.connection_error] Connection reset.')),
    ).toBe(true);
    expect(
      isTransientProviderError(new Error('[provider.api_error] 503 Service Unavailable')),
    ).toBe(true);
    expect(isTransientProviderError(new Error('[provider.api_error] Overloaded'))).toBe(true);
  });

  it('does not treat timeouts or aborts as transient', () => {
    expect(isTransientProviderError(new APITimeoutError('Request timed out.'))).toBe(false);
    expect(
      isTransientProviderError(new Error('[provider.connection_error] Request timed out.')),
    ).toBe(false);
    expect(isTransientProviderError(new Error('Aborted'))).toBe(false);
    expect(
      isTransientProviderError(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })),
    ).toBe(false);
    expect(isTransientProviderError(new APIEmptyResponseError('empty response'))).toBe(false);
    expect(isTransientProviderError(new Error('Subagent profile "x" was not found'))).toBe(false);
  });
});
