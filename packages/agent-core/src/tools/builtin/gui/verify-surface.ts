/**
 * VerifySurface — BrowserStatus → observe → screenshot → console errors.
 *
 * Synthetic UI acceptance check. Never reports pass when browser-use is missing.
 */

import type { BrowserUseRuntime } from '@superliora/gui-use';
import type { Kaos } from '@superliora/kaos';
import { dirname, join } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import DESCRIPTION from './verify-surface.md?raw';

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
});

export type VerifySurfaceInput = z.infer<typeof VerifySurfaceInputSchema>;

export interface VerifySurfaceResult {
  readonly pass: boolean;
  readonly url?: string | undefined;
  readonly screenshotPath?: string | undefined;
  readonly consoleErrors: readonly string[];
  readonly notes: readonly string[];
}

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

    try {
      const status = await runtime.status(
        { installIfMissing: args.install_if_missing !== false },
        signal,
      );
      if (!status.installed || status.ready === false) {
        notes.push(status.error ?? 'Browser-use runtime is not ready.');
        return resultPayload({
          pass: false,
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
        signal,
      );
      if (!observation.ok) {
        notes.push(observation.error ?? 'Browser observe failed.');
        return resultPayload({
          pass: false,
          url: observation.url || url,
          screenshotPath,
          consoleErrors,
          notes,
        });
      }
      url = observation.url || url;
      const snapshotPreview = observation.snapshot.trim().slice(0, 400);
      notes.push(
        `Observed title=${JSON.stringify(observation.title)} refs=${String(observation.refs.length)}`,
      );
      if (snapshotPreview.length > 0) {
        notes.push(`Snapshot: ${snapshotPreview}`);
      }

      const screenshot = await runtime.screenshot({ fullPage: args.full_page }, signal);
      screenshotPath = await this.maybeWriteScreenshot(args.screenshot_path, screenshot);
      if (screenshotPath !== undefined) {
        notes.push(`Screenshot written to ${screenshotPath}`);
      } else {
        notes.push('Screenshot captured (not written to disk; no Kaos or write failed).');
      }

      try {
        const consoleResult = await runtime.console({}, signal);
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

      const pass = consoleErrors.length === 0;
      if (!pass) {
        notes.push(`Found ${String(consoleErrors.length)} console error(s).`);
      } else {
        notes.push('No console errors detected.');
      }

      return resultPayload({
        pass,
        url,
        screenshotPath,
        consoleErrors,
        notes,
      });
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
      return resultPayload({
        pass: false,
        url,
        screenshotPath,
        consoleErrors,
        notes,
      });
    }
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
    consoleErrors: [],
    notes: [MISSING_RUNTIME_MESSAGE],
  };
  // Pure JSON — no trailing error text after the object.
  return { isError: true, output: JSON.stringify(payload, undefined, 2) };
}

function resultPayload(payload: VerifySurfaceResult): ExecutableToolResult {
  return {
    isError: !payload.pass,
    output: JSON.stringify(payload, undefined, 2),
  };
}
