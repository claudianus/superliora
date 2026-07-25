import { Command } from 'commander';
import {
  gcSessionWorktreesAuto,
  listSessionWorktrees,
  removeSessionWorktreeAuto,
  resolveGitRepoRootAuto,
  resolveLioraHome,
  type WorktreeRecord,
} from '@superliora/sdk';

import { t } from '#/cli/i18n';

export interface WorktreeCommandDeps {
  readonly cwd: () => string;
  readonly homeDir: () => string;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly exit: (code: number) => void;
}

export function registerWorktreeCommand(
  parent: Command,
  deps?: Partial<WorktreeCommandDeps>,
): void {
  const worktree = parent.command('worktree').description(t('cli.sub.worktree.description'));

  worktree
    .command('list')
    .description(t('cli.sub.worktree.cmd.list.desc'))
    .option('--repo', t('cli.sub.worktree.opt.repoOnly'), false)
    .action(async (opts: { repo?: boolean }) => {
      const resolved = resolveDeps(deps);
      try {
        const repoRoot =
          opts.repo === true ? await resolveGitRepoRootAuto(resolved.cwd()) : undefined;
        const entries = await listSessionWorktrees({
          homeDir: resolved.homeDir(),
          repoRoot,
        });
        writeList(resolved.stdout, entries);
      } catch (error) {
        resolved.stderr.write(`${formatError(error)}\n`);
        resolved.exit(1);
      }
    });

  worktree
    .command('rm')
    .description(t('cli.sub.worktree.cmd.rm.desc'))
    .argument('<nameOrPath>', t('cli.sub.worktree.arg.nameOrPath'))
    .option('--repo', t('cli.sub.worktree.opt.repoOnly'), false)
    .action(async (nameOrPath: string, opts: { repo?: boolean }) => {
      const resolved = resolveDeps(deps);
      try {
        const repoRoot =
          opts.repo === true ? await resolveGitRepoRootAuto(resolved.cwd()) : undefined;
        const removed = await removeSessionWorktreeAuto({
          homeDir: resolved.homeDir(),
          nameOrPath,
          repoRoot,
        });
        resolved.stdout.write(
          t('cli.sub.worktree.rm.ok', { name: removed.name, path: removed.path }) + '\n',
        );
      } catch (error) {
        resolved.stderr.write(`${formatError(error)}\n`);
        resolved.exit(1);
      }
    });

  worktree
    .command('gc')
    .description(t('cli.sub.worktree.cmd.gc.desc'))
    .option('--max-age-days <days>', t('cli.sub.worktree.opt.maxAgeDays'), '14')
    .option('--dry-run', t('cli.sub.worktree.opt.dryRun'), false)
    .action(async (opts: { maxAgeDays?: string; dryRun?: boolean }) => {
      const resolved = resolveDeps(deps);
      try {
        const maxAgeDays = Number.parseInt(opts.maxAgeDays ?? '14', 10);
        if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
          throw new Error(t('cli.sub.worktree.gc.invalidAge'));
        }
        const result = await gcSessionWorktreesAuto({
          homeDir: resolved.homeDir(),
          maxAgeDays,
          dryRun: opts.dryRun === true,
        });
        const prefix = opts.dryRun === true ? '[dry-run] ' : '';
        resolved.stdout.write(
          `${prefix}${t('cli.sub.worktree.gc.ok', {
            removed: String(result.removed.length),
            kept: String(result.kept),
          })}\n`,
        );
        for (const entry of result.removed) {
          resolved.stdout.write(`  - ${entry.name}  ${entry.path}\n`);
        }
      } catch (error) {
        resolved.stderr.write(`${formatError(error)}\n`);
        resolved.exit(1);
      }
    });
}

function resolveDeps(deps: Partial<WorktreeCommandDeps> | undefined): WorktreeCommandDeps {
  return {
    cwd: deps?.cwd ?? (() => process.cwd()),
    homeDir: deps?.homeDir ?? (() => resolveLioraHome()),
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
  };
}

function writeList(stdout: NodeJS.WritableStream, entries: readonly WorktreeRecord[]): void {
  if (entries.length === 0) {
    stdout.write(`${t('cli.sub.worktree.list.empty')}\n`);
    return;
  }
  for (const entry of entries) {
    stdout.write(
      `${entry.name}\t${entry.branch}\t${entry.path}\t${entry.repoRoot}\t${entry.lastAccessedAt}\n`,
    );
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
