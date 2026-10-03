import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearModelsDevCacheForTests, getModelsDevData, lookupModelsDevModel } from '../../src/utils/model-metadata';

afterEach(() => { clearModelsDevCacheForTests(); vi.unstubAllGlobals(); });

describe('native model metadata discovery', () => {
  it('reads provider catalog capabilities and pricing without ranking or probe requests', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ native: { models: {
      'wire-model': { id: 'wire-model', family: 'native-family', reasoning: true, tool_call: true,
        limit: { context: 32768 }, cost: { input: 1, output: 3 },
        modalities: { input: ['text', 'image', 'audio'] } },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const data = await getModelsDevData();
    expect(data.models.get('native/wire-model')).toMatchObject({
      contextWindow: 32768, inputCostPerM: 1, outputCostPerM: 3,
      supportsTools: true, supportsReasoning: true, supportsVision: true,
      supportsAudio: true, supportsVideo: false,
    });
    expect(lookupModelsDevModel('native/wire-model')).toEqual(data.models.get('native/wire-model'));
    expect(await getModelsDevData()).toBe(data);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://models.dev/api.json');
  });

  it('does not fabricate model metadata on native catalog failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    expect((await getModelsDevData()).models.size).toBe(0);
    expect(lookupModelsDevModel('unknown')).toBeUndefined();
  });
});
