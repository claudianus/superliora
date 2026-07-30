/**
 * GrepTool — content search via ripgrep.
 *
 * Shells out to `rg` through Kaos. Supports glob/type filtering, context
 * lines, output modes, pagination, multiline, and case-insensitive search.
 *
 * Path safety is enforced before any Kaos I/O. Explicit absolute paths outside
 * the workspace are allowed; relative paths that escape the workspace are
 * rejected.
 *
 * Output is bounded and post-processed before it reaches the model:
 *   - timeout and ambient abort both terminate the rg subprocess;
 *   - stdout/stderr are capped while streams continue draining;
 *   - hidden files are searched, but VCS metadata and common sensitive glob
 *     patterns are prefiltered where possible;
 *   - parsed path records are filtered again after rg returns, using the active
 *     backend path class.
 */

import type { Kaos } from '@superliora/kaos';

import type { BuiltinTool } from '../../../agent/tool';
import { isAbortError } from '../../../loop/errors';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { noopTelemetryClient, type TelemetryClient } from '../../../telemetry';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import { ensureRgPath, rgUnavailableMessage } from '../../support/rg-locator';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  SENSITIVE_GLOBS_TO_EXCLUDE,
  runRipgrepOnce,
  shouldRetryRipgrepEagain,
} from '../../support/run-rg';
import { ToolResultBuilder } from '../../support/result-builder';
import { appendTextToolMeta } from '../../support/text-result-meta';
import type { WorkspaceConfig } from '../../support/workspace';
import { buildRgArgs } from './grep-args';
import { formatRipgrepError } from './grep-errors';
import {
  filterSensitiveLines,
  formatCountSummary,
  formatDisplayLine,
  relativizeIfUnder,
} from './grep-format';
import { omitIncompleteTrailingRecord, parseRipgrepOutput } from './grep-parse';
import {
  DEFAULT_HEAD_LIMIT,
  GrepInputSchema,
  GrepOutputSchema,
  type GrepInput,
  type GrepOutput,
} from './grep-schema';
import { sortFilesWithMatchesByMtime } from './grep-sort';
import { GrepAbortedError, type ParsedGrepLine } from './grep-types';
import GREP_DESCRIPTION from './grep.md?raw';

export { GrepInputSchema, GrepOutputSchema, type GrepInput, type GrepOutput };

const GREP_ABORTED_MESSAGE = 'Grep aborted';

export class GrepTool implements BuiltinTool<GrepInput> {
  readonly name = 'Grep' as const;
  readonly description = GREP_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GrepInputSchema);
  private readonly telemetry: TelemetryClient;

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    telemetry: TelemetryClient = noopTelemetryClient,
  ) {
    this.telemetry = telemetry;
  }

  resolveExecution(args: GrepInput): ToolExecution {
    let path: string | undefined;
    if (args.path !== undefined) {
      path = resolvePathAccessPath(args.path, {
        kaos: this.kaos,
        workspace: this.workspace,
        operation: 'search',
        policy: { guardMode: 'absolute-outside-allowed', checkSensitive: false },
      });
    }
    const searchPaths = [path ?? this.workspace.workspaceDir];
    const searchPath = args.path ?? this.workspace.workspaceDir;
    return {
      accesses: ToolAccesses.searchTree(searchPaths[0]!),
      readOnly: true,
      description: `Searching for '${args.pattern}' in ${searchPath}`,
      display: { kind: 'file_io', operation: 'grep', path: searchPaths[0]! },
      approvalRule: literalRulePattern(this.name, args.pattern),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.pattern),
      execute: ({ signal }) => this.execution(args, signal, searchPaths),
    };
  }

  private async execution(
    args: GrepInput,
    signal: AbortSignal,
    searchPaths: string[],
  ): Promise<ExecutableToolResult> {
    if (signal.aborted) {
      return { isError: true, output: 'Aborted before search started' };
    }

    const pathClass = this.kaos.pathClass();
    let rgPath: string;
    try {
      const resolution = await ensureRgPath({ signal });
      rgPath = resolution.path;
      if (resolution.source !== 'system-path') {
        this.telemetry.track('grep_tool_rg_fallback', {
          source: resolution.source,
          outcome: 'resolved',
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { isError: true, output: GREP_ABORTED_MESSAGE };
      }
      this.telemetry.track('grep_tool_rg_fallback', { outcome: 'failed' });
      return { isError: true, output: rgUnavailableMessage(error) };
    }

    const rgOptions = { abortedMessage: GREP_ABORTED_MESSAGE };
    let runResult = await runRipgrepOnce(
      this.kaos,
      buildRgArgs(rgPath, args, searchPaths),
      signal,
      rgOptions,
    );
    if (runResult.kind === 'tool-error') return runResult.result;
    if (shouldRetryRipgrepEagain(runResult)) {
      runResult = await runRipgrepOnce(
        this.kaos,
        buildRgArgs(rgPath, args, searchPaths, true),
        signal,
        rgOptions,
      );
      if (runResult.kind === 'tool-error') return runResult.result;
    }

    const { exitCode, stderrText, bufferTruncated, stderrTruncated, timedOut } = runResult;
    let { stdoutText } = runResult;

    // rg exit codes: 0 = matches, 1 = no matches, 2 = error. Timeout kills
    // usually surface as a signal exit code; keep any complete partial records.
    if (exitCode !== 0 && exitCode !== 1 && !timedOut) {
      return {
        isError: true,
        output: formatRipgrepError(exitCode, stderrText, stderrTruncated),
      };
    }

    const mode = args.output_mode ?? 'files_with_matches';
    if (bufferTruncated || timedOut) {
      stdoutText = omitIncompleteTrailingRecord(stdoutText, mode);
    }
    if (timedOut && stdoutText.trim() === '') {
      return {
        isError: true,
        output: `Grep timed out after ${String(DEFAULT_TIMEOUT_MS / 1000)}s. Try a more specific path or pattern.`,
      };
    }
    if (signal.aborted) {
      return { isError: true, output: GREP_ABORTED_MESSAGE };
    }

    const rawLines = parseRipgrepOutput(stdoutText, mode);

    const filteredSensitive = new Set<string>();
    const keptLines = filterSensitiveLines(rawLines, mode, filteredSensitive, pathClass);
    let orderedLines: ParsedGrepLine[];
    try {
      orderedLines =
        mode === 'files_with_matches' && !timedOut && (args.sort ?? 'path') === 'modified_desc'
          ? await sortFilesWithMatchesByMtime(keptLines, this.kaos, signal)
          : keptLines;
    } catch (error) {
      if (error instanceof GrepAbortedError) {
        return { isError: true, output: GREP_ABORTED_MESSAGE };
      }
      throw error;
    }

    const offset = args.offset ?? 0;
    const headLimit = args.head_limit ?? DEFAULT_HEAD_LIMIT;
    const afterOffset = offset > 0 ? orderedLines.slice(offset) : orderedLines;
    const limitActive = headLimit > 0;
    const limited = limitActive ? afterOffset.slice(0, headLimit) : afterOffset;
    const paginationTruncated = limitActive && afterOffset.length > headLimit;

    // Notices ride in `output` (not `result.message`, which is dropped before the
    // result reaches the model). The count-mode aggregate — the total and the
    // "use offset=N to see more" cue — leads the output as a HEADER, written before
    // the rows, so ToolResultBuilder's char cap can only ever truncate the rows, not
    // the total (count rows are unbounded with head_limit: 0). Incidental notices
    // trail the body.
    const headerLines: string[] = [];
    const messages: string[] = [];
    if (filteredSensitive.size > 0) {
      const displayedFilteredPaths = [...filteredSensitive].map((path) =>
        relativizeIfUnder(path, this.workspace.workspaceDir, pathClass),
      );
      messages.push(
        `Filtered ${String(filteredSensitive.size)} sensitive file(s): ${displayedFilteredPaths.join(', ')}`,
      );
    }
    if (mode === 'count_matches' && orderedLines.length > 0) {
      headerLines.push(formatCountSummary(orderedLines, filteredSensitive.size > 0));
    }
    if (paginationTruncated) {
      const total = afterOffset.length + offset;
      const nextOffset = offset + headLimit;
      const paginationNotice = `Results truncated to ${String(headLimit)} lines (total: ${String(total)}). Use offset=${String(nextOffset)} to see more.`;
      if (mode === 'count_matches') {
        headerLines.push(paginationNotice);
      } else {
        messages.push(paginationNotice);
      }
    }
    if (bufferTruncated) {
      messages.push(
        `[stdout truncated at ${String(MAX_OUTPUT_BYTES)} bytes; incomplete trailing line omitted]`,
      );
    }
    if (timedOut) {
      messages.push(
        `Grep timed out after ${String(DEFAULT_TIMEOUT_MS / 1000)}s; partial results returned`,
      );
    }

    const contentIncludesLineNumbers = mode === 'content' && args['-n'] !== false;
    const displayedLines = limited.map((line) =>
      formatDisplayLine(
        line,
        mode,
        this.workspace.workspaceDir,
        pathClass,
        contentIncludesLineNumbers,
      ),
    );
    const contentBody = displayedLines.join('\n');
    const visibleBody =
      orderedLines.length === 0 && filteredSensitive.size > 0
        ? 'No non-sensitive matches found'
        : contentBody;
    const emptyResultMessage =
      SENSITIVE_GLOBS_TO_EXCLUDE.length > 0 ? 'No non-sensitive matches found' : 'No matches found';
    const body =
      visibleBody === '' && headerLines.length === 0 && messages.length === 0
        ? emptyResultMessage
        : visibleBody;
    const combined = [...headerLines, body, ...messages].filter((part) => part !== '').join('\n');

    const builder = new ToolResultBuilder();
    builder.write(combined);
    const result = builder.ok();
    return {
      ...result,
      output: appendTextToolMeta(result.output, {
        tool: this.name,
        mode,
        truncated: result.truncated || paginationTruncated || bufferTruncated,
        partial: timedOut || paginationTruncated || bufferTruncated,
        summary: `Grep returned ${String(orderedLines.length)} record(s) in mode=${mode}.`,
        stats: {
          results: orderedLines.length,
          filtered_sensitive: filteredSensitive.size,
          offset,
          head_limit: headLimit,
          sort: args.sort ?? 'path',
        },
        nextStep:
          mode === 'content'
            ? 'Use Read for exact file bytes or increase offset/head_limit to continue.'
            : 'Switch to output_mode=content to inspect exact matching lines.',
      }),
    };
  }
}
