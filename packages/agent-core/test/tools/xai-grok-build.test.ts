import { describe, expect, it, vi } from 'vitest';

import {
  isGenerateImageAvailable,
  resolveImageGenerationProvider,
} from '../../src/tools/builtin/media/generate-image';
import { isGenerateVideoAvailable } from '../../src/tools/builtin/media/generate-video';
import {
  PreferXaiGrokWebSearchProvider,
  XaiGrokBuildClient,
  XaiGrokWebSearchProvider,
  isXaiGrokCredentialConfigured,
} from '../../src/tools/providers/xai-grok-build';

type FetchArgs = [input: string | URL, init?: RequestInit];

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init));
}

describe('XaiGrokBuildClient', () => {
  it('posts web_search via Responses API and maps citations', async () => {
    const fetchImpl = mockFetch(async () =>
      Response.json({
        output_text: 'Grok search synthesis about TypeScript 6.',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Grok search synthesis about TypeScript 6.',
                annotations: [
                  { type: 'url_citation', url: 'https://example.com/ts6' },
                  { type: 'url_citation', url: 'https://example.com/ts6' },
                  { type: 'url_citation', url: 'https://example.com/docs' },
                ],
              },
            ],
          },
        ],
      }),
    );

    const client = new XaiGrokBuildClient({
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      apiKey: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await client.search('TypeScript 6 release', { limit: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as FetchArgs | undefined;
    expect(call).toBeDefined();
    expect(String(call![0])).toBe('https://cli-chat-proxy.grok.com/v1/responses');
    const body = JSON.parse(String(call![1]?.body));
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.model).toBe('grok-4.5');
    expect(results[0]?.url).toBe('https://example.com/ts6');
    expect(results[1]?.url).toBe('https://example.com/docs');
    expect(results[0]?.snippet).toContain('TypeScript 6');
  });

  it('generates images via /images/generations b64_json', async () => {
    const pngB64 = Buffer.from('fake-image-bytes').toString('base64');
    const fetchImpl = mockFetch(async () =>
      Response.json({
        data: [{ b64_json: pngB64 }],
      }),
    );

    const client = new XaiGrokBuildClient({
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      apiKey: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const image = await client.generateImage({
      prompt: 'a red cube',
      aspectRatio: '1:1',
    });
    const call = fetchImpl.mock.calls[0] as FetchArgs | undefined;
    expect(String(call![0])).toBe('https://cli-chat-proxy.grok.com/v1/images/generations');
    const body = JSON.parse(String(call![1]?.body));
    expect(body.model).toBe('grok-imagine-image-quality');
    expect(body.response_format).toBe('b64_json');
    expect(image.bytes.equals(Buffer.from('fake-image-bytes'))).toBe(true);
    expect(image.mimeType).toBe('image/jpeg');
  });

  it('starts and polls video generation', async () => {
    const calls: string[] = [];
    let pollCount = 0;
    const fetchImpl = mockFetch(async (url) => {
      calls.push(url);
      if (url.endsWith('/videos/generations')) {
        return Response.json({ request_id: 'req_123' });
      }
      if (url.includes('/videos/req_123')) {
        pollCount += 1;
        if (pollCount === 1) {
          return Response.json({ status: 'pending' });
        }
        return Response.json({
          status: 'done',
          video: { url: 'https://cdn.example.com/out.mp4' },
        });
      }
      if (url === 'https://cdn.example.com/out.mp4') {
        return new Response(Buffer.from('video-bytes'), {
          headers: { 'content-type': 'video/mp4' },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = new XaiGrokBuildClient({
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const video = await client.generateVideo({
      prompt: 'orbiting camera around a cube',
      durationSeconds: 6,
      resolution: '480p',
    });
    expect(video.bytes.equals(Buffer.from('video-bytes'))).toBe(true);
    expect(video.mimeType).toBe('video/mp4');
    expect(calls[0]).toContain('/videos/generations');
  });
});

describe('availability when Grok credentials exist', () => {
  it('marks image/video tools available with xaiGrokBuild client', () => {
    const client = new XaiGrokBuildClient({
      apiKey: 'xai-test',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(
      isGenerateImageAvailable({
        xaiGrokBuild: client,
      }),
    ).toBe(true);
    expect(
      resolveImageGenerationProvider('auto', {
        xaiGrokBuild: client,
      }),
    ).toBe('xai');
    expect(
      isGenerateVideoAvailable({
        xaiGrokBuild: client,
      }),
    ).toBe(true);
    expect(isXaiGrokCredentialConfigured({ apiKey: 'xai-test' })).toBe(true);
  });

  it('prefers xAI web search then falls back', async () => {
    const xai = {
      search: vi.fn(async () => {
        throw new Error('xai down');
      }),
    };
    const fallback = {
      search: vi.fn(async () => [
        { title: 'fallback', url: 'https://example.com', snippet: 'ok' },
      ]),
    };
    const provider = new PreferXaiGrokWebSearchProvider(
      xai as unknown as XaiGrokWebSearchProvider,
      fallback as unknown as XaiGrokWebSearchProvider,
    );
    const rows = await provider.search('query');
    expect(rows[0]?.title).toBe('fallback');
    expect(xai.search).toHaveBeenCalledTimes(1);
    expect(fallback.search).toHaveBeenCalledTimes(1);
  });
});
