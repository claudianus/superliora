import { describe, expect, it } from 'vitest';

import {
  BALANCED_ASYNC_WORKING_SET_TOKENS,
  BALANCED_MAX_WORKING_SET_TOKENS,
  CONTEXT_WORKING_SET_PRESETS,
  contextWorkingSetPresetById,
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  formatWorkingSetFooterBadgeText,
  loopControlPatchForPreset,
  matchContextWorkingSetPreset,
  previewContextWorkingSet,
  workingSetPressure,
} from '#/tui/utils/agent/context-working-set';
import {
  MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
  QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
} from '@superliora/oauth';

describe('context working-set presets', () => {
  it('lists four named presets with balanced first', () => {
    expect(CONTEXT_WORKING_SET_PRESETS.map((p) => p.id)).toEqual([
      'balanced',
      'economy',
      'deep',
      'full_window',
    ]);
    expect(CONTEXT_WORKING_SET_PRESETS[0]?.loop.maxWorkingSetTokens).toBe(
      BALANCED_MAX_WORKING_SET_TOKENS,
    );
  });

  it('matches defaults and known presets', () => {
    expect(matchContextWorkingSetPreset({})).toBe('balanced');
    expect(
      matchContextWorkingSetPreset({
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
      }),
    ).toBe('balanced');
    expect(
      matchContextWorkingSetPreset({
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
      }),
    ).toBe('full_window');
    expect(
      matchContextWorkingSetPreset({
        maxWorkingSetTokens: 123_456,
        asyncWorkingSetTokens: 100_000,
      }),
    ).toBeUndefined();
  });

  it('previews soft thresholds capped on 1M windows', () => {
    const balanced = contextWorkingSetPresetById('balanced')!;
    const preview = previewContextWorkingSet({
      preset: balanced,
      maxContextTokens: 1_000_000,
      softRatio: 0.8,
      asyncRatio: 0.7,
    });
    expect(preview.softTokens).toBe(BALANCED_MAX_WORKING_SET_TOKENS);
    expect(preview.asyncTokens).toBe(BALANCED_ASYNC_WORKING_SET_TOKENS);
    expect(preview.windowLabel).toBe('1M');
    expect(preview.softLabel).toContain(formatTokenCount(BALANCED_MAX_WORKING_SET_TOKENS));
  });

  it('full_window uses ratio-only thresholds', () => {
    const full = contextWorkingSetPresetById('full_window')!;
    const preview = previewContextWorkingSet({
      preset: full,
      maxContextTokens: 1_000_000,
      softRatio: 0.8,
      asyncRatio: 0.7,
    });
    expect(preview.softTokens).toBe(800_000);
    expect(preview.asyncTokens).toBe(700_000);
  });

  it('clamps Gemini Pro snapshots under the 200k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'gemini-3.1-pro',
    });
    expect(snap.maxWorkingSetTokens).toBe(XAI_PRICING_SAFE_WORKING_SET_TOKENS);
    expect(snap.asyncWorkingSetTokens).toBe(XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS);
    expect(snap.presetId).toBe('economy');
  });

  it('clamps GPT-5.4 deep snapshots under the 272k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'gpt-5.4',
      maxWorkingSetTokens: 393_216,
      asyncWorkingSetTokens: 320_000,
    });
    expect(snap.maxWorkingSetTokens).toBe(262_144);
    expect(snap.asyncWorkingSetTokens).toBe(220_000);
    expect(snap.presetId).toBe('balanced');
  });

  it('clamps Qwen Flash snapshots under the 256k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'qwen3.6-flash',
    });
    expect(snap.maxWorkingSetTokens).toBe(QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS);
    expect(snap.asyncWorkingSetTokens).toBe(QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS);
  });

  it('clamps MiniMax M3 full_window under the 512k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'minimax-m3',
      maxWorkingSetTokens: 0,
      asyncWorkingSetTokens: 0,
    });
    expect(snap.maxWorkingSetTokens).toBe(MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS);
    expect(snap.asyncWorkingSetTokens).toBe(MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS);
  });

  it('clamps Qwen Plus snapshots under the 256k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'qwen3.7-plus',
    });
    expect(snap.maxWorkingSetTokens).toBe(QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS);
    expect(snap.asyncWorkingSetTokens).toBe(QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS);
    expect(snap.presetId).toBeUndefined();
  });

  it('clamps Grok snapshots under the 200k price band', () => {
    const snap = contextWorkingSetSnapshotFromLoopControl({
      model: 'grok-4.6',
    });
    expect(snap.maxWorkingSetTokens).toBe(XAI_PRICING_SAFE_WORKING_SET_TOKENS);
    expect(snap.asyncWorkingSetTokens).toBe(XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS);
    expect(snap.presetId).toBe('economy');
  });

  it('builds a loopControl patch from a preset', () => {
    const economy = contextWorkingSetPresetById('economy')!;
    expect(loopControlPatchForPreset(economy)).toEqual({
      maxWorkingSetTokens: economy.loop.maxWorkingSetTokens,
      asyncWorkingSetTokens: economy.loop.asyncWorkingSetTokens,
    });
  });

  it('formats token counts for the picker', () => {
    expect(formatTokenCount(0)).toBe('off');
    expect(formatTokenCount(262_144)).toBe('262k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
  });

  it('builds footer badge text and working-set pressure', () => {
    expect(formatWorkingSetFooterBadgeText(undefined)).toBeNull();
    expect(
      formatWorkingSetFooterBadgeText({
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
        presetId: 'balanced',
      }),
    ).toBe(`ws:${formatTokenCount(BALANCED_MAX_WORKING_SET_TOKENS)}`);
    expect(
      formatWorkingSetFooterBadgeText({
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
        presetId: 'full_window',
      }),
    ).toBe('ws:full');

    expect(
      workingSetPressure({
        contextTokens: 100_000,
        maxContextTokens: 1_000_000,
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
      }),
    ).toBe('ok');
    // 80% of 262_144 ≈ 209_715 → warn; 95% ≈ 249_037 → danger
    expect(
      workingSetPressure({
        contextTokens: 220_000,
        maxContextTokens: 1_000_000,
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
      }),
    ).toBe('warn');
    expect(
      workingSetPressure({
        contextTokens: 255_000,
        maxContextTokens: 1_000_000,
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
      }),
    ).toBe('danger');
  });
});
