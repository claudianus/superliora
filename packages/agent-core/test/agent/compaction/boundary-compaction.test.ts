import { describe, expect, it } from 'vitest';

import {
  SWARM_TOTAL_RESULT_MAX_CHARS,
  isSwarmToolResult,
} from '#/agent/compaction/boundary-compaction';

describe('compaction/boundary-compaction — isSwarmToolResult', () => {
  it('returns true for an ultra_swarm_result opening tag', () => {
    expect(isSwarmToolResult('<ultra_swarm_result>...')).toBe(true);
    expect(isSwarmToolResult('<ultra_swarm_result expert_id="x">')).toBe(true);
  });

  it('returns true for an agent_swarm_result opening tag', () => {
    expect(isSwarmToolResult('<agent_swarm_result>...')).toBe(true);
    expect(isSwarmToolResult('<agent_swarm_result run_id="r1">')).toBe(true);
  });

  it('returns true when the tag is preceded by surrounding text', () => {
    expect(isSwarmToolResult('prefix\n<ultra_swarm_result>body</ultra_swarm_result>')).toBe(true);
  });

  it('returns false for plain text / unrelated XML', () => {
    expect(isSwarmToolResult('plain text')).toBe(false);
    expect(isSwarmToolResult('<other_tag>nope</other_tag>')).toBe(false);
  });

  it('is case-insensitive on the tag name', () => {
    expect(isSwarmToolResult('<ULTRA_SWARM_RESULT>...')).toBe(true);
    expect(isSwarmToolResult('<Agent_Swarm_Result>...')).toBe(true);
  });
});

describe('compaction/boundary-compaction — exported constants', () => {
  it('pins SWARM_TOTAL_RESULT_MAX_CHARS to 6_000', () => {
    expect(SWARM_TOTAL_RESULT_MAX_CHARS).toBe(6_000);
  });
});
