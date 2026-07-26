import { describe, expect, it } from 'vitest';

import { isBlobRef } from '#/agent/records/blobref';
import { MAX_WIRE_LINE_BYTES } from '#/agent/records/persistence';

describe('agent/records/blobref — isBlobRef', () => {
  it('returns true for blobref:// URLs', () => {
    expect(isBlobRef('blobref://abc123')).toBe(true);
    expect(isBlobRef('blobref://example/path?query=1')).toBe(true);
  });

  it('returns false for non-blobref URLs', () => {
    expect(isBlobRef('https://example.com/foo')).toBe(false);
    expect(isBlobRef('http://localhost:3000/bar')).toBe(false);
    expect(isBlobRef('file:///tmp/baz')).toBe(false);
    expect(isBlobRef('BLOBREF://case-sensitive')).toBe(false);
    expect(isBlobRef('blob://different-protocol')).toBe(false);
  });

  it('returns false for empty or missing prefix', () => {
    expect(isBlobRef('')).toBe(false);
    expect(isBlobRef('abc123')).toBe(false);
  });
});

describe('agent/records/persistence — constants', () => {
  it('exposes MAX_WIRE_LINE_BYTES at 64 MiB', () => {
    expect(MAX_WIRE_LINE_BYTES).toBe(64 * 1024 * 1024);
  });
});
