import { describe, expect, it } from 'vitest';
import {
  type JsonType,
  compileToolArgsValidator,
  validateToolArgs,
} from '../../src/tools/args-validator';

import { BashInputSchema } from '../../src/tools/builtin/shell/bash';
import { SessionControlInputSchema } from '../../src/tools/builtin/session-control';
import { toInputJsonSchema } from '../../src/tools/support/input-schema';

describe('native tool argument validation', () => {
  const bash = compileToolArgsValidator(toInputJsonSchema(BashInputSchema));
  const session = compileToolArgsValidator(toInputJsonSchema(SessionControlInputSchema));

  it('coerces model-emitted Bash scalars for the executable schema', () => {
    const args: JsonType = { command: 'sleep 2', timeout: '120', run_in_background: 'true', description: 'Sleep' };
    expect(validateToolArgs(bash, args)).toBeNull();
    expect(args).toEqual({ command: 'sleep 2', timeout: 120, run_in_background: true, description: 'Sleep' });
  });

  it('rejects invalid Bash deadlines and missing commands', () => {
    for (const timeout of ['abc', 0, -1, 1.5, { value: 1 }]) {
      expect(validateToolArgs(bash, { command: 'sleep 2', timeout })).not.toBeNull();
    }
    expect(validateToolArgs(bash, {})).toContain("must have required property 'command'");
    expect(validateToolArgs(bash, { command: '' })).not.toBeNull();
  });

  it('allows polling and explicit unbounded child runs through SessionControl', () => {
    const args: JsonType = { operation: 'wait', id: 'child', timeout: '0' };
    expect(validateToolArgs(session, args)).toBeNull();
    expect(args).toEqual({ operation: 'wait', id: 'child', timeout: 0 });
    expect(validateToolArgs(session, { operation: 'spawn', prompt: 'Work', description: 'Work', timeout: 0 })).toBeNull();
    expect(validateToolArgs(session, { operation: 'wait', id: 'child', timeout: -1 })).not.toBeNull();
  });

  it('rejects retired routing arguments and unknown operations', () => {
    expect(validateToolArgs(session, { operation: 'spawn', prompt: 'Work', description: 'Work', role: 'reviewer' })).toContain("must NOT have additional property 'role'");
    expect(validateToolArgs(session, { operation: 'review' })).not.toBeNull();
    expect(validateToolArgs(session, {})).toContain("must have required property 'operation'");
  });
});
