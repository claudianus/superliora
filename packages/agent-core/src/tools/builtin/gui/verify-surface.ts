/**
 * VerifySurface — BrowserStatus → observe → screenshot → console errors.
 *
 * Synthetic UI acceptance check. Never reports pass when browser-use is missing.
 * Vision models get the screenshot attached; text-only models get an optional
 * vision-analyzer description in `visualDescription`.
 */

import type { BrowserAction, BrowserRef, BrowserUseRuntime } from '@superliora/gui-use';
import type { Kaos } from '@superliora/kaos';
import type { ContentPart } from '@superliora/kosong';
import { dirname, join } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { signalWithTimeout } from '../../../utils/abort';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import { auditSurfaceCraft } from './surface-craft-audit';
import DESCRIPTION from './verify-surface.md?raw';

/** Fail-fast wall clock for status→observe→screenshot→console (matches auto-verify gate). */
export const VERIFY_SURFACE_TIMEOUT_MS = 120_000;

export type SurfaceAxisVerdict = 'passed' | 'failed' | 'not_run';

const BrowserActionSchema = z.object({
  type: z.enum([
    'navigate',
    'click_ref',
    'click_xy',
    'type_text',
    'press_keys',
    'scroll',
    'drag',
    'wait',
    'back',
    'forward',
  ]),
  url: z.string().optional(),
  ref: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  keys: z.string().optional(),
  seconds: z.number().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().optional(),
  clear: z.boolean().optional(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  from: z.object({ x: z.number(), y: z.number() }).optional(),
  to: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const VerifySurfaceInputSchema = z.object({
  url: z
    .string()
    .optional()
    .describe('Optional URL to navigate to before observing the surface.'),
  full: z.boolean().optional().describe('Return a larger page text snapshot when observing.'),
  install_if_missing: z
    .boolean()
    .optional()
    .describe(
      'Prepare bundled browser-use runtimes when missing (BrowserStatus). Defaults to true.',
    ),
  full_page: z
    .boolean()
    .optional()
    .describe('Capture a full-page screenshot instead of the viewport.'),
  screenshot_path: z
    .string()
    .optional()
    .describe(
      'Optional path to write the screenshot file. Defaults to `.superliora/verify-surface/<timestamp>.png` when Kaos is available.',
    ),
  scenario: z
    .array(BrowserActionSchema)
    .max(12)
    .optional()
    .describe(
      'Optional bounded interaction actions. When omitted, VerifySurface synthesizes a short default smoke (click primary button/link).',
    ),
  skip_interaction: z
    .boolean()
    .optional()
    .describe('Skip interaction axis (load+craft only). Defaults false.'),
  craft_audit: z
    .boolean()
    .optional()
    .describe('Run banned-ship craft audit on snapshot/description. Defaults true.'),
});

export type VerifySurfaceInput = z.infer<typeof VerifySurfaceInputSchema>;

export interface VerifySurfaceAxes {
  readonly load: SurfaceAxisVerdict;
  readonly interaction: SurfaceAxisVerdict;
  readonly craft: SurfaceAxisVerdict;
}

export interface VerifySurfaceResult {
  readonly pass: boolean;
  readonly axes: VerifySurfaceAxes;
  readonly url?: string | undefined;
  readonly screenshotPath?: string | undefined;
  readonly consoleErrors: readonly string[];
  readonly notes: readonly string[];
  readonly craftHits?: readonly string[] | undefined;
  /** Text description when the chat model cannot consume the screenshot image. */
  readonly visualDescription?: string | undefined;
}

export type VerifySurfaceVisionFallback = (input: {
  readonly mimeType: string;
  readonly base64: string;
  readonly screenshotPath?: string | undefined;
  readonly signal: AbortSignal;
}) => Promise<string | undefined>;

const MISSING_RUNTIME_MESSAGE =
  'Browser-use runtime is not available. VerifySurface requires a healthy browser-use runtime (CloakBrowser primary, Camoufox secondary, Lightpanda tertiary where supported). Do not treat this as a pass.';

export class VerifySurfaceTool implements BuiltinTool<VerifySurfaceInput> {
  readonly name = 'VerifySurface' as const;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(VerifySurfaceInputSchema);

  constructor(
    private readonly runtime: BrowserUseRuntime | undefined,
    private readonly options?: {
      readonly kaos?: Kaos | undefined;
      readonly workspace?: WorkspaceConfig | undefined;
      readonly cwd?: string | undefined;
      /** When true, attach the screenshot as an image tool part (vision chat models). */
      readonly attachScreenshotImage?: boolean | undefined;
      /** Describe the screenshot for text-only chat models. */
      readonly visionFallback?: VerifySurfaceVisionFallback | undefined;
    },
  ) {}

  resolveExecution(args: VerifySurfaceInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      display: {
        kind: 'generic',
        summary: args.url === undefined ? 'Verify UI surface' : `Verify surface ${args.url}`,
      },
      description:
        args.url === undefined ? 'Verifying UI surface' : `Verifying UI surface at ${args.url}`,
      approvalRule: literalRulePattern(this.name, args.url ?? 'current'),
      execute: async (ctx) => this.execution(args, ctx.signal),
    };
  }

  private async execution(
    args: VerifySurfaceInput,
    signal: AbortSignal,
  ): Promise<ExecutableToolResult> {
    const runtime = this.runtime;
    if (runtime === undefined) {
      return missingRuntimeResult();
    }

    const notes: string[] = [];
    const consoleErrors: string[] = [];
    let url: string | undefined = args.url;
    let screenshotPath: string | undefined;
    const gate = signalWithTimeout(VERIFY_SURFACE_TIMEOUT_MS, signal);

    try {
      const status = await runtime.status(
        { installIfMissing: args.install_if_missing !== false },
        gate,
      );
      if (!status.installed || status.ready === false) {
        notes.push(status.error ?? 'Browser-use runtime is not ready.');
        return resultPayload({
          pass: false,
          axes: { load: 'failed', interaction: 'not_run', craft: 'not_run' },
          url,
          screenshotPath,
          consoleErrors,
          notes: [
            ...notes,
            'VerifySurface failed: browser runtime missing or not ready (not a fake pass).',
          ],
        });
      }
      notes.push(
        `Browser runtime ready${status.provider !== undefined ? ` (${status.provider})` : ''}${status.version !== undefined ? ` ${status.version}` : ''}.`,
      );

      const observation = await runtime.observe(
        {
          url: args.url,
          full: args.full,
          includeScreenshot: false,
        },
        gate,
      );
      if (!observation.ok) {
        notes.push(observation.error ?? 'Browser observe failed.');
        return resultPayload({
          pass: false,
          axes: { load: 'failed', interaction: 'not_run', craft: 'not_run' },
          url: observation.url || url,
          screenshotPath,
          consoleErrors,
          notes,
        });
      }
      url = observation.url || url;
      let snapshot = observation.snapshot;
      let title = observation.title;
      let refs = observation.refs;
      const snapshotPreview = snapshot.trim().slice(0, 400);
      notes.push(
        `Observed title=${JSON.stringify(title)} refs=${String(refs.length)}`,
      );
      if (snapshotPreview.length > 0) {
        notes.push(`Snapshot: ${snapshotPreview}`);
      }

      await collectConsoleErrors(runtime, gate, consoleErrors, notes);
      const load: SurfaceAxisVerdict = consoleErrors.length === 0 ? 'passed' : 'failed';
      notes.push(
        load === 'passed'
          ? 'Axis load: passed (no console errors).'
          : `Axis load: failed (${String(consoleErrors.length)} console error(s)).`,
      );

      let interaction: SurfaceAxisVerdict = 'not_run';
      if (args.skip_interaction === true) {
        notes.push('Axis interaction: skipped.');
      } else {
        const actions = resolveScenarioActions(args.scenario, refs);
        if (actions.length === 0) {
          interaction = 'failed';
          notes.push(
            'Axis interaction: failed — no clickable affordance (button/link/textbox) and no scenario provided.',
          );
        } else {
          const actResult = await runtime.act({ actions, captureAfter: true }, gate);
          if (!actResult.ok) {
            interaction = 'failed';
            notes.push('Axis interaction: failed — BrowserAct reported ok=false.');
          } else {
            const after = actResult.observation;
            if (after !== undefined && after.ok) {
              snapshot = after.snapshot;
              title = after.title;
              refs = after.refs;
              url = after.url || url;
            }
            const beforeLen = consoleErrors.length;
            await collectConsoleErrors(runtime, gate, consoleErrors, notes);
            interaction =
              actResult.actions.every((step) => step.ok) && consoleErrors.length === beforeLen
                ? 'passed'
                : 'failed';
            notes.push(
              interaction === 'passed'
                ? `Axis interaction: passed (${String(actions.length)} action(s)).`
                : 'Axis interaction: failed — action error or new console errors after act.',
            );
          }
        }
      }

      const screenshot = await runtime.screenshot({ fullPage: args.full_page }, gate);
      screenshotPath = await this.maybeWriteScreenshot(args.screenshot_path, screenshot);
      if (screenshotPath !== undefined) {
        notes.push(`Screenshot written to ${screenshotPath}`);
      } else {
        notes.push('Screenshot captured (not written to disk; no Kaos or write failed).');
      }

      const media = await this.resolveScreenshotMedia(screenshot, screenshotPath, gate, notes);
      let craft: SurfaceAxisVerdict = 'not_run';
      let craftHits: readonly string[] | undefined;
      if (args.craft_audit === false) {
        notes.push('Axis craft: skipped.');
      } else {
        const audit = auditSurfaceCraft({
          snapshot,
          title,
          visualDescription: media.visualDescription,
        });
        craft = audit.pass ? 'passed' : 'failed';
        craftHits = audit.hits;
        notes.push(...audit.notes);
        notes.push(`Axis craft: ${craft}.`);
      }

      const pass =
        load === 'passed' &&
        (args.skip_interaction === true || interaction === 'passed') &&
        (args.craft_audit === false || craft === 'passed');

      return resultPayload(
        {
          pass,
          axes: { load, interaction, craft },
          url,
          screenshotPath,
          consoleErrors,
          notes,
          craftHits,
          visualDescription: media.visualDescription,
        },
        media.attachImage ? screenshot : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (gate.aborted && !signal.aborted) {
        notes.push(
          `VerifySurface timed out after ${String(VERIFY_SURFACE_TIMEOUT_MS / 1000)}s (fail-fast; not a pass). ${message}`,
        );
      } else {
        notes.push(message);
      }
      return resultPayload({
        pass: false,
        axes: { load: 'failed', interaction: 'not_run', craft: 'not_run' },
        url,
        screenshotPath,
        consoleErrors,
        notes,
      });
    }
  }

  private async resolveScreenshotMedia(
    screenshot: { readonly base64: string; readonly mimeType: string },
    screenshotPath: string | undefined,
    signal: AbortSignal,
    notes: string[],
  ): Promise<{
    readonly attachImage: boolean;
    readonly visualDescription?: string | undefined;
  }> {
    if (this.options?.attachScreenshotImage === true) {
      return { attachImage: true };
    }
    const fallback = this.options?.visionFallback;
    if (fallback === undefined) {
      notes.push(
        'Screenshot captured; chat model cannot consume images and no vision analyzer is configured.',
      );
      return { attachImage: false };
    }
    const visualDescription = await fallback({
      mimeType: screenshot.mimeType,
      base64: screenshot.base64,
      screenshotPath,
      signal,
    });
    if (visualDescription === undefined || visualDescription.trim().length === 0) {
      notes.push('Vision analyzer could not describe the screenshot; inspect the path offline.');
      return { attachImage: false };
    }
    notes.push('Visual description from vision analyzer (chat model is text-only).');
    return { attachImage: false, visualDescription: visualDescription.trim() };
  }

  private async maybeWriteScreenshot(
    requestedPath: string | undefined,
    screenshot: { readonly base64: string; readonly mimeType: string },
  ): Promise<string | undefined> {
    const kaos = this.options?.kaos;
    if (kaos === undefined) return undefined;
    const cwd = this.options?.cwd ?? this.options?.workspace?.workspaceDir ?? kaos.getcwd();
    const relative =
      requestedPath?.trim() && requestedPath.trim().length > 0
        ? requestedPath.trim()
        : join('.superliora', 'verify-surface', `surface-${String(Date.now())}.png`);
    const path =
      relative.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relative)
        ? relative
        : join(cwd, relative);
    try {
      const parent = dirname(path);
      if (parent.length > 0 && parent !== path) {
        await kaos.mkdir(parent, { parents: true, existOk: true });
      }
      const bytes = Buffer.from(screenshot.base64, 'base64');
      await kaos.writeBytes(path, bytes);
      return path;
    } catch {
      return undefined;
    }
  }
}

function missingRuntimeResult(): ExecutableToolResult {
  const payload: VerifySurfaceResult = {
    pass: false,
    axes: { load: 'failed', interaction: 'not_run', craft: 'not_run' },
    consoleErrors: [],
    notes: [MISSING_RUNTIME_MESSAGE],
  };
  // Pure JSON — no trailing error text after the object.
  return { isError: true, output: JSON.stringify(payload, undefined, 2) };
}

async function collectConsoleErrors(
  runtime: BrowserUseRuntime,
  gate: AbortSignal,
  consoleErrors: string[],
  notes: string[],
): Promise<void> {
  try {
    const consoleResult = await runtime.console({}, gate);
    if (consoleResult.ok) {
      for (const message of consoleResult.messages) {
        const type = message.type.toLowerCase();
        if (type === 'error' || type === 'assert' || type === 'exception') {
          consoleErrors.push(`[${message.type}] ${message.text}`);
        }
      }
    } else if (consoleResult.error !== undefined) {
      notes.push(`Console read warning: ${consoleResult.error}`);
    }
  } catch (error) {
    notes.push(
      `Console collection unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveScenarioActions(
  scenario: VerifySurfaceInput['scenario'],
  refs: readonly BrowserRef[],
): BrowserAction[] {
  if (scenario !== undefined && scenario.length > 0) {
    return scenario.map(coerceBrowserAction).filter((a): a is BrowserAction => a !== undefined);
  }
  const preferred = refs.find((ref) => /button|link|textbox|searchbox/i.test(ref.role));
  if (preferred === undefined) return [];
  return [
    { type: 'click_ref', ref: preferred.ref },
    { type: 'wait', seconds: 0.4 },
  ];
}

function coerceBrowserAction(
  raw: z.infer<typeof BrowserActionSchema>,
): BrowserAction | undefined {
  switch (raw.type) {
    case 'navigate':
      return raw.url !== undefined ? { type: 'navigate', url: raw.url } : undefined;
    case 'click_ref':
      return raw.ref !== undefined ? { type: 'click_ref', ref: raw.ref } : undefined;
    case 'click_xy':
      return raw.x !== undefined && raw.y !== undefined
        ? { type: 'click_xy', x: raw.x, y: raw.y, button: raw.button }
        : undefined;
    case 'type_text':
      return raw.text !== undefined
        ? { type: 'type_text', text: raw.text, ref: raw.ref, clear: raw.clear }
        : undefined;
    case 'press_keys':
      return raw.keys !== undefined ? { type: 'press_keys', keys: raw.keys } : undefined;
    case 'scroll':
      return raw.direction !== undefined
        ? {
            type: 'scroll',
            direction: raw.direction,
            amount: raw.amount,
            x: raw.x,
            y: raw.y,
          }
        : undefined;
    case 'drag':
      return raw.from !== undefined && raw.to !== undefined
        ? { type: 'drag', from: raw.from, to: raw.to, button: raw.button }
        : undefined;
    case 'wait':
      return { type: 'wait', seconds: raw.seconds };
    case 'back':
      return { type: 'back' };
    case 'forward':
      return { type: 'forward' };
    default:
      return undefined;
  }
}

function resultPayload(
  payload: VerifySurfaceResult,
  screenshot?: { readonly mimeType: string; readonly base64: string } | undefined,
): ExecutableToolResult {
  const text = JSON.stringify(payload, undefined, 2);
  if (screenshot === undefined) {
    return {
      isError: !payload.pass,
      output: text,
    };
  }
  return {
    isError: !payload.pass,
    output: [
      { type: 'text', text },
      {
        type: 'image_url',
        imageUrl: {
          url: `data:${screenshot.mimeType};base64,${screenshot.base64}`,
        },
      },
    ] satisfies ContentPart[],
  };
}
