import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import { BlobStore, isBlobRef } from '../../../src/agent/records/blobref';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  FileSystemAgentRecordPersistence,
  type AgentRecord,
} from '../../../src/agent/records';
import { testAgent } from '../harness/agent';

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function firstImageUrl(record: AgentRecord): string {
  if (record.type !== 'turn.prompt' && record.type !== 'turn.steer') {
    throw new Error(`Expected prompt media, received ${record.type}`);
  }
  const part = record.input[0];
  if (part?.type !== 'image_url') throw new Error('Expected an image content part');
  return part.imageUrl.url;
}

async function makeStore(options?: { maxCacheSize?: number; threshold?: number }): Promise<{ store: BlobStore; blobsDir: string }> {
  const blobsDir = join(tmpdir(), `blobref-test-${randomBytes(6).toString('hex')}`);
  await mkdir(blobsDir, { recursive: true });
  cleanups.push(blobsDir);
  return {
    store: new BlobStore({
      blobsDir,
      threshold: options?.threshold ?? 4096,
      maxCacheSize: options?.maxCacheSize,
    }),
    blobsDir,
  };
}

describe('blobref', () => {
  it.each(['https://example.com/media', 'file:///tmp/media', 'data:image/png;base64,YQ==', '', 'abc123'])(
    'does not classify ordinary media URLs as blob references: %s',
    (url) => {
      expect(isBlobRef(url)).toBe(false);
    },
  );

  it('rehydrates persisted context media for both context and replay consumers', async () => {
    const homedir = await mkdtemp(join(tmpdir(), 'native-record-media-'));
    cleanups.push(homedir);
    const wirePath = join(homedir, 'wire.jsonl');
    const payload = 'Y'.repeat(5_000);
    const dataUri = `data:image/png;base64,${payload}`;
    const writer = new FileSystemAgentRecordPersistence(wirePath, {
      blobStore: new BlobStore({ blobsDir: join(homedir, 'blobs') }),
    });
    writer.append({ type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 });
    writer.append({
      type: 'context.append_message',
      message: {
        role: 'user', toolCalls: [], origin: { kind: 'user' },
        content: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      },
    });
    await writer.close();
    const diskRecord = await readFile(wirePath, 'utf8');
    expect(diskRecord).toContain('blobref:image/png;');
    expect(diskRecord).not.toContain(dataUri);

    const reader = new FileSystemAgentRecordPersistence(wirePath);
    const ctx = testAgent({ persistence: reader, homedir, type: 'sub' });
    await ctx.agent.records.replay();
    const media = ctx.agent.context.history[0]?.content[0];
    if (media?.type !== 'image_url') throw new Error('Expected replayed image media');
    expect(media.imageUrl.url).toBe(dataUri);
    const replay = ctx.agent.replayBuilder.buildResult()[0];
    if (replay?.type !== 'message') throw new Error('Expected a replay message');
    expect(replay.message).toBe(ctx.agent.context.history[0]);
    expect(replay.message.content[0]).toBe(media);
    expect(await readFile(wirePath, 'utf8')).toBe(diskRecord);
    expect(ctx.llmCalls).toEqual([]);
    await ctx.agent.records.close();
  });

  it('offloads large data URIs and replaces with blobref', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'A'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;

    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);

    const url = firstImageUrl(offloaded);
    expect(isBlobRef(url)).toBe(true);
    expect(url.startsWith('blobref:')).toBe(true);
    expect(url.startsWith('blobref:image/png;')).toBe(true);

    const files = await readdir(blobsDir);
    expect(files).toHaveLength(1);
    expect((await readFile(join(blobsDir, files[0]!))).toString('base64')).toBe(payload);
  });

  it('does not mutate the input record or its content parts', async () => {
    const { store } = await makeStore();
    const payload = 'M'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;
    const innerImageUrl = { url: dataUri };
    const part = { type: 'image_url', imageUrl: innerImageUrl } as const;
    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [part],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);

    // The original record/parts must remain untouched.
    expect(record.input[0]).toBe(part);
    expect(part.imageUrl).toBe(innerImageUrl);
    expect(innerImageUrl.url).toBe(dataUri);

    // The returned record carries the blobref URL.
    expect(offloaded).not.toBe(record);
    const returnedUrl = firstImageUrl(offloaded);
    expect(returnedUrl.startsWith('blobref:image/png;')).toBe(true);
  });

  it('offloads tool.result media parts in context.append_loop_event records', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'X'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;
    const innerImageUrl = { url: dataUri };
    const part = { type: 'image_url', imageUrl: innerImageUrl } as const;
    const record: AgentRecord = {
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'p',
        toolCallId: 'tc',
        result: { isError: false, output: [part] },
      },
    };

    const offloaded = await store.offload(record);

    // Input record/part untouched — same path that the agent's in-memory
    // history shares with this record reference.
    expect(innerImageUrl.url).toBe(dataUri);
    expect(part.imageUrl).toBe(innerImageUrl);

    // Returned record has blobref URL on a fresh imageUrl object.
    if (offloaded.type !== 'context.append_loop_event' || offloaded.event.type !== 'tool.result') {
      throw new Error('Expected a persisted tool result');
    }
    const output = offloaded.event.result.output;
    if (typeof output === 'string' || output[0]?.type !== 'image_url') {
      throw new Error('Expected tool-result image media');
    }
    expect(output[0].imageUrl).not.toBe(innerImageUrl);
    expect(output[0].imageUrl.url.startsWith('blobref:image/png;')).toBe(true);

    const files = await readdir(blobsDir);
    expect(files).toHaveLength(1);
  });

  it('returns the same record reference when nothing needs offloading', async () => {
    const { store } = await makeStore();
    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'just text' }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);
    expect(offloaded).toBe(record);
  });

  it('skips small data URIs below threshold', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'short';
    const dataUri = `data:image/png;base64,${payload}`;

    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);

    // Below threshold: nothing happens; original record is returned as-is.
    expect(offloaded).toBe(record);
    const files = await readdir(blobsDir).catch(() => []);
    expect(files).toHaveLength(0);
  });

  it('skips existing blobrefs during offload', async () => {
    const { store } = await makeStore();
    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: 'blobref:image/png;abc' } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);

    // Already a blobref: nothing to do; the same reference is returned.
    expect(offloaded).toBe(record);
  });

  it('rehydrates blobrefs back to data URIs', async () => {
    const { store } = await makeStore();
    const payload = 'B'.repeat(5000);
    const dataUri = `data:image/jpeg;base64,${payload}`;

    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);
    await store.rehydrate(offloaded);

    const url = firstImageUrl(offloaded);
    expect(url).toBe(dataUri);
  });

  it('replaces missing blobs with placeholder text', async () => {
    const { store } = await makeStore();
    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: 'blobref:image/png;deadbeef' } }],
      origin: { kind: 'user' },
    };

    await store.rehydrate(record);

    const url = firstImageUrl(record);
    expect(url).toBe('[media missing]');
  });

  it('deduplicates identical payloads by hash', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'C'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;

    const record1: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };
    const record2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    await store.offload(record1);
    await store.offload(record2);

    const files = await readdir(blobsDir);
    expect(files).toHaveLength(1);
  });

  it('rehydrates from write-through cache after blob file is deleted', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'E'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;

    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);
    const files = await readdir(blobsDir);
    expect(files).toHaveLength(1);
    await rm(join(blobsDir, files[0]!));

    // Should still rehydrate because offload populated the cache.
    await store.rehydrate(offloaded);
    const url = firstImageUrl(offloaded);
    expect(url).toBe(dataUri);
  });

  it('rehydrates from read cache after first disk read', async () => {
    const { store, blobsDir } = await makeStore();
    const payload = 'F'.repeat(5000);
    const dataUri = `data:image/png;base64,${payload}`;

    const record: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: dataUri } }],
      origin: { kind: 'user' },
    };

    const offloaded = await store.offload(record);
    const blobUrl = firstImageUrl(offloaded);
    const reader = new BlobStore({ blobsDir });
    await reader.rehydrate(offloaded);

    const files = await readdir(blobsDir);
    expect(files).toHaveLength(1);
    await rm(join(blobsDir, files[0]!));

    const record2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: blobUrl } }],
      origin: { kind: 'user' },
    };
    await reader.rehydrate(record2);
    expect(firstImageUrl(record2)).toBe(dataUri);
  });

  it('evicts least-recently-used entries when cache size limit is exceeded', async () => {
    const limit = 8; // bytes
    const { store, blobsDir } = await makeStore({ maxCacheSize: limit, threshold: 1 });

    const payloadA = 'A'.repeat(4); // 3 bytes after base64 decode
    const payloadB = 'B'.repeat(4); // 3 bytes after base64 decode
    const payloadC = 'C'.repeat(4); // 3 bytes after base64 decode

    const recordA: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: `data:image/png;base64,${payloadA}` } }],
      origin: { kind: 'user' },
    };
    const recordB: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: `data:image/png;base64,${payloadB}` } }],
      origin: { kind: 'user' },
    };
    const recordC: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: `data:image/png;base64,${payloadC}` } }],
      origin: { kind: 'user' },
    };

    const offloadedA = await store.offload(recordA);
    const offloadedB = await store.offload(recordB);

    // Touch A so it becomes more recent than B.
    const recordA_touch: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedA) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordA_touch);

    // Adding C should evict B (the least-recently-used), not A.
    const offloadedC = await store.offload(recordC);

    // Delete all files so only cache can satisfy rehydration.
    const files = await readdir(blobsDir);
    for (const f of files) {
      await rm(join(blobsDir, f));
    }

    // A should still be cached because it was touched after B.
    const recordA2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedA) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordA2);
    expect(firstImageUrl(recordA2)).toBe(`data:image/png;base64,${payloadA}`);

    // B should have been evicted.
    const recordB2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedB) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordB2);
    expect(firstImageUrl(recordB2)).toBe('[media missing]');

    // C should still be cached.
    const recordC2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedC) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordC2);
    expect(firstImageUrl(recordC2)).toBe(`data:image/png;base64,${payloadC}`);
  });

  it('skips caching a blob larger than the entire cache cap', async () => {
    const limit = 8; // bytes
    const { store, blobsDir } = await makeStore({ maxCacheSize: limit, threshold: 1 });

    const small = 'S'.repeat(4);
    const large = 'L'.repeat(16);

    const recordSmall: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: `data:image/png;base64,${small}` } }],
      origin: { kind: 'user' },
    };
    const recordLarge: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: `data:image/png;base64,${large}` } }],
      origin: { kind: 'user' },
    };

    const offloadedSmall = await store.offload(recordSmall);
    const offloadedLarge = await store.offload(recordLarge);

    // Delete all files so only cache can satisfy rehydration.
    const files = await readdir(blobsDir);
    for (const f of files) {
      await rm(join(blobsDir, f));
    }

    // The small blob is still cached.
    const recordSmall2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedSmall) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordSmall2);
    expect(firstImageUrl(recordSmall2)).toBe(`data:image/png;base64,${small}`);

    // The large blob was never cached, so rehydration fails.
    const recordLarge2: AgentRecord = {
      type: 'turn.prompt',
      input: [{ type: 'image_url', imageUrl: { url: firstImageUrl(offloadedLarge) } }],
      origin: { kind: 'user' },
    };
    await store.rehydrate(recordLarge2);
    expect(firstImageUrl(recordLarge2)).toBe('[media missing]');
  });
});
