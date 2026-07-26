import { describe, expect, it } from 'vitest';

import { canonicalTelemetryArgs, isPlainRecord } from '#/agent/turn/canonical-args';

describe('agent/turn/canonical-args — isPlainRecord', () => {
  it('rejects null, undefined, primitives, and arrays', () => {
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord(undefined)).toBe(false);
    expect(isPlainRecord(1)).toBe(false);
    expect(isPlainRecord('s')).toBe(false);
    expect(isPlainRecord(true)).toBe(false);
    expect(isPlainRecord([])).toBe(false);
  });

  it('accepts plain objects and Object.create(null) objects', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ a: 1 })).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
  });

  it('rejects class instances', () => {
    class A {
      x = 1;
    }
    expect(isPlainRecord(new A())).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
    expect(isPlainRecord(/x/)).toBe(false);
    expect(isPlainRecord(new Map())).toBe(false);
  });
});

describe('agent/turn/canonical-args — canonicalTelemetryArgs', () => {
  it('sorts top-level keys alphabetically', () => {
    expect(canonicalTelemetryArgs({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('sorts nested object keys recursively', () => {
    expect(
      canonicalTelemetryArgs({ z: { y: 1, x: 2 }, a: [{ c: 3, b: 4 }] }),
    ).toBe('{"a":[{"b":4,"c":3}],"z":{"x":2,"y":1}}');
  });

  it('passes through arrays and primitives unchanged', () => {
    expect(canonicalTelemetryArgs([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalTelemetryArgs('hello')).toBe('"hello"');
    expect(canonicalTelemetryArgs(7)).toBe('7');
    expect(canonicalTelemetryArgs(null)).toBe('null');
  });

  it('keeps arrays of primitive values in their original order', () => {
    expect(canonicalTelemetryArgs({ items: ['c', 'a', 'b'] })).toBe('{"items":["c","a","b"]}');
  });

  it('sorts keys inside an array of plain objects', () => {
    expect(
      canonicalTelemetryArgs({ list: [{ b: 2, a: 1 }, { d: 4, c: 3 }] }),
    ).toBe('{"list":[{"a":1,"b":2},{"c":3,"d":4}]}');
  });
});
