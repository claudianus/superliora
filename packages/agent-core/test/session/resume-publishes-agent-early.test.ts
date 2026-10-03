import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { testKaos } from '../fixtures/test-kaos';

describe('Session reentrant parent resume', () => {
  it('publishes the actual Agent before replay so a worker can resolve its own parent', async () => {
    const homedir = await mkdtemp(join(tmpdir(), 'liora-parent-resume-'));
    const rpc: SDKSessionRPC = {
      emitEvent: vi.fn(async () => {}),
      requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
      requestQuestion: vi.fn(async () => null),
      requestCredential: vi.fn(async () => null),
    };
    const session = new Session({ kaos: testKaos.withCwd(homedir), homedir, rpc });
    session.metadata.agents['main'] = {
      homedir: join(homedir, 'agents', 'main'), type: 'main', parentAgentId: null,
    };
    let observedParent: Agent | undefined;
    const resume = vi.spyOn(Agent.prototype, 'resume').mockImplementation(async function (this: Agent) {
      observedParent = await session.ensureAgentResumed('main');
      expect(observedParent).toBe(this);
      return {};
    });
    try {
      const parent = await session.ensureAgentResumed('main');
      expect(observedParent).toBe(parent);
      expect(session.getReadyAgent('main')).toBe(parent);
      expect(resume).toHaveBeenCalledOnce();
    } finally {
      resume.mockRestore();
      await session.close();
      await rm(homedir, { recursive: true, force: true });
    }
  });
});
