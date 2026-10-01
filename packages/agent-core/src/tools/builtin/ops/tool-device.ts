/**
 * `ToolDevice` — reach a tool whose schema is not in the request.
 *
 * With the tool-devices flag on, rarely-used tools keep their behaviour and
 * their permissions but leave the request's tool block, which is re-sent and
 * re-cached on every call. This transport is how the model still calls them:
 * `list` returns the inventory, `run` executes one.
 *
 * Approval is not re-implemented here. `run` resolves the target execution and
 * returns its `approvalRule`/`matchesRule`/`accesses`, so the permission
 * pipeline sees exactly what a direct call would have seen — a device must not
 * become a way around a rule that names the inner tool.
 */
import { z } from 'zod';

import type { Agent } from '../../../agent';
import type { BuiltinTool } from '../../../agent/tool';
import { TOOL_DEVICE_TOOL_NAME, isDeviceMountable } from '../../../agent/tool/core-tools';
import { ToolAccesses } from '../../../loop/tool-access';
import { validateExecutableToolArgs } from '../../../loop/tool-call-preflight';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './tool-device.md?raw';

export const ToolDeviceInputSchema = z
  .object({
    action: z.enum(['list', 'run']).describe("'list' the device inventory, or 'run' one entry."),
    name: z.string().trim().min(1).optional().describe('Tool name to run (action=run).'),
    arguments: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arguments object for the tool, exactly as a direct call would pass.'),
  })
  .strict();

export type ToolDeviceInput = z.infer<typeof ToolDeviceInputSchema>;

export class ToolDeviceTool implements BuiltinTool<ToolDeviceInput> {
  readonly name: string = TOOL_DEVICE_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ToolDeviceInputSchema);

  constructor(private readonly agent: Agent) {}

  /** Every tool this device can reach: instantiated, but out of the request block. */
  private reachable(): readonly BuiltinTool[] {
    const tools = this.agent.tools;
    const byName = new Map<string, BuiltinTool>();
    for (const tool of tools.builtinTools.values()) {
      // Only demoted tools: a core tool is already in the request, so routing
      // it here would be a second path to the same schema.
      if (tool.name === this.name || !isDeviceMountable(tool.name)) continue;
      byName.set(tool.name, tool);
    }
    return [...byName.values()].toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private find(name: string): BuiltinTool | undefined {
    return this.reachable().find((tool) => tool.name === name);
  }

  resolveExecution(args: ToolDeviceInput): ToolExecution | Promise<ToolExecution> {
    if (args.action === 'list') {
      return {
        accesses: ToolAccesses.none(),
        description: 'Listing device tools',
        approvalRule: this.name,
        execute: async () => ({
          output: this.renderInventory(),
        }),
      };
    }

    const name = args.name?.trim();
    if (name === undefined || name.length === 0) {
      return {
        isError: true,
        output: 'action=run requires "name". Use action=list to see the device inventory.',
      };
    }
    const target = this.find(name);
    if (target === undefined) {
      return {
        isError: true,
        output: `No device tool named "${name}". Use action=list to see the inventory.`,
      };
    }

    const innerArgs = args.arguments ?? {};
    const validationError = validateExecutableToolArgs(target, innerArgs);
    if (validationError !== null) {
      return { isError: true, output: `${name}: ${validationError}` };
    }
    // Delegate the whole execution contract, including the approval rule the
    // permission policies match on, to the target tool.
    const inner = target.resolveExecution(innerArgs);
    return Promise.resolve(inner).then((execution) => {
      if ('isError' in execution && execution.isError === true) return execution;
      return {
        ...execution,
        description: `${name}: ${execution.description}`,
      };
    });
  }

  private renderInventory(): string {
    const lines = ['Device tools (call with action=run):'];
    for (const tool of this.reachable()) {
      lines.push(`- ${tool.name}: ${firstSentence(tool.description)}`);
    }
    lines.push(
      'Each entry lists the parameters it accepts when run; the parameter schema is enforced on run.',
    );
    return lines.join('\n');
  }
}

function firstSentence(description: string): string {
  const trimmed = description.trim().replaceAll(/\s+/gu, ' ');
  const end = trimmed.indexOf('. ');
  return end === -1 ? trimmed.slice(0, 160) : trimmed.slice(0, end + 1);
}