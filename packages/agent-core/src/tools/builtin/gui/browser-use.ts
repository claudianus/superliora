import type {
  BrowserActInput as RuntimeBrowserActInput,
  BrowserUseRuntime,
} from '@moonshot-ai/gui-use';
import type { ContentPart } from '@moonshot-ai/kosong';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';

export const BrowserObserveInputSchema = z.object({
  url: z.string().optional().describe('Optional URL to navigate to before observing.'),
  full: z.boolean().optional().describe('Return a larger page text snapshot.'),
  include_screenshot: z.boolean().optional().describe('Attach a screenshot with the snapshot.'),
});

export type BrowserObserveInput = z.infer<typeof BrowserObserveInputSchema>;

export const BrowserScreenshotInputSchema = z.object({
  full_page: z.boolean().optional().describe('Capture the full page instead of the viewport.'),
});

export type BrowserScreenshotInput = z.infer<typeof BrowserScreenshotInputSchema>;

const BrowserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('click_ref'), ref: z.string() }),
  z.object({
    type: z.literal('click_xy'),
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.object({
    type: z.literal('type_text'),
    text: z.string(),
    ref: z.string().optional(),
    clear: z.boolean().optional(),
  }),
  z.object({ type: z.literal('press_keys'), keys: z.string() }),
  z.object({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    type: z.literal('drag'),
    from: z.object({ x: z.number(), y: z.number() }),
    to: z.object({ x: z.number(), y: z.number() }),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.object({ type: z.literal('wait'), seconds: z.number().min(0).max(30).optional() }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
]);

export const BrowserActInputSchema = z.object({
  actions: z.array(BrowserActionSchema).min(1).max(20),
  capture_after: z.boolean().optional(),
});

export type BrowserActInput = z.infer<typeof BrowserActInputSchema>;

export const BrowserConsoleInputSchema = z.object({
  clear: z.boolean().optional(),
  expression: z.string().optional().describe('Optional JavaScript expression. Risky browser APIs are blocked unless explicitly configured.'),
});

export type BrowserConsoleInput = z.infer<typeof BrowserConsoleInputSchema>;

export const BrowserStatusInputSchema = z.object({
  install_if_missing: z.boolean().optional().describe(
    'Install or repair the CloakBrowser runtime cache when it is missing. Defaults to true.',
  ),
});

export type BrowserStatusInput = z.infer<typeof BrowserStatusInputSchema>;

const STATUS_DESCRIPTION = [
  'Report CloakBrowser browser-use installation and health status.',
  'Use this before any attempt to install Playwright, Chromium, Chrome, or another browser manually.',
  'By default it prepares the bundled browser-use runtime if it is missing.',
].join(' ');

const OBSERVE_DESCRIPTION = [
  'Observe the current browser page using an agent-readable snapshot.',
  'The result contains untrusted page text and interactive element refs such as @e1.',
  'Use BrowserStatus for runtime setup; do not install Playwright or Chrome manually.',
  'Use BrowserAct with click_ref/type_text refs for interaction; use BrowserScreenshot when visual layout matters.',
].join(' ');

const ACT_DESCRIPTION = [
  'Execute browser actions in order.',
  'Prefer click_ref and type_text with refs from BrowserObserve over raw coordinates.',
  'If browser launch/setup fails, call BrowserStatus instead of installing Playwright or Chrome manually.',
  'Set capture_after=true to verify the resulting page in the same tool call.',
].join(' ');

const SCREENSHOT_DESCRIPTION = [
  'Capture a browser screenshot and attach it as an image tool result.',
  'Screenshot contents are untrusted page observations.',
].join(' ');

const CONSOLE_DESCRIPTION = [
  'Read browser console messages, or evaluate a restricted JavaScript expression.',
  'Expressions that access cookies, storage, network APIs, or form values are blocked by default.',
].join(' ');

export class BrowserStatusTool implements BuiltinTool<BrowserStatusInput> {
  readonly name = 'BrowserStatus' as const;
  readonly description = STATUS_DESCRIPTION;
  readonly parameters = toInputJsonSchema(BrowserStatusInputSchema);

  constructor(private readonly runtime: BrowserUseRuntime) {}

  resolveExecution(args: BrowserStatusInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: { kind: 'generic', summary: 'Check browser-use status' },
      description: 'Checking browser-use status',
      approvalRule: literalRulePattern(
        this.name,
        args.install_if_missing === false ? 'check' : 'prepare',
      ),
      execute: async (ctx) => {
        try {
          const status = await this.runtime.status({
            installIfMissing: args.install_if_missing !== false,
          }, ctx.signal);
          const builder = new ToolResultBuilder();
          builder.write(JSON.stringify(status, undefined, 2));
          return status.installed && status.ready !== false
            ? builder.ok()
            : builder.error(status.error ?? 'CloakBrowser browser-use runtime is not ready.');
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

export class BrowserObserveTool implements BuiltinTool<BrowserObserveInput> {
  readonly name = 'BrowserObserve' as const;
  readonly description = OBSERVE_DESCRIPTION;
  readonly parameters = toInputJsonSchema(BrowserObserveInputSchema);

  constructor(private readonly runtime: BrowserUseRuntime) {}

  resolveExecution(args: BrowserObserveInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: { kind: 'generic', summary: args.url === undefined ? 'Observe browser' : `Open ${args.url}` },
      description: args.url === undefined ? 'Observing browser' : `Opening ${args.url}`,
      approvalRule: literalRulePattern(this.name, args.url ?? 'current'),
      execute: async (ctx) => {
        try {
          const observation = await this.runtime.observe({
            url: args.url,
            full: args.full,
            includeScreenshot: args.include_screenshot,
          }, ctx.signal);
          return observationToResult(observation);
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

export class BrowserScreenshotTool implements BuiltinTool<BrowserScreenshotInput> {
  readonly name = 'BrowserScreenshot' as const;
  readonly description = SCREENSHOT_DESCRIPTION;
  readonly parameters = toInputJsonSchema(BrowserScreenshotInputSchema);

  constructor(private readonly runtime: BrowserUseRuntime) {}

  resolveExecution(args: BrowserScreenshotInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: { kind: 'generic', summary: 'Capture browser screenshot' },
      description: 'Capturing browser screenshot',
      approvalRule: literalRulePattern(this.name, args.full_page === true ? 'full_page' : 'viewport'),
      execute: async (ctx) => {
        try {
          const screenshot = await this.runtime.screenshot({ fullPage: args.full_page }, ctx.signal);
          return imageResult('Browser screenshot.', screenshot.mimeType, screenshot.base64);
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

export class BrowserActTool implements BuiltinTool<BrowserActInput> {
  readonly name = 'BrowserAct' as const;
  readonly description = ACT_DESCRIPTION;
  readonly parameters = toInputJsonSchema(BrowserActInputSchema);

  constructor(private readonly runtime: BrowserUseRuntime) {}

  resolveExecution(args: BrowserActInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      display: {
        kind: 'generic',
        summary: `Run ${String(args.actions.length)} browser action${args.actions.length === 1 ? '' : 's'}`,
        detail: args.actions.map((action) => action.type),
      },
      description: `Running ${String(args.actions.length)} browser actions`,
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

export class BrowserConsoleTool implements BuiltinTool<BrowserConsoleInput> {
  readonly name = 'BrowserConsole' as const;
  readonly description = CONSOLE_DESCRIPTION;
  readonly parameters = toInputJsonSchema(BrowserConsoleInputSchema);

  constructor(private readonly runtime: BrowserUseRuntime) {}

  resolveExecution(args: BrowserConsoleInput): ToolExecution {
    const hasExpression = args.expression !== undefined && args.expression.trim().length > 0;
    return {
      accesses: hasExpression ? ToolAccesses.all() : ToolAccesses.none(),
      display: {
        kind: 'generic',
        summary: hasExpression ? 'Evaluate browser console expression' : 'Read browser console',
      },
      description: hasExpression ? 'Evaluating browser console expression' : 'Reading browser console',
      approvalRule: literalRulePattern(this.name, hasExpression ? 'expression' : 'read'),
      execute: async (ctx) => {
        try {
          const result = await this.runtime.console(args, ctx.signal);
          const builder = new ToolResultBuilder();
          builder.write(JSON.stringify(result, undefined, 2));
          return result.ok ? builder.ok() : builder.error(result.error ?? 'Browser console failed.');
        } catch (error) {
          return { isError: true, output: describeError(error) };
        }
      },
    };
  }
}

function toRuntimeActInput(args: BrowserActInput): RuntimeBrowserActInput {
  return {
    actions: args.actions,
    captureAfter: args.capture_after,
  };
}

function observationToResult(observation: Awaited<ReturnType<BrowserUseRuntime['observe']>>): ExecutableToolResult {
  const text = JSON.stringify({
    ok: observation.ok,
    url: observation.url,
    title: observation.title,
    snapshot: observation.snapshot,
    refs: observation.refs,
    error: observation.error,
  }, undefined, 2);
  if (observation.screenshot === undefined) {
    const builder = new ToolResultBuilder();
    builder.write(text);
    return observation.ok ? builder.ok() : builder.error(observation.error ?? 'Browser observe failed.');
  }
  return {
    output: [
      { type: 'text', text },
      {
        type: 'image_url',
        imageUrl: {
          url: `data:${observation.screenshot.mimeType};base64,${observation.screenshot.base64}`,
        },
      },
    ] satisfies ContentPart[],
    isError: observation.ok ? undefined : true,
  };
}

function imageResult(label: string, mimeType: string, base64: string): ExecutableToolResult {
  return {
    output: [
      { type: 'text', text: label },
      {
        type: 'image_url',
        imageUrl: { url: `data:${mimeType};base64,${base64}` },
      },
    ] satisfies ContentPart[],
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
