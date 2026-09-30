/**
 * WriteTool — overwrite or append to a file.
 *
 * Creates the file if it does not exist. Missing parent directories are
 * created automatically, mirroring `mkdir(parents=True, exist_ok=True)`.
 * Path access policy is resolved before any Kaos I/O.
 */

import type { Kaos } from '@superliora/kaos';
import { dirname } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { FileProvenanceHook } from '../../../session/file-provenance';
import type { FileSnapshotStore } from '../../../session/file-snapshot';
import { checkSwarmFileLease } from '#/fleet';
import { refineSandboxPathForExecute, resolvePathAccessPath } from '../../policies/path-access';
import {
  FABRICATED_DEFER_BLOCKED_MESSAGE,
  hasFabricatedDeferral,
} from '../../support/fabricated-defer';
import { hasUtf16Bom, utf16BomKind } from '../../support/file-type';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import WRITE_DESCRIPTION from './write.md?raw';
import { diskFullToolError } from '#/runtime/disk-pressure';

/** Re-encode text for a UTF-16 target, keeping its byte order and its mark. */
function encodeUtf16(text: string, kind: 'utf16le' | 'utf16be'): Buffer {
  const body = Buffer.from(text, 'utf16le');
  const bytes = kind === 'utf16le' ? body : Buffer.from(body).swap16();
  return Buffer.concat([
    Buffer.from(kind === 'utf16le' ? [0xff, 0xfe] : [0xfe, 0xff]),
    bytes,
  ]);
}

/** Mask isolating the file-type bits of a stat mode. */
const S_IFMT = 0o170000;
/** File-type bits of a directory. */
const S_IFDIR = 0o040000;

export const WriteInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to the file to create, append to, or completely overwrite. Relative paths resolve against the working directory; a path outside the working directory must be absolute. Missing parent directories are created automatically.',
    ),
  content: z
    .string()
    .describe(
      'Raw full file content to write exactly as provided. This does not use the Read/Edit text view.',
    ),
  mode: z
    .enum(['overwrite', 'append'])
    .optional()
    .describe(
      'Write mode. Defaults to overwrite. append adds content to the end exactly as provided and does not add a newline.',
    ),
});

export const WriteOutputSchema = z.object({
  /** Number of UTF-8 bytes written to disk by this call. */
  bytesWritten: z.number().int().nonnegative(),
});

export type WriteInput = z.Infer<typeof WriteInputSchema>;
export type WriteOutput = z.Infer<typeof WriteOutputSchema>;

export class WriteTool implements BuiltinTool<WriteInput> {
  readonly name = 'Write' as const;
  readonly description = WRITE_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WriteInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly options?: {
      readonly fileSnapshots?: FileSnapshotStore | undefined;
      readonly turnId?: string | undefined;
      /** Resolved at execution time so the active turn id is current. */
      readonly getTurnId?: (() => string | undefined) | undefined;
      /**
       * Optional file-lease identity. When owner/run are present,
       * claims the path before mutation; conflicts return an error tool result.
       * When absent, Write behaves as before (no-op lease).
       */
      readonly getSwarmLease?:
        | (() => { readonly ownerId?: string; readonly runId?: string } | undefined)
        | undefined;
      /** Optional post-mutation hook (e.g. plugin LSP diagnostics). */
      readonly onFileMutated?:
        | ((path: string, content: string) => Promise<string | undefined> | string | undefined)
        | undefined;
      /** Optional file-provenance recorder (session attribution trail). */
      readonly provenance?: FileProvenanceHook | undefined;
    },
  ) {}

  resolveExecution(args: WriteInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.writeFile(path),
      description: `Writing ${args.path}`,
      display: { kind: 'file_io', operation: 'write', path, content: args.content },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: this.workspace.workspaceDir,
          pathClass: this.kaos.pathClass(),
          homeDir: this.kaos.gethome(),
        }),
      execute: async () => {
        const refined = await refineSandboxPathForExecute(path, {
          kaos: this.kaos,
          workspace: this.workspace,
          rawPath: args.path,
        });
        if (!refined.ok) return { isError: true, output: refined.output };
        return this.execution(args, refined.path);
      },
    };
  }

  /**
   * Byte-order mark of an existing target, or `false` when it is not UTF-16 text
   * (including a file that does not exist yet).
   */
  private async readUtf16Prefix(safePath: string): Promise<'utf16le' | 'utf16be' | false> {
    try {
      return utf16BomKind(await this.kaos.readBytes(safePath, 2)) ?? false;
    } catch {
      // Missing file (append/create) or unreadable prefix: nothing to preserve,
      // and the write itself will report the real failure.
      return false;
    }
  }

  private async execution(args: WriteInput, safePath: string): Promise<ExecutableToolResult> {
    if (hasFabricatedDeferral(args.content)) {
      return { isError: true, output: FABRICATED_DEFER_BLOCKED_MESSAGE };
    }

    const lease = this.options?.getSwarmLease?.();
    const leaseError = checkSwarmFileLease(safePath, lease?.ownerId, lease?.runId);
    if (leaseError !== undefined) {
      return { isError: true, output: leaseError };
    }

    const parentError = await this.ensureParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    const snapshots = this.options?.fileSnapshots;
    const turnId = this.options?.getTurnId?.() ?? this.options?.turnId;
    if (snapshots !== undefined && turnId !== undefined) {
      await snapshots.captureBeforeWrite(turnId, safePath);
    }

    // Provenance needs the real before-state per mutation (the snapshot
    // capture is first-write-wins per turn, not per call).
    const provenance = this.options?.provenance;
    let beforeContent: string | null = null;
    if (provenance !== undefined) {
      try {
        beforeContent = await this.kaos.readText(safePath);
      } catch {
        beforeContent = null;
      }
    }

    try {
      const mode = args.mode ?? 'overwrite';
      if (mode === 'append') {
        // Appending UTF-8 bytes to a UTF-16 file produces mojibake: the file
        // keeps its byte-order mark and the new bytes re-read as garbage.
        // Refuse instead of corrupting it.
        const utf16 = await this.readUtf16Prefix(safePath);
        if (utf16) {
          return {
            isError: true,
            output: `"${args.path}" is UTF-16 text; appending would write UTF-8 bytes into it and corrupt the file. Rewrite it with mode: overwrite, or convert it first.`,
          };
        }
        await this.kaos.writeText(safePath, args.content, { mode: 'a' });
      } else {
        // A file's encoding is part of the file: rewriting a UTF-16 script as
        // UTF-8 (no mark) makes Windows PowerShell 5.1 read it as ANSI.
        const utf16 = await this.readUtf16Prefix(safePath);
        await this.kaos.writeAtomic(
          safePath,
          utf16 === false ? args.content : encodeUtf16(args.content, utf16),
        );
      }
      await provenance?.record({
        path: safePath,
        tool: this.name,
        op:
          beforeContent === null
            ? 'create'
            : mode === 'append'
              ? 'append'
              : 'overwrite',
        before: beforeContent,
        after: args.content,
      });
      // Report the number of UTF-8 bytes this call wrote to disk. The string
      // length would only equal the byte count for pure ASCII content, so it
      // is not used here.
      const bytesWritten = Buffer.byteLength(args.content, 'utf8');
      const base = `${mode === 'append' ? 'Appended' : 'Wrote'} ${String(bytesWritten)} bytes to ${args.path}`;
      const extra = await this.options?.onFileMutated?.(safePath, args.content);
      return {
        output:
          extra !== undefined && extra.trim() !== '' ? `${base}\n\n${extra.trim()}` : base,
      };
    } catch (error) {
      const disk = await diskFullToolError(error);
      if (disk !== undefined) return { isError: true, output: disk };
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'ENOENT') {
        return {
          isError: true,
          output: `Failed to write ${args.path}: parent directory does not exist.`,
        };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Best-effort check that the parent directory is usable, creating it when
   * it is missing.
   *
   * If the parent (or any ancestor) does not exist, it is created
   * recursively — mirroring Python's `Path.mkdir(parents=True,
   * exist_ok=True)` — so the agent does not need a separate `mkdir` round
   * trip before writing into a fresh subfolder. An existing parent that is
   * not a directory is still a hard error. Any other `stat` failure
   * (permissions, an environment without `stat`) is treated as
   * inconclusive: the check is skipped and the write proceeds, surfacing
   * the real I/O error if any.
   *
   * Returns an error string when the precondition is definitively violated,
   * or `undefined` otherwise.
   */
  private async ensureParentDirectory(safePath: string): Promise<string | undefined> {
    const parent = dirname(safePath);
    let stat;
    try {
      stat = await this.kaos.stat(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await this.kaos.mkdir(parent, { parents: true, existOk: true });
          return undefined;
        } catch (mkdirError) {
          const disk = await diskFullToolError(mkdirError);
          return disk ?? (mkdirError instanceof Error ? mkdirError.message : String(mkdirError));
        }
      }
      return undefined;
    }
    if ((stat.stMode & S_IFMT) !== S_IFDIR) {
      return `Parent path is not a directory: ${parent}.`;
    }
    return undefined;
  }
}
