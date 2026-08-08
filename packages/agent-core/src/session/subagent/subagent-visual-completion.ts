/**
 * Completion-gate visual proof: when the worker forgot VerifySurface on a UI
 * change set, try once with a resolvable URL (summary http(s) or local HTML).
 */

import { pathToFileURL } from 'node:url';

import type { BrowserUseRuntime } from '@superliora/gui-use';
import type { Kaos } from '@superliora/kaos';
import { join } from 'pathe';

import {
  observeVerificationToolResult,
  type VerificationSensorLedger,
} from '../../sensors/verification-sensor-ledger';
import {
  VERIFY_SURFACE_TIMEOUT_MS,
  VerifySurfaceTool,
} from '../../tools/builtin/gui/verify-surface';
import type { VisualVerificationVerdict } from './subagent-result-contract';

const HTTP_URL_PATTERN = /https?:\/\/[^\s)"'<>]+/i;

/** Narrow host surface — avoids session→agent imports for layering. */
export interface AutoVerifySurfaceHost {
  readonly verificationSensorLedger: VerificationSensorLedger;
  readonly config: { readonly cwd: string };
  readonly toolServices?: { readonly browserUse?: BrowserUseRuntime | undefined } | undefined;
  readonly kaos: Kaos;
}

/**
 * Prefer an http(s) URL mentioned in the summary; else the first changed HTML
 * file as a file:// URL. Returns undefined when neither is available — the
 * contract stays `visual=not_run` (unverified), not a fake pass.
 */
export function resolveVerifySurfaceUrl(input: {
  readonly summary?: string | undefined;
  readonly filesChanged: readonly string[];
  readonly cwd: string;
}): string | undefined {
  const fromSummary = input.summary?.match(HTTP_URL_PATTERN)?.[0]?.replace(/[.,;:]+$/, '');
  if (fromSummary !== undefined && fromSummary.length > 0) return fromSummary;

  const html = input.filesChanged.find((file) => /\.html?$/i.test(file.replace(/\\/g, '/')));
  if (html === undefined) return undefined;
  const absolute = html.startsWith('/') || /^[A-Za-z]:[\\/]/.test(html) ? html : join(input.cwd, html);
  return pathToFileURL(absolute).href;
}

/**
 * Run VerifySurface when the sensor has not already recorded a verdict.
 * Updates the child's verification ledger so resolveVisualVerdict sees it.
 */
export async function maybeAutoVerifySurface(
  child: AutoVerifySurfaceHost,
  filesChanged: readonly string[],
  summary: string,
  signal: AbortSignal | undefined,
): Promise<VisualVerificationVerdict> {
  const observed = child.verificationSensorLedger.visualVerdict;
  if (observed === 'passed' || observed === 'failed') return observed;

  const url = resolveVerifySurfaceUrl({
    summary,
    filesChanged,
    cwd: child.config.cwd,
  });
  if (url === undefined) return 'not_run';

  const tool = new VerifySurfaceTool(child.toolServices?.browserUse, {
    kaos: child.kaos,
    cwd: child.config.cwd,
  });
  const args = { url };
  try {
    const execution = tool.resolveExecution(args);
    if (execution.isError === true) return 'not_run';
    // VerifySurface already applies VERIFY_SURFACE_TIMEOUT_MS; keep a parent
    // bound so completion-gate cancel still aborts promptly.
    const gateSignal =
      signal === undefined
        ? AbortSignal.timeout(VERIFY_SURFACE_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(VERIFY_SURFACE_TIMEOUT_MS)]);
    const result = await execution.execute({
      turnId: 'subagent-visual-verification',
      toolCallId: 'subagent-visual-verification',
      signal: gateSignal,
    });
    observeVerificationToolResult(child.verificationSensorLedger, 'VerifySurface', args, result);
    const after = child.verificationSensorLedger.visualVerdict;
    if (after === 'passed' || after === 'failed') return after;
    return 'not_run';
  } catch {
    return 'not_run';
  }
}
