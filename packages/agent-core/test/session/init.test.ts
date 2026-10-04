import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { forkKaosExecutionPolicy, type Kaos } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { testKaos } from '../fixtures/test-kaos';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function rpc(): SDKSessionRPC {
  return {
    emitEvent: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
    requestQuestion: vi.fn(async () => null),
    requestCredential: vi.fn(async () => null),
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'liora-session-native-'));
  tempDirs.push(root);
  const workDir = join(root, 'work');
  const sessionDir = join(root, 'session');
  await mkdir(workDir);
  await mkdir(sessionDir);
  const session = new Session({
    id: 'native-session', kaos: testKaos.withCwd(workDir), homedir: sessionDir, rpc: rpc(),
  });
  return { session, workDir, sessionDir };
}

describe('Session native agents', () => {
  it('keeps independent child cwd and parent metadata without changing the main cwd', async () => {
    const { session, workDir } = await fixture();
    const childDir = join(workDir, 'child');
    await mkdir(childDir);
    try {
      const main = await session.createMain();
      const { id, agent: child } = await session.createAgent(
        { type: 'independent', kaos: testKaos.withCwd(childDir) },
        { parentAgentId: 'main' },
      );
      expect(child.kaos.getcwd()).toBe(childDir);
      expect(child.config.cwd).toBe(childDir);
      expect(main.kaos.getcwd()).toBe(workDir);
      expect(session.metadata.agents[id]).toMatchObject({ type: 'independent', parentAgentId: 'main' });
      expect(child.sessionControl).toBe(session.getSubagentHost(id));
      expect(main.sessionControl).toBe(session.getSubagentHost('main'));
    } finally {
      await session.close();
    }
  });

  it('rejects persisted parent cycles rather than waiting on its own resume', async () => {
    const { session, sessionDir } = await fixture();
    session.metadata.agents = {
      'agent-a': { homedir: join(sessionDir, 'agents', 'a'), type: 'sub', parentAgentId: 'agent-b' },
      'agent-b': { homedir: join(sessionDir, 'agents', 'b'), type: 'sub', parentAgentId: 'agent-a' },
    };
    try {
      await expect(session.ensureAgentResumed('agent-a')).rejects.toThrow('cycle');
    } finally {
      await session.close();
    }
  });

  it('loads project instructions from persistence when the rebound tool Kaos cannot read text', async () => {
    const { session, workDir } = await fixture();
    await mkdir(join(workDir, '.git'));
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions from disk', 'utf-8');
    const rejectReads = (inner: Kaos): Kaos => new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'readText') return async () => { throw new Error('Tool filesystem unavailable'); };
        if (prop === 'withCwd') return (cwd: string) => rejectReads(target.withCwd(cwd));
        // Agents fork the execution policy per installation; derived hosts keep the wrapper.
        if (prop === 'forkExecutionPolicy') return () => rejectReads(forkKaosExecutionPolicy(target));
        return Reflect.get(target, prop, receiver);
      },
    });
    session.setToolKaos(rejectReads(testKaos.withCwd(workDir)));
    let instructions: string | undefined;
    try {
      const { agent } = await session.createAgent({ type: 'main' }, {
        profile: {
          name: 'native-project',
          tools: ['Bash', 'SessionControl'],
          systemPrompt: (context) => {
            instructions = context.agentsMd;
            return 'native project prompt';
          },
        },
      });
      expect(instructions).toContain('project instructions from disk');
      await expect(agent.kaos.readText(join(workDir, 'AGENTS.md'))).rejects.toThrow('unavailable');
    } finally {
      await session.close();
    }
  });
});

describe('Session metadata persistence', () => {
  it('recovers an atomic metadata write from its backup after a corrupt primary', async () => {
    const { session, sessionDir } = await fixture();
    try {
      session.metadata.title = 'atomic-title';
      await session.writeMetadata();
      expect((await session.readMetadata()).title).toBe('atomic-title');
      await session.writeMetadata();
      await writeFile(join(sessionDir, 'state.json'), '{ "truncated', 'utf-8');
      expect((await session.readMetadata()).title).toBe('atomic-title');
    } finally {
      await session.close();
    }
  });
});
