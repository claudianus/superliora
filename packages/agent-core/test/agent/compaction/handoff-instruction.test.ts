import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// test/agent/compaction → package root (packages/agent-core)
const packageRoot = join(fileURLToPath(new URL('../../..', import.meta.url)));
const instructionPath = join(
  packageRoot,
  'src/agent/compaction/prompts/compaction-instruction.md',
);
const prefixPath = join(
  packageRoot,
  'src/agent/compaction/prompts/compaction-summary-prefix.md',
);

describe('compaction handoff instruction (structured)', () => {
  it('requires v2 section labels mapped to OpenCode-style handoff fields', () => {
    const text = readFileSync(instructionPath, 'utf8');
    for (const label of [
      'current_goal:',
      'last_known_state:',
      'decisions:',
      'files_touched:',
      'failed_attempts:',
      'open_questions:',
      'next_actions:',
      'verified_claims:',
      'raw_refs:',
    ]) {
      expect(text).toContain(label);
    }
    // OpenCode mapping is explicit so models do not free-form-only.
    expect(text.toLowerCase()).toContain('objective');
    expect(text.toLowerCase()).toContain('work state');
    expect(text.toLowerCase()).toContain('next move');
    expect(text.toLowerCase()).toContain('relevant files');
  });

  it('summary prefix points resume at structured handoff + latest user message', () => {
    const text = readFileSync(prefixPath, 'utf8');
    expect(text).toContain('current_goal');
    expect(text).toContain('next_actions');
    expect(text).toContain('latest user message');
  });
});
