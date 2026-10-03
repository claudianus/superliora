import { describe, expect, it } from 'vitest';

import {
  AGENT_WIRE_PROTOCOL_VERSION,
  isNewerWireVersion,
} from '#/agent/records/migration/index';


describe('agent/records/migration — isNewerWireVersion', () => {
  it('returns false for an older version than the current protocol', () => {
    expect(isNewerWireVersion('1.0')).toBe(false);
    expect(isNewerWireVersion('1.3')).toBe(false);
  });

  it('returns false for the current protocol version', () => {
    expect(isNewerWireVersion(AGENT_WIRE_PROTOCOL_VERSION)).toBe(false);
  });

  it('returns true for a newer major version', () => {
    expect(isNewerWireVersion('2.0')).toBe(true);
  });

  it('handles malformed version strings', () => {
    expect(isNewerWireVersion('not-a-version')).toBe(false);
  });
});

