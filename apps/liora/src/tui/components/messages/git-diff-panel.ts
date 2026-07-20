/**
 * GitDiffPanel — Bloomberg-density working-tree review shown by `/diff`.
 *
 * Header carries branch + file/line totals; each file gets a status glyph,
 * a left-truncated path, per-file `+a −d`, and a clustered unified-diff body
 * rendered through the shared diff-preview formatter. A clean tree renders a
 * quiet empty state instead of an empty box.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';

import { renderClusteredDiffBody } from '#/tui/components/media/diff-preview';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import type { GitDiffFile, GitDiffFileStatus, GitDiffReport } from '#/utils/git/git-diff';

/** renderRoundedPanel overhead with leftMargin=2, sidePadding=1. */
const BOX_OVERHEAD = 6;
const MIN_PATH_WIDTH = 8;

const STATUS_GLYPH: Record<GitDiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  binary: 'B',
};

const STATUS_TOKEN: Record<GitDiffFileStatus, ColorToken> = {
  added: 'diffAddedStrong',
  modified: 'primary',
  deleted: 'diffRemovedStrong',
  renamed: 'accent',
  binary: 'textMuted',
};

export class GitDiffPanel implements Component {
  constructor(private readonly report: GitDiffReport | null) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    return renderRoundedPanel({
      title: ' Git Diff ',
      content: this.buildContent(safeWidth),
      width: safeWidth,
      borderToken: 'primary',
      leftMargin: 2,
      minBoxWidth: 40,
    });
  }

  private buildContent(width: number): string[] {
    if (this.report === null) {
      return [currentTheme.dimFg('textMuted', 'not a git repository')];
    }

    const interior = Math.max(1, width - BOX_OVERHEAD);
    const lines: string[] = [this.renderHeader(interior)];

    if (this.report.files.length === 0) {
      lines.push('');
      lines.push(this.renderCleanState());
      return lines;
    }

    for (const file of this.report.files) {
      lines.push('');
      lines.push(...this.renderFile(file, interior));
    }
    return lines;
  }

  private renderHeader(width: number): string {
    const t = currentTheme;
    const { branch, files, totalAdded, totalDeleted, truncated } = this.report as GitDiffReport;
    const sep = t.dimFg('textMuted', '·');
    const parts = [
      t.boldFg('primary', `⎇ ${branch ?? '(detached)'}`),
      sep,
      t.fg('text', `${String(files.length)} file${files.length === 1 ? '' : 's'}`),
      sep,
      t.boldFg('diffAddedStrong', `+${String(totalAdded)}`),
      t.boldFg('diffRemovedStrong', `−${String(totalDeleted)}`),
    ];
    let header = parts.join(' ');
    if (truncated) {
      header += ` ${sep} ${t.dimFg('textMuted', 'truncated')}`;
    }
    return truncateToWidth(header, width, '…');
  }

  private renderCleanState(): string {
    return `${currentTheme.fg('success', '✓')} ${currentTheme.dimFg('textMuted', 'working tree clean')}`;
  }

  private renderFile(file: GitDiffFile, width: number): string[] {
    const out: string[] = [this.renderFileHeader(file, width)];

    if (file.status === 'binary') {
      out.push(currentTheme.dimFg('textMuted', 'binary file'));
      return out;
    }
    if (file.lines.length === 0) {
      return out;
    }

    // Reuse the shared clustered formatter; drop its own `+N -N path` header
    // (index 0) in favour of the status-glyph header rendered above.
    const body = renderClusteredDiffBody(file.lines, file.path, { contextLines: 3 }).slice(1);
    for (const line of body) {
      out.push(truncateToWidth(line, width, '…'));
    }
    return out;
  }

  private renderFileHeader(file: GitDiffFile, width: number): string {
    const t = currentTheme;
    const glyph = t.boldFg(STATUS_TOKEN[file.status], STATUS_GLYPH[file.status]);
    const addedText = t.fg(file.added > 0 ? 'diffAddedStrong' : 'textMuted', `+${String(file.added)}`);
    const deletedText = t.fg(
      file.deleted > 0 ? 'diffRemovedStrong' : 'textMuted',
      `−${String(file.deleted)}`,
    );
    const stats = `${addedText} ${deletedText}`;
    const statsWidth = visibleWidth(stats);

    const displayPath = file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path;
    const pathBudget = Math.max(MIN_PATH_WIDTH, width - 2 - 1 - statsWidth);
    const path = t.fg('text', truncatePathLeft(displayPath, pathBudget));

    return truncateToWidth(`${glyph} ${path} ${stats}`, width, '…');
  }
}

/** Keep the file tail visible when narrow: `…src/foo.ts`. */
function truncatePathLeft(path: string, maxWidth: number): string {
  if (maxWidth <= 1) return '…';
  if (visibleWidth(path) <= maxWidth) return path;
  const keep = maxWidth - 1;
  let suffix = '';
  let used = 0;
  for (const ch of Array.from(path).toReversed()) {
    const w = visibleWidth(ch);
    if (used + w > keep) break;
    suffix = ch + suffix;
    used += w;
  }
  return `…${suffix}`;
}
