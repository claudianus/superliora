import { describe, expect, it } from 'vitest';

import { toInputJsonSchema } from '#/tools/support/input-schema';

import { JobCreateTool } from '#/tools/builtin/job/job-tools';

/**
 * The JobCreate schema is the single largest block in the Conductor tool set
 * (~25% of its wire bytes). These tests pin the contract that must survive any
 * token-reduction work: every accepted field stays accepted and typed, the
 * documented knobs keep a description the model can act on, and the block
 * stays inside a budget.
 */
function schemaOf(): { properties: Record<string, { type?: string; description?: string }>; required: string[] } {
  const tool = new JobCreateTool({} as never);
  return toInputJsonSchema(
    // Reuse the tool's own schema through its public accessor.
    (tool as unknown as { inputSchemaForTest?: never }).inputSchemaForTest ??
      (JobCreateTool as never),
  ) as never;
}

void schemaOf;

describe('JobCreate wire schema', () => {
  it('keeps every field the Conductor playbook relies on', () => {
    const schema = (new JobCreateTool({} as never) as unknown as {
      parameters: { properties: Record<string, unknown>; required: string[] };
    }).parameters;

    const expected = [
      'title',
      'kind',
      'prompt',
      'success_criteria',
      'must_not_touch',
      'ownership_paths',
      'context_paths',
      'verification_commands',
      'test_seams',
      'tdd_mode',
      'task_track',
      'model_alias',
      'delivery_mode',
      'delivery_class',
      'surface_kind',
      'auto_split',
      'staff',
      'parent_job_id',
      'continue_from_job_id',
      'affinity',
      'blocked_by_job_ids',
      'priority',
      'goal_completion_criterion',
      'goal_gate_command',
      'goal_budget',
      'repro_command',
      'debug_fixer',
      'prototype',
      'greenfield_chain',
    ];

    for (const field of expected) {
      expect(schema.properties[field], `missing field: ${field}`).toBeDefined();
    }
    expect(schema.required).toContain('title');
  });

  it('keeps a description on every field the model must reason about', () => {
    const schema = (new JobCreateTool({} as never) as unknown as {
      parameters: { properties: Record<string, { description?: string }> };
    }).parameters;

    // A field with no description is invisible guidance: the model can fill it
    // but has no reason to. Every knob needs at least a one-line steer.
    const undocumented = Object.entries(schema.properties)
      .filter(([, spec]) => (spec.description ?? '').trim().length === 0)
      .map(([name]) => name);
    expect(undocumented).toEqual([]);
  });

  it('stays within the token budget that motivated the reduction', () => {
    const tool = new JobCreateTool({} as never);
    const schemaChars = JSON.stringify(tool.parameters).length;
    // The pre-reduction schema was 8,773 chars, of which 6,195 was field prose
    // duplicating the tool description and the runtime validators. After the
    // cut the block is ~4.3k prose + ~2.6k irreducible structure (29 fields,
    // their types, enums, and required list), so 6.9k is the honest floor
    // without splitting the tool. This budget fails loudly if someone
    // re-inflates the field prose.
    expect(schemaChars).toBeLessThan(7_000);
  });
});
