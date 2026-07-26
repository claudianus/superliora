import { describe, expect, it } from 'vitest';

import {
  clampEffortToModelSupport,
  defaultThinkingEffortFor,
  resolveThinkingEffort,
  resolveThinkingLevel,
  type ThinkingModelDefaults,
} from '#/agent/config/thinking';

const MODEL_LOW_HIGH: ThinkingModelDefaults = { supportEfforts: ['low', 'high'] };
const MODEL_WITH_DEFAULT: ThinkingModelDefaults = {
  supportEfforts: ['low', 'medium', 'high', 'xhigh'],
  defaultEffort: 'medium',
};

describe('agent/config/thinking — pure thinking-effort resolvers', () => {
  describe('resolveThinkingLevel', () => {
    it('forces "off" when defaultThinking is explicitly false and no request is given', () => {
      const effort = resolveThinkingLevel(undefined, { defaultThinking: false });
      expect(effort).toBe('off');
    });

    it('falls back to the config effort when the request is empty and defaultThinking is undefined', () => {
      const effort = resolveThinkingLevel('   ', {
        defaultThinking: undefined,
        thinking: { mode: 'auto', effort: 'high' },
      });
      expect(effort).toBe('high');
    });

    it('honors a non-empty request over defaultThinking and config', () => {
      const effort = resolveThinkingLevel('low', {
        defaultThinking: false,
        thinking: { mode: 'auto', effort: 'high' },
      });
      expect(effort).toBe('low');
    });

    it('clamps the resolved request to the model support when provided', () => {
      const effort = resolveThinkingLevel('xhigh', {
        defaultThinking: true,
        model: MODEL_LOW_HIGH,
      });
      // supportEfforts are [low, high], xhigh snaps down to high.
      expect(effort).toBe('high');
    });
  });

  describe('resolveThinkingEffort', () => {
    it('returns "off" when the config mode is explicitly off and the request is empty', () => {
      const effort = resolveThinkingEffort(undefined, { mode: 'off' });
      expect(effort).toBe('off');
    });

    it('uses the model default when no config effort is set', () => {
      const effort = resolveThinkingEffort(undefined, undefined, MODEL_WITH_DEFAULT);
      expect(effort).toBe('medium');
    });

    it('treats "on" as the config effort (after clamping to the model)', () => {
      const effort = resolveThinkingEffort('on', { mode: 'auto', effort: 'xhigh' }, MODEL_LOW_HIGH);
      expect(effort).toBe('high');
    });

    it('treats "off" literally even if the config effort is set', () => {
      const effort = resolveThinkingEffort('off', { mode: 'auto', effort: 'high' });
      expect(effort).toBe('off');
    });

    it('falls back to the config effort for an unrecognised request', () => {
      const effort = resolveThinkingEffort('nonsense', { mode: 'auto', effort: 'medium' });
      expect(effort).toBe('medium');
    });
  });

  describe('defaultThinkingEffortFor', () => {
    it('returns the model default effort when provided', () => {
      expect(defaultThinkingEffortFor(MODEL_WITH_DEFAULT)).toBe('medium');
    });

    it('returns the middle of the support list when only supportEfforts is provided', () => {
      // supportEfforts = [low, medium, high, xhigh], middle index = 2 -> high
      const model: ThinkingModelDefaults = {
        supportEfforts: ['low', 'medium', 'high', 'xhigh'],
      };
      expect(defaultThinkingEffortFor(model)).toBe('high');
    });

    it('returns "high" when the model provides no defaults at all', () => {
      expect(defaultThinkingEffortFor(undefined)).toBe('high');
    });

    it('ignores unrecognised defaultEffort values and uses the support list middle', () => {
      const model: ThinkingModelDefaults = {
        supportEfforts: ['low', 'high'],
        defaultEffort: 'bogus',
      };
      // supportEfforts = [low, high], middle index = 1 -> high
      expect(defaultThinkingEffortFor(model)).toBe('high');
    });
  });

  describe('clampEffortToModelSupport', () => {
    it('passes "off" through unchanged', () => {
      expect(clampEffortToModelSupport('off', MODEL_LOW_HIGH)).toBe('off');
    });

    it('returns the effort unchanged when the model has no supportEfforts', () => {
      expect(clampEffortToModelSupport('xhigh', undefined)).toBe('xhigh');
    });

    it('returns the effort unchanged when the effort is in the support list', () => {
      expect(clampEffortToModelSupport('low', MODEL_LOW_HIGH)).toBe('low');
      expect(clampEffortToModelSupport('high', MODEL_LOW_HIGH)).toBe('high');
    });

    it('snaps an unsupported effort down to the nearest supported rung', () => {
      // MODEL_LOW_HIGH = [low, high]; xhigh (idx 3) is not supported,
      // so it walks down to high.
      expect(clampEffortToModelSupport('xhigh', MODEL_LOW_HIGH)).toBe('high');
    });

    it('snaps an unsupported effort up when nothing lower is supported', () => {
      // supportEfforts = [high, xhigh]; medium (idx 1) is below the
      // supported range and snaps up to high.
      const model: ThinkingModelDefaults = { supportEfforts: ['high', 'xhigh'] };
      expect(clampEffortToModelSupport('medium', model)).toBe('high');
    });
  });
});
