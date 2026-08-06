import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import type { HarnessRefinementEvent } from '../../src/agent/refine/state';
import { RefineTool } from '../../src/tools/builtin/context/refine';

function appliedEvent(overrides: Partial<HarnessRefinementEvent> = {}): HarnessRefinementEvent {
  return {
    id: 'ref-abc123',
    at: Date.now(),
    scope: 'local',
    kind: 'prompt',
    targetId: 'entry-1',
    summary: 'captured the import convention',
    status: 'applied',
    ...overrides,
  };
}

function makeAgent(refine: unknown): Agent {
  return { refine } as unknown as Agent;
}

describe('RefineTool', () => {
  it('run reports applied edits with rollback ids', async () => {
    const refine = {
      refine: vi.fn(async () => ({
        scope: 'local',
        summary: 'captured a lesson',
        applied: [appliedEvent()],
        failed: [],
      })),
    };
    const tool = new RefineTool(makeAgent(refine));

    const result = await tool
      .resolveExecution({ action: 'run', scope: 'local', instructions: 'focus on imports' })
      .execute();

    expect(refine.refine).toHaveBeenCalledWith({ scope: 'local', instructions: 'focus on imports' });
    expect(result.output).toContain('captured a lesson');
    expect(result.output).toContain('ref-abc123');
    expect(result.output).toMatch(/rollback/i);
  });

  it('run reports a no-op when nothing was proposed', async () => {
    const refine = {
      refine: vi.fn(async () => ({ scope: 'local', summary: 'quiet', applied: [], failed: [] })),
    };
    const tool = new RefineTool(makeAgent(refine));

    const result = await tool.resolveExecution({ action: 'run', scope: 'local' }).execute();

    expect(result.output).toMatch(/nothing worth persisting/i);
  });

  it('run surfaces planner failures as tool output, not throws', async () => {
    const refine = {
      refine: vi.fn(async () => {
        throw new Error('planner returned invalid JSON');
      }),
    };
    const tool = new RefineTool(makeAgent(refine));

    const result = await tool.resolveExecution({ action: 'run', scope: 'local' }).execute();

    expect(result.output).toMatch(/Refine failed: planner returned invalid JSON/);
  });

  it('status lists entries and recent refinements', async () => {
    const refine = {
      state: () => ({
        entries: [
          {
            id: 'entry-1',
            kind: 'prompt',
            title: 'ESM imports',
            content: 'x',
            path: '',
            scope: 'local',
            version: 2,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        refinements: [appliedEvent()],
      }),
      snapshot: () => ({
        promptNotes: 1,
        subagentSpecs: 0,
        refinements: 1,
        lastRefinedAt: 123,
        inFlight: false,
        turnsSinceRefine: 4,
      }),
    };
    const tool = new RefineTool(makeAgent(refine));

    const result = await tool.resolveExecution({ action: 'status', scope: 'local' }).execute();

    expect(result.output).toContain('1 prompt notes');
    expect(result.output).toContain('entry-1');
    expect(result.output).toContain('ref-abc123');
  });

  it('rollback requires an id and forwards it', async () => {
    const refine = {
      rollback: vi.fn(async (id: string) => appliedEvent({ id })),
    };
    const tool = new RefineTool(makeAgent(refine));

    const missing = await tool.resolveExecution({ action: 'rollback', scope: 'local' }).execute();
    expect(missing.output).toMatch(/requires refinementId/);
    expect(refine.rollback).not.toHaveBeenCalled();

    const result = await tool
      .resolveExecution({ action: 'rollback', scope: 'local', refinementId: 'ref-abc123' })
      .execute();
    expect(refine.rollback).toHaveBeenCalledWith('ref-abc123');
    expect(result.output).toMatch(/Rolled back ref-abc123/);
  });

  it('tells subagents refine is unavailable', async () => {
    const tool = new RefineTool(makeAgent(null));

    const result = await tool.resolveExecution({ action: 'run', scope: 'local' }).execute();

    expect(result.output).toMatch(/main agent/);
  });
});
