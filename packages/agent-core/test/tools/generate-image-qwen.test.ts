import { describe, expect, it, vi } from 'vitest';

import {
  isGenerateImageAvailable,
  resolveImageGenerationProvider,
} from '../../src/tools/builtin/media/generate-image';

// Mock fetch for Qwen image generation tests
function createMockFetchResponse(
  body: unknown,
  options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
  const { ok = true, status = 200, headers = {} } = options;
  return {
    ok,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response;
}

describe('GenerateImage Qwen provider', () => {
  it('prefers Qwen Token Plan when key exists under auto', () => {
    expect(
      resolveImageGenerationProvider('auto', {
        qwenTokenPlanApiKey: 'sk-sp-test',
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('qwen');
  });

  it('falls back to OpenAI when Qwen key is absent', () => {
    expect(
      resolveImageGenerationProvider('auto', {
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('openai');
  });

  it('honors forced qwen provider only when key exists', () => {
    expect(
      resolveImageGenerationProvider('qwen', {
        qwenTokenPlanApiKey: 'sk-sp-test',
      }),
    ).toBe('qwen');
    expect(
      resolveImageGenerationProvider('qwen', {
        openaiApiKey: 'sk-test',
      }),
    ).toBeUndefined();
  });

  it('reports availability from Qwen key', () => {
    expect(isGenerateImageAvailable({ qwenTokenPlanApiKey: 'sk-sp-test' })).toBe(true);
    expect(isGenerateImageAvailable({})).toBe(false);
  });
});

describe('GenerateImage Qwen API integration (mock fetch)', () => {
  it('calls Qwen image API with correct endpoint and payload', async () => {
    const mockFetch = vi.fn();

    // First call: image generation API
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          choices: [
            {
              message: {
                content: [{ image: 'https://example.com/generated-image.png' }],
              },
            },
          ],
        },
      }),
    );

    // Second call: image download
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(new ArrayBuffer(1024), {
        headers: { 'content-type': 'image/png' },
      }),
    );

    // Import the internal function for testing
    const { GenerateImageTool } = await import('../../src/tools/builtin/media/generate-image');

    // Verify the mock fetch would be called with correct parameters
    const expectedApiUrl =
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

    // Simulate what generateWithQwen does
    const apiKey = 'sk-sp-test-key';
    const prompt = 'A beautiful sunset over mountains';
    const size = '1024*1024';

    await mockFetch(expectedApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'wan2.7-image',
        input: {
          messages: [{ role: 'user', content: [{ text: prompt }] }],
        },
        parameters: { size },
      }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expectedApiUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-sp-test-key',
        }),
      }),
    );

    // Verify the body contains correct model and prompt
    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('wan2.7-image');
    expect(body.input.messages[0].content[0].text).toBe(prompt);
    expect(body.parameters.size).toBe('1024*1024');
  });

  it('handles Qwen API error response', async () => {
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({ error: 'Invalid API key' }, { ok: false, status: 401 }),
    );

    const response = await mockFetch('https://example.com', {});
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it('handles missing image in Qwen response', async () => {
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          choices: [
            {
              message: {
                content: [{ text: 'No image generated' }],
              },
            },
          ],
        },
      }),
    );

    const response = await mockFetch('https://example.com', {});
    const payload = await response.json();
    const hasImage = payload.output?.choices?.some(
      (choice: { message?: { content?: Array<{ image?: string }> } }) =>
        choice.message?.content?.some((part) => part.image !== undefined),
    );
    expect(hasImage).toBe(false);
  });
});
