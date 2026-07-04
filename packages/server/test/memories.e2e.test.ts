import {
  createMemoryResponseSchema,
  forgetMemoryResponseSchema,
  getMemoryResponseSchema,
  listMemoriesResponseSchema,
  searchMemoriesResponseSchema,
} from '@superliora/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { boot, closeAll } from './helpers/serverHarness';

function envelopeOf<T>(body: unknown): {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
  details?: unknown;
} {
  return body as {
    code: number;
    msg: string;
    data: T | null;
    request_id: string;
    details?: unknown;
  };
}

async function jsonOf(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

describe('Liora Recall memory REST API', () => {
  afterEach(async () => {
    await closeAll();
  });

  it('creates, searches, reads, lists, and forgets memories', async () => {
    const server = await boot();

    const create = await server.authedFetch('/api/v1/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'semantic',
        subject: 'preferred shell',
        content: 'The user prefers pnpm commands through the harness when possible.',
        tags: ['preference', 'workflow'],
        confidence: 0.95,
        importance: 0.8,
      }),
    });
    expect(create.status).toBe(200);
    const createdEnvelope = envelopeOf<unknown>(await jsonOf(create));
    expect(createdEnvelope.code).toBe(0);
    const created = createMemoryResponseSchema.parse(createdEnvelope.data);
    const memoryId = created.memory.id;

    const search = await server.authedFetch('/api/v1/memories:search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'pnpm harness workflow', limit: 5 }),
    });
    expect(search.status).toBe(200);
    const searchedEnvelope = envelopeOf<unknown>(await jsonOf(search));
    expect(searchedEnvelope.code).toBe(0);
    const searched = searchMemoriesResponseSchema.parse(searchedEnvelope.data);
    expect(searched.memories.some((result) => result.memory.id === memoryId)).toBe(true);

    const get = await server.authedFetch(`/api/v1/memories/${memoryId}`);
    expect(get.status).toBe(200);
    const getEnvelope = envelopeOf<unknown>(await jsonOf(get));
    expect(getEnvelope.code).toBe(0);
    const fetched = getMemoryResponseSchema.parse(getEnvelope.data);
    expect(fetched.memory?.subject).toBe('preferred shell');

    const list = await server.authedFetch('/api/v1/memories');
    expect(list.status).toBe(200);
    const listedEnvelope = envelopeOf<unknown>(await jsonOf(list));
    expect(listedEnvelope.code).toBe(0);
    const listed = listMemoriesResponseSchema.parse(listedEnvelope.data);
    expect(listed.memories.some((memory) => memory.id === memoryId)).toBe(true);

    const forget = await server.authedFetch(`/api/v1/memories/${memoryId}`, { method: 'DELETE' });
    expect(forget.status).toBe(200);
    const forgetEnvelope = envelopeOf<unknown>(await jsonOf(forget));
    expect(forgetEnvelope.code).toBe(0);
    const forgotten = forgetMemoryResponseSchema.parse(forgetEnvelope.data);
    expect(forgotten.forgotten).toBe(true);
  });
});
