import type {
  ComputerActInput as RuntimeComputerActInput,
  ComputerCaptureResult,
  ComputerUseRuntime,
} from '@moonshot-ai/gui-use';
import type { ContentPart } from '@moonshot-ai/kosong';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';

export const ComputerCaptureInputSchema = z.object({
  mode: z.enum(['som', 'vision', 'ax']).optional(),
  app: z.string().optional(),
  max_elements: z.number().int().min(1).max(1000).optional(),
});

export type ComputerCaptureInput = z.infer<typeof ComputerCaptureInputSchema>;

const ComputerActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click_element'),
    element: z.number().int().min(1),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.object({
    type: z.literal('click_xy'),
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.object({
    type: z.literal('double_click'),
    element: z.number().int().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    type: z.literal('drag'),
    from_element: z.number().int().min(1).optional(),
    to_element: z.number().int().min(1).optional(),
    from: z.object({ x: z.number(), y: z.number() }).optional(),
    to: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  z.object({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(50).optional(),
    element: z.number().int().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({ type: z.literal('type_text'), text: z.string() }),
  z.object({ type: z.literal('press_keys'), keys: z.string() }),
  z.object({ type: z.literal('set_value'), element: z.number().int().min(1), value: z.string() }),
  z.object({ type: z.literal('wait'), seconds: z.number().min(0).max(30).optional() }),
  z.object({ type: z.literal('focus_app'), app: z.string(), raise_window: z.boolean().optional() }),
]);

export const ComputerActInputSchema = z.object({
  actions: z.array(ComputerActionSchema).min(1).max(20),
  capture_after: z.boolean().optional(),
});

export type ComputerActInput = z.infer<typeof ComputerActInputSchema>;

const CAPTURE_DESCRIPTION = [
  'Capture a desktop window through cua-driver.',
  'Use ComputerStatus for runtime setup; do not install Playwright, Chromium, Chrome,',
  'or desktop automation stacks manually.',
  'mode=som returns a screenshot plus numbered interactable elements; prefer element indexes over raw coordinates.',
  'mode=vision returns only pixels; mode=ax returns accessibility text without an image.',
].join(' ');

const ACT_DESCRIPTION = [
  'Execute desktop actions through cua-driver against the active captured window.',
  'Call ComputerCapture first, then prefer click_element/set_value using SOM indexes.',
  'If setup fails, call ComputerStatus instead of installing Playwright, Chrome, or another GUI driver manually.',
  'This can interact with real desktop apps and should be treated as side-effectful.',
].join(' ');

const STATUS_DESCRIPTION = [
  'Report cua-driver computer-use installation and health status.',
  'Use this before any manual Playwright, Chrome, or GUI driver installation attempt.',
  'By default the runtime auto-installs cua-driver when it is missing.',
].join(' ');

export class ComputerCaptureTool implements BuiltinTool<ComputerCaptureInput> {
  readonly name = 'ComputerCapture' as const;
  readonly description = CAPTURE_DESCRIPTION;
  readonly parameters = toInputJsonSchema(ComputerCaptureInputSchema);

  constructor(private readonly runtime: ComputerUseRuntime) {}

  resolveExecution(args: ComputerCaptureInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: {
        kind: 'generic',
        summary: args.app === undefined ? 'Capture desktop window' : `Capture ${args.app}`,
      },
      description: 'Capturing desktop window',
      approvalRule: literalRulePattern(this.name, args.app ?? 'frontmost'),
      execute: async (ctx) => {
        try {
          const result = await this.runtime.capture({
            mode: args.mode,
            app: args.app,
            maxElements: args.max_elements,
          }, ctx.signal);
          return captureToResult(result);
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

export class ComputerActTool implements BuiltinTool<ComputerActInput> {
  readonly name = 'ComputerAct' as const;
  readonly description = ACT_DESCRIPTION;
  readonly parameters = toInputJsonSchema(ComputerActInputSchema);

  constructor(private readonly runtime: ComputerUseRuntime) {}

  resolveExecution(args: ComputerActInput): ToolExecution {
    const blocked = blockedComputerAction(args);
    if (blocked !== undefined) {
      return { isError: true, output: blocked };
    }

    return {
      accesses: ToolAccesses.all(),
      display: {
        kind: 'generic',
        summary: `Run ${String(args.actions.length)} desktop action${args.actions.length === 1 ? '' : 's'}`,
        detail: args.actions.map((action) => action.type),
      },
      description: `Running ${String(args.actions.length)} desktop actions`,
      approvalRule: literalRulePattern(this.name, args.actions.map((action) => action.type).join(',')),
      execute: async (ctx) => {
        try {
          const result = await this.runtime.act(toRuntimeActInput(args), ctx.signal);
          const builder = new ToolResultBuilder();
          builder.write(JSON.stringify(result, undefined, 2));
          return builder.ok();
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

export class ComputerStatusTool implements BuiltinTool<Record<string, never>> {
  readonly name = 'ComputerStatus' as const;
  readonly description = STATUS_DESCRIPTION;
  readonly parameters = toInputJsonSchema(z.object({}));

  constructor(private readonly runtime: ComputerUseRuntime) {}

  resolveExecution(): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: { kind: 'generic', summary: 'Check computer-use status' },
      description: 'Checking computer-use status',
      approvalRule: literalRulePattern(this.name, 'status'),
      execute: async (ctx) => {
        try {
          const status = await this.runtime.status(ctx.signal);
          const builder = new ToolResultBuilder();
          builder.write(JSON.stringify(status, undefined, 2));
          return status.installed ? builder.ok() : builder.error(status.error ?? 'cua-driver is not installed.');
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

function toRuntimeActInput(args: ComputerActInput): RuntimeComputerActInput {
  return {
    actions: args.actions.map((action) => {
      switch (action.type) {
        case 'drag':
          return {
            type: action.type,
            fromElement: action.from_element,
            toElement: action.to_element,
            from: action.from,
            to: action.to,
          };
        case 'focus_app':
          return {
            type: action.type,
            app: action.app,
            raiseWindow: action.raise_window,
          };
        default:
          return action;
      }
    }),
    captureAfter: args.capture_after,
  };
}

function captureToResult(result: ComputerCaptureResult): ExecutableToolResult {
  const text = JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    app: result.app,
    windowTitle: result.windowTitle,
    width: result.width,
    height: result.height,
    text: result.text,
    elements: result.elements,
    structuredContent: result.structuredContent,
    error: result.error,
  }, undefined, 2);

  if (result.image === undefined) {
    const builder = new ToolResultBuilder();
    builder.write(text);
    return result.ok ? builder.ok() : builder.error(result.error ?? 'Computer capture failed.');
  }

  return {
    output: [
      { type: 'text', text },
      {
        type: 'image_url',
        imageUrl: {
          url: `data:${result.image.mimeType};base64,${result.image.base64}`,
        },
      },
    ] satisfies ContentPart[],
    isError: result.ok ? undefined : true,
  };
}

function blockedComputerAction(args: ComputerActInput): string | undefined {
  for (const action of args.actions) {
    if (action.type === 'type_text') {
      const blocked = blockedTypedTextReason(action.text);
      if (blocked !== undefined) return `Blocked type_text: ${blocked}.`;
    }
    if (action.type === 'press_keys') {
      const blocked = blockedKeyComboReason(action.keys);
      if (blocked !== undefined) return `Blocked press_keys: ${blocked}.`;
    }
  }
  return undefined;
}

function blockedTypedTextReason(text: string): string | undefined {
  const patterns: readonly [RegExp, string][] = [
    [
      /\brm\s+-(?=[a-z]*r)(?=[a-z]*f)[a-z]*\s+(?:\/|~|\$HOME)(?:\s|$)/i,
      'dangerous recursive delete',
    ],
    [/\bsudo\s+rm\b/i, 'sudo delete command'],
    [/\bmkfs(?:\.[a-z0-9]+)?\b/i, 'filesystem formatting command'],
    [/\bdd\s+if=.*\bof=\/dev\//i, 'raw disk write'],
    [/\bdiskutil\s+(?:eraseDisk|partitionDisk)\b/i, 'disk erase or partition command'],
    [/\bformat\s+[a-z]:/i, 'Windows volume format command'],
    [/\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/i, 'system power command'],
    [/\bStop-Computer\b|\bRestart-Computer\b/i, 'PowerShell system power command'],
    [/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, 'fork bomb'],
  ];
  return patterns.find(([pattern]) => pattern.test(text))?.[1];
}

function blockedKeyComboReason(_keys: string): string | undefined {
  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
