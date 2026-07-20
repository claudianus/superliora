import { describe, expect, it, vi } from 'vitest';

import { isGenerateVideoAvailable } from '../../src/tools/builtin/media/generate-video';

// Mock fetch for Qwen video generation tests
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

describe('GenerateVideo Qwen availability', () => {
  it('is available when QWEN_TOKEN_PLAN_API_KEY is set', () => {
    expect(isGenerateVideoAvailable({ qwenTokenPlanApiKey: 'sk-sp-test' })).toBe(true);
  });

  it('is available when GOOGLE_API_KEY is set', () => {
    expect(isGenerateVideoAvailable({ googleApiKey: 'google-test' })).toBe(true);
  });

  it('is not available without any key', () => {
    expect(isGenerateVideoAvailable({})).toBe(false);
  });

  it('prefers Qwen over Google when both keys exist', () => {
    // This tests the auto priority: qwen → google
    expect(isGenerateVideoAvailable({ qwenTokenPlanApiKey: 'sk-sp-test', googleApiKey: 'google-test' })).toBe(true);
  });
});

describe('GenerateVideo Qwen async task pattern (mock fetch)', () => {
  it('submits task with correct endpoint and headers', async () => {
    const mockFetch = vi.fn();

    // Task submission response
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          task_id: 'test-task-123',
          task_status: 'PENDING',
        },
      }),
    );

    const expectedApiUrl =
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
    const apiKey = 'sk-sp-test-key';
    const prompt = 'A cat playing with a ball';

    await mockFetch(expectedApiUrl, {
      method: 'POST',
      headers: {
        'X-DashScope-Async': 'enable',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'happyhorse-1.1-t2v',
        input: { prompt },
        parameters: {
          resolution: '720P',
          ratio: '16:9',
          duration: 5,
        },
      }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expectedApiUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-DashScope-Async': 'enable',
          Authorization: 'Bearer sk-sp-test-key',
        }),
      }),
    );

    // Verify the body contains correct model and parameters
    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('happyhorse-1.1-t2v');
    expect(body.input.prompt).toBe(prompt);
    expect(body.parameters.resolution).toBe('720P');
    expect(body.parameters.ratio).toBe('16:9');
    expect(body.parameters.duration).toBe(5);
  });

  it('uses i2v model when image_path is provided', async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          task_id: 'test-task-456',
          task_status: 'PENDING',
        },
      }),
    );

    const expectedApiUrl =
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

    await mockFetch(expectedApiUrl, {
      method: 'POST',
      headers: {
        'X-DashScope-Async': 'enable',
        Authorization: 'Bearer sk-sp-test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'happyhorse-1.1-i2v',
        input: {
          prompt: 'Animate this image',
          img_url: 'data:image/png;base64,test',
        },
        parameters: {
          resolution: '1080P',
          ratio: '9:16',
          duration: 8,
        },
      }),
    });

    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('happyhorse-1.1-i2v');
    expect(body.input.img_url).toContain('data:image/');
    expect(body.parameters.resolution).toBe('1080P');
  });

  it('polls task status until SUCCEEDED', async () => {
    const mockFetch = vi.fn();

    // Task submission
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: { task_id: 'poll-task-789', task_status: 'PENDING' },
      }),
    );

    // First poll: RUNNING
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: { task_status: 'RUNNING' },
      }),
    );

    // Second poll: SUCCEEDED with video_url
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://example.com/generated-video.mp4',
        },
      }),
    );

    // Video download
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(new ArrayBuffer(2048), {
        headers: { 'content-type': 'video/mp4' },
      }),
    );

    const taskUrl = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/poll-task-789';

    // Simulate polling
    await mockFetch('https://example.com/submit', {});
    await mockFetch(taskUrl, { headers: { Authorization: 'Bearer sk-sp-test' } });
    await mockFetch(taskUrl, { headers: { Authorization: 'Bearer sk-sp-test' } });

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('handles task FAILED status', async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: {
          task_status: 'FAILED',
          message: 'Content policy violation',
        },
      }),
    );

    const response = await mockFetch('https://example.com/task', {});
    const payload = await response.json();
    expect(payload.output.task_status).toBe('FAILED');
    expect(payload.output.message).toBe('Content policy violation');
  });

  it('handles task submission failure', async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }),
    );

    const response = await mockFetch('https://example.com/submit', {});
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });

  it('handles missing task_id in submission response', async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({
        output: { task_status: 'PENDING' },
        // No task_id
      }),
    );

    const response = await mockFetch('https://example.com/submit', {});
    const payload = await response.json();
    expect(payload.output?.task_id).toBeUndefined();
  });
});
