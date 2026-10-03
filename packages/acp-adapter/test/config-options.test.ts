import { describe, expect, it, vi } from 'vitest';

import type { LioraHarness } from '@superliora/sdk';

import {
  buildModelOption,
  buildModeOption,
  buildSessionConfigOptions,
  buildThinkingOption,
} from '../src/config-options';
import type { AcpModelEntry } from '../src/model-catalog';

function makeHarnessWithModels(
  entries: ReadonlyArray<{ id: string; model?: string; displayName?: string; capabilities?: readonly string[] }>,
): { harness: LioraHarness; getConfig: ReturnType<typeof vi.fn> } {
  const models: Record<string, { model: string; displayName?: string; capabilities?: readonly string[] }> = {};
  for (const entry of entries) {
    models[entry.id] = {
      model: entry.model ?? entry.id,
      ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
      ...(entry.capabilities !== undefined ? { capabilities: entry.capabilities } : {}),
    };
  }
  const getConfig = vi.fn(async () => ({ models }));
  return { harness: { getConfig } as unknown as LioraHarness, getConfig };
}

describe('buildModelOption', () => {
  it('emits exactly one option per native catalog row', () => {
    const models: readonly AcpModelEntry[] = [
      { id: 'alpha', name: 'Alpha', thinkingSupported: true },
      { id: 'beta', name: 'Beta', thinkingSupported: false },
    ];

    const option = buildModelOption(models, 'alpha');

    expect(option.id).toBe('model');
    expect(option.category).toBe('model');
    expect(option.name).toBe('Model');
    if (option.type !== 'select') {
      throw new Error('expected a SessionConfigSelect option');
    }
    expect(option.currentValue).toBe('alpha');
    expect(option.options).toHaveLength(2);
    const projected = option.options.map((entry) =>
      'value' in entry ? { value: entry.value, name: entry.name } : null,
    );
    expect(projected).toEqual([
      { value: 'alpha', name: 'Alpha' },
      { value: 'beta', name: 'Beta' },
    ]);
  });

  it('preserves configured model ids intact, including commas', () => {
    const models: readonly AcpModelEntry[] = [
      { id: 'kimi-v2,thinking', name: 'Kimi v2', thinkingSupported: true },
    ];

    const option = buildModelOption(models, 'kimi-v2,thinking');
    if (option.type !== 'select') {
      throw new Error('expected a SessionConfigSelect option');
    }
    expect(option.currentValue).toBe('kimi-v2,thinking');
    expect(option.options.map((o) => ('value' in o ? o.value : ''))).toEqual(['kimi-v2,thinking']);
  });

  it('handles an empty catalog without emitting any options', () => {
    const option = buildModelOption([], '');
    if (option.type !== 'select') {
      throw new Error('expected a SessionConfigSelect option');
    }
    expect(option.options).toHaveLength(0);
    expect(option.currentValue).toBe('');
  });
});

describe('buildThinkingOption', () => {
  it('produces a `type:"select"` `category:"thought_level"` option with `off`/`on` entries carrying the toggle value', () => {
    const on = buildThinkingOption(true);
    expect(on.type).toBe('select');
    expect(on.id).toBe('thinking');
    expect(on.category).toBe('thought_level');
    expect(on.name).toBe('Thinking');
    if (on.type !== 'select') throw new Error('expected SessionConfigSelect');
    expect(on.currentValue).toBe('on');
    expect(on.options.map((o) => ('value' in o ? o.value : ''))).toEqual(['off', 'on']);
    expect(on.options.map((o) => ('name' in o ? o.name : ''))).toEqual(['Thinking Off', 'Thinking On']);

    const off = buildThinkingOption(false);
    if (off.type !== 'select') throw new Error('expected SessionConfigSelect');
    expect(off.currentValue).toBe('off');
  });

  it('collapses to a single locked "on" entry for always-thinking models', () => {
    const locked = buildThinkingOption(true, true);
    if (locked.type !== 'select') throw new Error('expected SessionConfigSelect');
    expect(locked.currentValue).toBe('on');
    expect(locked.options.map((o) => ('value' in o ? o.value : ''))).toEqual(['on']);
    expect(locked.options.map((o) => ('name' in o ? o.name : ''))).toEqual(['Thinking On']);
  });
});

describe('buildModeOption', () => {
  it('returns native manual, auto, and yolo modes with descriptions', () => {
    const option = buildModeOption('manual');

    expect(option.id).toBe('mode');
    expect(option.category).toBe('mode');
    expect(option.name).toBe('Mode');
    if (option.type !== 'select') {
      throw new Error('expected a SessionConfigSelect option');
    }
    expect(option.currentValue).toBe('manual');
    expect(option.options).toHaveLength(3);
    const ids = option.options.map((o) => ('value' in o ? o.value : ''));
    expect(ids).toEqual(['manual', 'auto', 'yolo']);
    for (const entry of option.options) {
      if ('value' in entry) {
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
        expect(typeof entry.description).toBe('string');
        expect((entry.description ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildSessionConfigOptions', () => {
  it('composes [model, thinking, mode] when current model supports thinking and calls getConfig exactly once', async () => {
    const { harness, getConfig } = makeHarnessWithModels([
      { id: 'kimi-coder', model: 'kimi-for-coding', displayName: 'Kimi Coder', capabilities: ['thinking'] },
    ]);

    const result = await buildSessionConfigOptions(harness, 'kimi-coder', false, 'manual');

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    expect(result.map((o) => o.id)).toEqual(['model', 'thinking', 'mode']);

    if (result[0]!.type === 'select') {
      expect(result[0]!.currentValue).toBe('kimi-coder');
    }
    if (result[1]!.type === 'select' && result[1]!.id === 'thinking') {
      expect(result[1]!.currentValue).toBe('off');
      expect(result[1]!.category).toBe('thought_level');
    } else {
      throw new Error('expected thinking select at index 1');
    }
    if (result[2]!.type === 'select') {
      expect(result[2]!.currentValue).toBe('manual');
    }
  });

  it('omits the thinking toggle when current model is non-thinking-supported', async () => {
    const { harness } = makeHarnessWithModels([
      { id: 'kimi-coder', model: 'kimi-for-coding', displayName: 'Kimi Coder' },
      { id: 'kimi-plain', model: 'qwen-2.5-coder', displayName: 'Kimi Plain' },
    ]);

    const result = await buildSessionConfigOptions(harness, 'kimi-plain', false, 'manual');

    expect(result.map((o) => o.id)).toEqual(['model', 'mode']);
  });

  it('reflects the thinking toggle currentValue from the explicit argument', async () => {
    const { harness } = makeHarnessWithModels([
      { id: 'kimi-coder', model: 'kimi-for-coding', displayName: 'Kimi Coder', capabilities: ['thinking'] },
    ]);

    const result = await buildSessionConfigOptions(harness, 'kimi-coder', true, 'manual');
    const toggle = result.find((o) => o.id === 'thinking');
    if (!toggle || toggle.type !== 'select') throw new Error('expected thinking select toggle');
    expect(toggle.currentValue).toBe('on');
  });

  it('locks the thinking toggle to on for always-thinking models even when the session state says off', async () => {
    const { harness } = makeHarnessWithModels([
      {
        id: 'kimi-deep',
        model: 'kimi-deep-coder',
        displayName: 'Kimi Deep',
        capabilities: ['thinking', 'always_thinking'],
      },
    ]);

    const result = await buildSessionConfigOptions(harness, 'kimi-deep', false, 'manual');

    const toggle = result.find((o) => o.id === 'thinking');
    if (!toggle || toggle.type !== 'select') throw new Error('expected thinking select toggle');
    expect(toggle.currentValue).toBe('on');
    expect(toggle.options.map((o) => ('value' in o ? o.value : ''))).toEqual(['on']);
  });

  it('omits the thinking toggle when the current base model id is not in the catalog (defensive)', async () => {
    const { harness } = makeHarnessWithModels([
      { id: 'kimi-coder', model: 'kimi-for-coding', displayName: 'Kimi Coder' },
    ]);

    const result = await buildSessionConfigOptions(harness, 'unknown-model', true, 'manual');
    expect(result.map((o) => o.id)).toEqual(['model', 'mode']);
  });

  it('handles missing getConfig (partial-stub harness) by suppressing the toggle and shipping an empty model picker', async () => {
    const harness = {} as unknown as LioraHarness;

    const result = await buildSessionConfigOptions(harness, '', false, 'manual');

    expect(result.map((o) => o.id)).toEqual(['model', 'mode']);
    const modelOpt = result.find((o) => o.id === 'model');
    if (!modelOpt || modelOpt.type !== 'select') throw new Error('expected select');
    expect(modelOpt.options).toHaveLength(0);
  });
});
