import { describe, expect, it } from 'vitest';

import { canonicalTelemetryArgs } from '../../../src/agent/turn/canonical-args';

describe('agent/turn/canonical-args.ts — canonicalTelemetryArgs', () => {
  it('recursively sorts object keys for a deterministic JSON representation', () => {
    const a = canonicalTelemetryArgs({ b: 2, a: 1, nested: { y: 1, x: 2 } });
    const b = canonicalTelemetryArgs({ nested: { x: 2, y: 1 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"nested":{"x":2,"y":1}}');
  });

  it('preserves array order (arrays are not sorted)', () => {
    const a = canonicalTelemetryArgs([3, 1, 2]);
    expect(a).toBe('[3,1,2]');
  });

  it('treats null, numbers, and strings at the top level verbatim', () => {
    expect(canonicalTelemetryArgs(null)).toBe('null');
    expect(canonicalTelemetryArgs(42)).toBe('42');
    expect(canonicalTelemetryArgs('hello')).toBe('"hello"');
  });

  it('preserves the exact string representation of nested string values (no quoting tricks)', () => {
    expect(canonicalTelemetryArgs({ a: 'hello\\nworld' })).toBe('{"a":"hello\\\\nworld"}');
  });
});
