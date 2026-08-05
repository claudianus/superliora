import type { Component, Focusable } from '#/tui/renderer';
import { loadFileForViewer } from '#/utils/fs/file-content';
import { buildFileTree, listProjectFiles } from '#/utils/fs/file-tree';
import type { SearchResults } from '#/utils/fs/project-search';
import { collectGitBlame } from '#/utils/git/git-blame';
import type { GitDiffReport } from '#/utils/git/git-diff';
import { collectCommitDiff, type GitLogReport } from '#/utils/git/git-log';
import { fetchWebContent } from '#/utils/web/web-content';
import { resolve } from 'pathe';

import { BlamePanelComponent } from '../../components/dialogs/workspace/blame-panel';
import { CommitBrowserComponent } from '../../components/dialogs/workspace/commit-browser';
import { DiffReviewComponent } from '../../components/dialogs/workspace/diff-review';
import { ErrorNavigatorComponent } from '../../components/dialogs/workspace/error-navigator';
import { FileExplorerComponent } from '../../components/dialogs/workspace/file-explorer';
import { FileViewerComponent } from '../../components/dialogs/workspace/file-viewer';
import { SearchResultsComponent } from '../../components/dialogs/search/search-results';
import type { SessionLoadingPhase } from '../../components/dialogs/session/session-loading-overlay';
import type { ColorToken } from '../../theme';
import { currentTheme } from '../../theme';
import type { TUIState } from '../../tui-state';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { collectTranscriptErrors } from '../../features/transcript/transcript-errors';
import { ttui } from '../../utils/tui-i18n';

/** Host surface for workspace file / git / search browser dialogs. */
export interface WorkspaceBrowserHost {
  state: TUIState;

  showError(message: string): void;
  showStatus(message: string, color?: ColorToken): void;
  isSessionLoadingOverlayActive(): boolean;
  runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T>;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  scrollToTranscriptIndex(index: number): void;
}

/**
 * File explorer, diff review, commit browser, error navigator, search results,
 * file viewer, web fetch, and blame panels. LioraTUI keeps thin delegates.
 */
export class WorkspaceBrowserController {
  private lastDiffReport: GitDiffReport | undefined;
  private lastDiffFilter = '';

  constructor(private readonly host: WorkspaceBrowserHost) {}

  showFileExplorer(): void {
    if (this.host.state.appState.isReplaying || this.host.isSessionLoadingOverlayActive()) {
      this.host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    void this.host.runWithBusyOverlay(
      {
        title: ttui('tui.sessionLoading.scanning'),
        detail: ttui('tui.sessionLoading.scanning'),
        phase: 'working',
      },
      async () => {
        const workDir = this.host.state.appState.workDir;
        // Paint overlay before the sync FS walk blocks the event loop.
        await new Promise<void>((resolve) => setImmediate(resolve));
        const listing = listProjectFiles(workDir);
        const nodes = buildFileTree(listing.paths);
        this.host.state.activeDialog = 'files';
        this.host.mountEditorReplacement(
          new FileExplorerComponent({
            workDir,
            nodes,
            truncated: listing.truncated,
            source: listing.source,
            onPick: (relativePath) => {
              this.hideFileExplorer();
              this.host.state.editor.insertTextAtCursor(`${relativePath} `);
              requestTUILayoutRender(this.host.state);
            },
            onPreview: (relativePath) => {
              this.showFileViewer(relativePath);
            },
            onBlame: (relativePath) => {
              // showBlame() bails while a dialog is active, so tear the
              // explorer down first (same mechanics as file-viewer blame).
              this.host.state.activeDialog = null;
              this.host.restoreEditor();
              this.showBlame(relativePath);
            },
            onClose: () => {
              this.hideFileExplorer();
            },
          }),
        );
      },
    );
  }

  showDiffReview(report: GitDiffReport, filter: string): void {
    this.lastDiffReport = report;
    this.lastDiffFilter = filter;
    this.host.state.activeDialog = 'diff-review';
    this.host.mountEditorReplacement(
      new DiffReviewComponent({
        report,
        filter,
        onOpenFile: (relativePath) => {
          this.hideDiffReview();
          this.showFileViewer(relativePath, () => {
            if (this.lastDiffReport !== undefined) {
              this.showDiffReview(this.lastDiffReport, this.lastDiffFilter);
            }
          });
        },
        onClose: () => {
          this.hideDiffReview();
        },
      }),
    );
  }

  showCommitBrowser(report: GitLogReport, filter: string): void {
    this.host.state.activeDialog = 'commit-browser';
    this.host.mountEditorReplacement(
      new CommitBrowserComponent({
        report,
        filter,
        onOpenCommit: (commit) => {
          this.hideCommitBrowser();
          const files = collectCommitDiff(this.host.state.appState.workDir, commit.hash);
          if (files === null || files.length === 0) {
            this.host.showStatus(`No diff for ${commit.hash.slice(0, 7)}.`, 'warning');
            return;
          }
          const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
          const totalDeleted = files.reduce((sum, file) => sum + file.deleted, 0);
          this.showDiffReview(
            {
              branch: commit.hash.slice(0, 7),
              files,
              totalAdded,
              totalDeleted,
              truncated: false,
            },
            '',
          );
        },
        onClose: () => {
          this.hideCommitBrowser();
        },
      }),
    );
  }

  showErrors(): void {
    if (this.host.state.activeDialog !== null) return;
    const items = collectTranscriptErrors(this.host.state.transcriptEntries);
    if (items.length === 0) {
      this.host.showStatus(ttui('tui.errors.empty'));
      return;
    }
    this.host.state.activeDialog = 'error-navigator';
    this.host.mountEditorReplacement(
      new ErrorNavigatorComponent({
        items,
        onSelect: (item) => {
          // Keep the dialog open so the user can jump to more errors; just
          // scroll the failing entry into view.
          this.host.scrollToTranscriptIndex(item.index);
        },
        onCancel: () => {
          this.hideErrorNavigator();
        },
      }),
    );
  }

  showSearchResults(results: SearchResults): void {
    this.host.state.activeDialog = 'search';
    this.host.mountEditorReplacement(
      new SearchResultsComponent({
        results,
        onOpenMatch: (match) => {
          this.hideSearchResults();
          this.showFileViewer(
            match.path,
            () => {
              this.showSearchResults(results);
            },
            match.line,
          );
        },
        onClose: () => {
          this.hideSearchResults();
        },
      }),
    );
  }

  showWebContent(rawUrl: string | undefined): void {
    if (this.host.state.activeDialog !== null) return;
    const target = (rawUrl ?? '').trim();
    if (target.length === 0) {
      this.host.showError(ttui('tui.web.usage'));
      return;
    }
    this.host.showStatus(ttui('tui.web.fetching', { url: target }));
    void (async () => {
      try {
        const content = await fetchWebContent(target);
        if (this.host.state.activeDialog !== null) return;
        this.host.state.activeDialog = 'file-viewer';
        this.host.mountEditorReplacement(
          new FileViewerComponent({
            relativePath: content.title ?? content.url,
            content: content.body,
            bytes: Buffer.byteLength(content.body, 'utf8'),
            palette: currentTheme.palette,
            onClose: () => {
              this.host.state.activeDialog = null;
              this.host.restoreEditor();
            },
          }),
        );
      } catch (error) {
        this.host.showError(formatErrorMessage(error));
      }
    })();
  }

  showBlame(rawPath: string | undefined): void {
    if (this.host.state.activeDialog !== null) return;
    const target = (rawPath ?? '').trim();
    if (target.length === 0) {
      this.host.showError(ttui('tui.blame.usage'));
      return;
    }
    this.host.showStatus(ttui('tui.blame.loading', { path: target }));
    void (async () => {
      try {
        const lines = await collectGitBlame(target, { cwd: this.host.state.appState.workDir });
        if (this.host.state.activeDialog !== null) return;
        this.host.state.activeDialog = 'blame';
        this.host.mountEditorReplacement(
          new BlamePanelComponent({
            lines,
            title: target,
            palette: currentTheme.palette,
            onClose: () => {
              this.host.state.activeDialog = null;
              this.host.restoreEditor();
            },
          }),
        );
      } catch (error) {
        this.host.showError(formatErrorMessage(error));
      }
    })();
  }

  private hideFileExplorer(): void {
    this.host.state.activeDialog = null;
    this.host.restoreEditor();
  }

  private hideDiffReview(): void {
    this.host.state.activeDialog = null;
    this.host.restoreEditor();
  }

  private hideCommitBrowser(): void {
    this.host.state.activeDialog = null;
    this.host.restoreEditor();
  }

  private hideErrorNavigator(): void {
    this.host.state.activeDialog = null;
    this.host.restoreEditor();
  }

  private hideSearchResults(): void {
    this.host.state.activeDialog = null;
    this.host.restoreEditor();
  }

  private showFileViewer(
    relativePath: string,
    onViewerClose?: () => void,
    initialLine?: number,
  ): void {
    const result = loadFileForViewer(resolve(this.host.state.appState.workDir, relativePath));
    switch (result.kind) {
      case 'text': {
        this.host.state.activeDialog = 'file-viewer';
        this.host.mountEditorReplacement(
          new FileViewerComponent({
            relativePath,
            content: result.content,
            bytes: result.bytes,
            palette: currentTheme.palette,
            initialLine,
            onClose: () => {
              if (onViewerClose !== undefined) onViewerClose();
              else this.returnToFileExplorer();
            },
            onBlame: (blamePath) => {
              // showBlame() bails while a dialog is active, so tear the
              // viewer down first (same mechanics as hideFileExplorer).
              this.host.state.activeDialog = null;
              this.host.restoreEditor();
              this.showBlame(blamePath);
            },
          }),
        );
        return;
      }
      case 'binary':
        this.host.showStatus(`${relativePath} is binary — preview unavailable.`, 'warning');
        return;
      case 'too-large': {
        const mb = (result.bytes / 1024 / 1024).toFixed(1);
        this.host.showStatus(`${relativePath} is ${mb} MB — too large to preview.`, 'warning');
        return;
      }
      case 'error':
        this.host.showStatus(`${relativePath}: ${result.message}`, 'error');
        return;
    }
  }

  private returnToFileExplorer(): void {
    this.showFileExplorer();
  }
}
