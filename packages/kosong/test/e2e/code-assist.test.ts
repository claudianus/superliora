import { describe, expect, it, vi } from 'vitest';

import { CodeAssistChatProvider } from '#/providers/google/code-assist';

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function geminiChunk(text: string): Record<string, unknown> {
  return {
    candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

describe('CodeAssistChatProvider', () => {
  it('sends the Code Assist envelope with project and parses SSE chunks', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([geminiChunk('Hello'), geminiChunk(' world')]),
    );
    const provider = new CodeAssistChatProvider({
      model: 'gemini-2.5-pro',
      baseUrl: 'https://cloudcode-pa.example.test',
      project: 'proj-1',
      clientFactory: () => ({
        baseUrl: 'https://cloudcode-pa.example.test',
        project: 'proj-1',
        fetch: fetchMock as unknown as typeof fetch,
      }),
    });

    const streamed = await provider.generate('You are helpful.', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ], { auth: { apiKey: 'oauth-tok' } });

    const parts = [];
    for await (const part of streamed) parts.push(part);
    expect(parts.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text).join('')).toBe('Hello world');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cloudcode-pa.example.test/v1internal:streamGenerateContent?alt=sse');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer oauth-tok');
    expect(headers['User-Agent']).toContain('GeminiCLI/');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      project: string;
      request: { systemInstruction: { parts: { text: string }[] }; contents: unknown[] };
    };
    expect(body.model).toBe('gemini-2.5-pro');
    expect(body.project).toBe('proj-1');
    expect(body.request.systemInstruction.parts[0]?.text).toBe('You are helpful.');
  });

  it('throws a descriptive error on non-200 responses', async () => {
    const provider = new CodeAssistChatProvider({
      model: 'gemini-2.5-pro',
      clientFactory: () => ({
        baseUrl: 'https://cloudcode-pa.example.test',
        project: undefined,
        fetch: (async () => new Response('quota exceeded', { status: 429 })) as unknown as typeof fetch,
      }),
    });
    await expect(
      provider.generate('sys', [], [
        { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
      ], { auth: { apiKey: 'tok' } }),
    ).rejects.toThrow(/Code Assist request failed \(HTTP 429\)/);
  });

  it('requires a credential', async () => {
    const provider = new CodeAssistChatProvider({ model: 'gemini-2.5-pro' });
    await expect(
      provider.generate('sys', [], [
        { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
      ]),
    ).rejects.toThrow(/Google OAuth access token is required/);
  });
});
