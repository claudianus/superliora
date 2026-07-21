import { describe, expect, it } from 'vitest';
import {
  type JsonType,
  compileToolArgsValidator,
  validateToolArgs,
} from '../../src/tools/args-validator';

// Mirrors the Read tool's `line_offset` parameter: a union of a positive
// offset and a tail (negative) offset. `type` only appears inside the anyOf
// branches, which is exactly the shape models tend to stringify.
const readLikeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    path: { type: 'string' },
    line_offset: {
      anyOf: [
        { type: 'integer', minimum: 1 },
        { type: 'integer', minimum: -1000, maximum: -1 },
      ],
    },
    n_lines: { type: 'integer', minimum: 1 },
  },
  required: ['path'],
  additionalProperties: false,
} as Record<string, unknown>;

describe('validateToolArgs', () => {
  it('accepts correctly typed integers', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    expect(
      validateToolArgs(validator, { path: 'a.ts', line_offset: 96, n_lines: 16 }),
    ).toBeNull();
    expect(validateToolArgs(validator, { path: 'a.ts', line_offset: -5 })).toBeNull();
  });

  it('coerces stringified integers, including inside anyOf unions', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    const args: JsonType = { path: 'a.ts', line_offset: '96', n_lines: '16' };
    expect(validateToolArgs(validator, args)).toBeNull();
    expect(args).toEqual({ path: 'a.ts', line_offset: 96, n_lines: 16 });
  });

  it('coerces a stringified negative value toward the matching union branch', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    const args: JsonType = { path: 'a.ts', line_offset: '-5' };
    expect(validateToolArgs(validator, args)).toBeNull();
    expect(args).toEqual({ path: 'a.ts', line_offset: -5 });
  });

  it('still rejects values that cannot coerce or violate bounds', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    expect(validateToolArgs(validator, { path: 'a.ts', line_offset: 'abc' })).not.toBeNull();
    expect(validateToolArgs(validator, { path: 'a.ts', line_offset: { bogus: 1 } })).not.toBeNull();
    expect(validateToolArgs(validator, { path: 'a.ts', line_offset: 0 })).not.toBeNull();
    expect(validateToolArgs(validator, { path: 'a.ts', line_offset: -1001 })).not.toBeNull();
  });

  it('keeps the closed-object guard', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    expect(validateToolArgs(validator, { path: 'a.ts', bogus: true })).toContain(
      "must NOT have additional property 'bogus'",
    );
  });

  it('keeps required-property reporting', () => {
    const validator = compileToolArgsValidator(readLikeSchema);
    expect(validateToolArgs(validator, {})).toContain("must have required property 'path'");
  });
});
