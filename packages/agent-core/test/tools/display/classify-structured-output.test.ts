import { describe, expect, it } from 'vitest';

import { classifyStructuredOutput } from '../../../src/tools/display/classify-structured-output';

describe('classifyStructuredOutput', () => {
  it('wraps a JSON object', () => {
    const display = classifyStructuredOutput('{"status":"ok","count":2}');
    expect(display).toEqual({ kind: 'structured', data: { status: 'ok', count: 2 } });
  });

  it('wraps a JSON array', () => {
    expect(classifyStructuredOutput('[1,2,3]')).toEqual({ kind: 'structured', data: [1, 2, 3] });
  });

  it('tolerates surrounding whitespace', () => {
    expect(classifyStructuredOutput('\n  {"a":1}\n')).toEqual({
      kind: 'structured',
      data: { a: 1 },
    });
  });

  it('skips prose, scalars, and malformed JSON', () => {
    expect(classifyStructuredOutput('Done in 1.2s')).toBeUndefined();
    expect(classifyStructuredOutput('"just a string"')).toBeUndefined();
    expect(classifyStructuredOutput('42')).toBeUndefined();
    expect(classifyStructuredOutput('{"a":')).toBeUndefined();
    expect(classifyStructuredOutput('')).toBeUndefined();
  });

  it('skips non-string output (multimodal content parts)', () => {
    expect(classifyStructuredOutput([{ type: 'text', text: '{"a":1}' }])).toBeUndefined();
  });

  it('skips bodies too large to be worth parsing', () => {
    const huge = `{"a":"${'x'.repeat(200_001)}"}`;
    expect(classifyStructuredOutput(huge)).toBeUndefined();
  });
});
