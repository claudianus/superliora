import { describe, expect, it } from 'vitest';

import {
  AGENT_WIRE_PROTOCOL_VERSION,
  isNewerWireVersion,
  resolveWireMigrations,
} from '#/agent/records/migration/index';

describe('agent/records/migration — AGENT_WIRE_PROTOCOL_VERSION', () => {
  it('exposes the documented protocol version', () => {
    expect(AGENT_WIRE_PROTOCOL_VERSION).toBe('1.4');
  });
});

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

describe('agent/records/migration — resolveWireMigrations', () => {
  it('returns an empty list when the read version equals the current version', () => {
    expect(resolveWireMigrations(AGENT_WIRE_PROTOCOL_VERSION)).toEqual([]);
  });

  it('returns an empty list when the read version is newer than the current version', () => {
    expect(resolveWireMigrations('9.9')).toEqual([]);
  });

  it('returns a list of migrations for older versions', () => {
    const migrations = resolveWireMigrations('1.0');
    expect(migrations.length).toBeGreaterThan(0);
  });
});
