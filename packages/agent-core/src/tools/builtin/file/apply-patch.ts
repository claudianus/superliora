/**
 * ApplyPatchTool — apply OpenCode-style multi-file patches.
 */

import type { Kaos } from '@superliora/kaos';
import { dirname } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { FileSnapshotStore } from '../../../session/file-snapshot';
import { checkSwarmFileLease } from '#/fleet';
import { refineSandboxPathForExecute, resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import { materializeModelText, toModelTextView } from './line-endings';
import { applyHunksToContent, parseOpenCodePatch } from './apply-patch-core';
import APPLY_PATCH_DESCRIPTION from './apply-patch.md?raw';

export const ApplyPatchInputSchema = z.object({
  patch: z
    .string()
    .min(1)
    .describe(
      'OpenCode-style patch text: *** Begin Patch … *** End Patch with *** Update/Add/Delete File sections.',
    ),
});

export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;

export class ApplyPatchTool implements BuiltinTool<ApplyPatchInput> {
  readonly name = 'ApplyPatch' as const;
  readonly description = APPLY_PATCH_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ApplyPatchInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly options?: {
      readonly fileSnapshots?: FileSnapshotStore | undefined;
      readonly getTurnId?: (() => string | undefined) | undefined;
      readonly getSwarmLease?:
        | (() => { readonly ownerId?: string; readonly runId?: string } | undefined)
        | undefined;
      readonly onFileMutated?:
        | ((path: string, content: string) => Promise<string | undefined> | string | undefined)
        | undefined;
    },
  ) {}

  resolveExecution(args: ApplyPatchInput): ToolExecution {
    const parsed = parseOpenCodePatch(args.patch);
    const paths =
      
      parsed.ok
        ? parsed.files.map((file) =>
            resolvePathAccessPath(file.path, {
              kaos: this.kaos,
              workspace: this.workspace,
              operation: 'write',
            }),
          )
        : [];
    const accesses = paths.flatMap((path) => ToolAccesses.readWriteFile(path));
    return {
      accesses,
      description: `Applying patch (${parsed.ok ? String(parsed.files.length) : '?'} file(s))`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path: paths[0] ?? args.patch.slice(0, 80),
        before: args.patch,
        after: '',
      },
      approvalRule: literalRulePattern(this.name, paths[0] ?? 'patch'),
      matchesRule: (ruleArgs) =>
        paths.some((path) =>
          matchesPathRuleSubject(ruleArgs, path, {
            cwd: this.workspace.workspaceDir,
            pathClass: this.kaos.pathClass(),
            homeDir: this.kaos.gethome(),
          }),
        ),
      execute: () => this.execution(args),
    };
  }

  private async execution(args: ApplyPatchInput): Promise<ExecutableToolResult> {
    const parsed = parseOpenCodePatch(args.patch);
    if (!parsed.ok) {
      return { isError: true, output: parsed.error };
    }

    const lease = this.options?.getSwarmLease?.();
    const snapshots = this.options?.fileSnapshots;
    const turnId = this.options?.getTurnId?.();

    const pending: Array<{
      shownPath: string;
      safePath: string;
      kind: 'update' | 'add' | 'delete';
      content?: string;
      lineEndingStyle?: ReturnType<typeof toModelTextView>['lineEndingStyle'];
    }> = [];

    for (const file of parsed.files) {
      const lexicalPath = resolvePathAccessPath(file.path, {
        kaos: this.kaos,
        workspace: this.workspace,
        operation: 'write',
      });
      const refined = await refineSandboxPathForExecute(lexicalPath, {
        kaos: this.kaos,
        workspace: this.workspace,
        rawPath: file.path,
      });
      if (!refined.ok) {
        return { isError: true, output: refined.output };
      }
      const safePath = refined.path;
      const leaseError = checkSwarmFileLease(safePath, lease?.ownerId, lease?.runId);
      if (leaseError !== undefined) {
        return { isError: true, output: leaseError };
      }

      if (file.kind === 'delete') {
        pending.push({ shownPath: file.path, safePath, kind: 'delete' });
        continue;
      }

      let modelView: ReturnType<typeof toModelTextView>;
      try {
        if (file.kind === 'update') {
          const raw = await this.kaos.readText(safePath);
          modelView = toModelTextView(raw);
        } else {
          modelView = toModelTextView('');
        }
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 'ENOENT' && file.kind === 'add') {
          modelView = toModelTextView('');
        } else if (code === 'EISDIR') {
          return { isError: true, output: `${file.path} is not a file.` };
        } else {
          return {
            isError: true,
            output: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const applied = applyHunksToContent(modelView.text, file.hunks);
      if (!applied.ok) {
        return {
          isError: true,
          output: `${file.path}: ${applied.error}`,
        };
      }

      pending.push({
        shownPath: file.path,
        safePath,
        kind: file.kind,
        content: applied.content,
        lineEndingStyle: modelView.lineEndingStyle,
      });
    }

    const summaries: string[] = [];
    for (const item of pending) {
      if (snapshots !== undefined && turnId !== undefined && item.kind !== 'delete') {
        await snapshots.captureBeforeWrite(turnId, item.safePath);
      }
      try {
        if (item.kind === 'delete') {
          await this.kaos.unlink(item.safePath);
          summaries.push(`Deleted ${item.shownPath}`);
          continue;
        }
        const parent = dirname(item.safePath);
        await this.kaos.mkdir(parent, { parents: true, existOk: true });
        const written = materializeModelText(item.content ?? '', item.lineEndingStyle ?? 'lf');
        await this.kaos.writeAtomic(item.safePath, written);
        const base = `${item.kind === 'add' ? 'Created' : 'Updated'} ${item.shownPath}`;
        summaries.push(await this.withMutationDiagnostics(item.safePath, written, base));
      } catch (error) {
        return {
          isError: true,
          output: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return { output: summaries.join('\n') };
  }

  private async withMutationDiagnostics(
    path: string,
    content: string,
    output: string,
  ): Promise<string> {
    const extra = await this.options?.onFileMutated?.(path, content);
    if (extra === undefined || extra.trim() === '') return output;
    return `${output}\n\n${extra.trim()}`;
  }
}
