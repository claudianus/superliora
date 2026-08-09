import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  fingerprintCompactionMessage,
  isCompactionPrefixIntact,
} from '../../../src/agent/compaction/pipeline/round';

function msg(text: string, role: Message['role'] = 'user'): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}

describe('isCompactionPrefixIntact', () => {
  it('allows append-only growth past the compacted prefix', () => {
    const original = [msg('a'), msg('b', 'assistant')];
    const fingerprints = original.map((message) => fingerprintCompactionMessage(message));
    const grown = [...original, msg('steer')];
    expect(isCompactionPrefixIntact(original, grown, 2, fingerprints)).toBe(true);
  });

  it('allows retained-suffix in-place mutation when the prefix fingerprint holds', () => {
    const original = [msg('a'), msg('b', 'assistant'), msg('live', 'assistant')];
    const fingerprints = original.slice(0, 2).map((message) => fingerprintCompactionMessage(message));
    original[2]!.content.push({ type: 'text', text: 'streamed' });
    expect(isCompactionPrefixIntact(original, original, 2, fingerprints)).toBe(true);
  });

  it('rejects in-place mutation of a compacted-prefix message', () => {
    const original = [msg('a'), msg('b', 'assistant')];
    const fingerprints = original.map((message) => fingerprintCompactionMessage(message));
    original[1]!.content.push({ type: 'text', text: 'mutated' });
    expect(isCompactionPrefixIntact(original, original, 2, fingerprints)).toBe(false);
  });

  it('rejects prefix identity replacement (undo / splice)', () => {
    const original = [msg('a'), msg('b', 'assistant')];
    const fingerprints = original.map((message) => fingerprintCompactionMessage(message));
    const replaced = [msg('a'), msg('other', 'assistant')];
    expect(isCompactionPrefixIntact(original, replaced, 2, fingerprints)).toBe(false);
  });

  it('rejects truncation into the compacted prefix', () => {
    const original = [msg('a'), msg('b', 'assistant')];
    const fingerprints = original.map((message) => fingerprintCompactionMessage(message));
    expect(isCompactionPrefixIntact(original, original.slice(0, 1), 2, fingerprints)).toBe(false);
  });
});
