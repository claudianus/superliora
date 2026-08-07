import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Session, SessionTrace } from '@superliora/sdk';

import { toTerminalHyperlink } from '#/utils/terminal-hyperlink';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { isAbortError } from '../../utils/errors';
import { formatErrorMessage } from '../../utils/event-payload';
import { buildExportMarkdown } from '../../utils/export-markdown';
import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

export async function handleTitleCommand(host: SlashCommandHost, args: string): Promise<void> {
  const title = args.trim();
  if (title.length === 0) {
    const current = host.state.appState.sessionTitle;
    host.showStatus(
      current !== null && current.length > 0
        ? `Session title: ${current}`
        : `Session title: (not set) — id: ${host.state.appState.sessionId}`,
    );
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const newTitle = title.slice(0, 200);
  try {
    await host.harness.renameSession({ id: session.id, title: newTitle });
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set title: ${msg}`);
    return;
  }
  host.showStatus(`Session title set to: ${newTitle}`);
}

export async function handleForkCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.isSessionLoadingOverlayActive()) {
    host.showError(ttui('tui.sessionLoading.busy'));
    return;
  }

  const parsed = parseForkArgs(args);
  const sourceTitle = forkSourceTitle(host, session);
  const originalId = session.id;

  try {
    await host.runWithBusyOverlay(
      {
        title: ttui('tui.sessionLoading.forking'),
        detail: ttui('tui.sessionLoading.forking'),
        phase: 'working',
        sessionId: originalId,
      },
      async () => {
        const forked = await host.harness.forkSession({
          id: originalId,
          title: `Fork: ${sourceTitle}`,
          worktree: parsed.worktree,
        });
        const worktreeNote =
          parsed.worktree === undefined ? '' : ` Worktree: ${forked.workDir}`;
        host.reportSessionLoading({
          phase: 'loading',
          progress: 0.35,
          sessionId: forked.id,
          detail: ttui('tui.sessionLoading.phase.loading'),
        });
        await host.switchToSession(
          forked,
          `Session forked (${forked.id}).${worktreeNote} To return to the original session: liora -r ${originalId}`,
        );
      },
    );
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to fork session: ${msg}`);
  }
}

/** Parse `/fork --worktree [name]` style args. */
export function parseForkArgs(args: string): {
  readonly worktree?: boolean | { readonly name?: string };
} {
  const tokens = args.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return {};

  let worktree: boolean | { readonly name?: string } | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === '--worktree' || token === '-w') {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        worktree = { name: next };
        i += 1;
      } else {
        worktree = true;
      }
      continue;
    }
    if (token.startsWith('--worktree=')) {
      const name = token.slice('--worktree='.length);
      worktree = name.length > 0 ? { name } : true;
    }
  }
  return worktree === undefined ? {} : { worktree };
}

function forkSourceTitle(host: SlashCommandHost, session: Session): string {
  const currentTitle = host.state.appState.sessionTitle?.trim();
  if (currentTitle !== undefined && currentTitle.length > 0) return currentTitle;

  const summaryTitle =
    typeof session.summary?.title === 'string' ? session.summary.title.trim() : '';
  return summaryTitle.length > 0 ? summaryTitle : session.id;
}

export async function handleExportMdCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.isSessionLoadingOverlayActive()) {
    host.showError(ttui('tui.sessionLoading.busy'));
    return;
  }

  try {
    await host.runWithBusyOverlay(
      {
        title: ttui('tui.sessionLoading.exporting'),
        detail: ttui('tui.sessionLoading.exporting'),
        phase: 'working',
        sessionId: session.id,
      },
      async () => {
        let trace: SessionTrace | undefined;
        try {
          trace = await session.getSessionTrace();
        } catch {
          trace = undefined;
        }
        const context = trace?.context ?? await session.getContext();
        if (context.history.length === 0) {
          host.showError('No messages to export.');
          return;
        }

        const now = new Date();
        const shortId = session.id.slice(0, 8);
        const timestamp = now.toISOString().replaceAll(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
        const defaultName = `kimi-export-${shortId}-${timestamp}.md`;

        const trimmedArgs = args.trim();
        const outputPath = trimmedArgs.length > 0
          ? resolve(trimmedArgs)
          : resolve(host.state.appState.workDir, defaultName);

        const md = buildExportMarkdown({
          sessionId: session.id,
          workDir: host.state.appState.workDir,
          history: context.history,
          tokenCount: context.tokenCount,
          now,
          trace,
        });

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, md, 'utf-8');

        const linked = toTerminalHyperlink(outputPath, pathToFileURL(outputPath).href);
        host.showNotice(`Exported ${String(context.history.length)} messages`, linked);
      },
    );
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to export session: ${msg}`);
  }
}

export async function handleInitCommand(host: SlashCommandHost): Promise<void> {
  const session = host.session;
  if (host.state.appState.model.trim().length === 0 || session === undefined) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  host.deferUserMessages = true;
  host.beginSessionRequest();
  try {
    await session.init();
    host.track('init_complete');
    host.streamingUI.finalizeTurn((item) => {
      host.sendQueuedMessage(session, item);
    });
  } catch (error) {
    if (isAbortError(error)) {
      host.setAppState({ streamingPhase: 'idle' });
      host.resetLivePane();
      return;
    }
    const msg = error instanceof Error ? error.message : String(error);
    host.failSessionRequest(`Init failed: ${msg}`);
  } finally {
    host.deferUserMessages = false;
  }
}
