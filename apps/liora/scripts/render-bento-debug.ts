/**
 * Visual ASCII dump of the shell bento layout at common terminal sizes.
 * Usage: pnpm -C apps/liora exec tsx scripts/render-bento-debug.ts
 */
import {
  measureShellBentoLayout,
  type ShellBentoCellId,
} from '../../../packages/tui-renderer/src/bento-shell.ts';

const SIZES: Array<{ cols: number; rows: number; label: string }> = [
  { cols: 80, rows: 24, label: 'narrow laptop' },
  { cols: 120, rows: 36, label: 'medium' },
  { cols: 160, rows: 40, label: 'wide' },
  { cols: 220, rows: 50, label: 'ultrawide' },
];

function modeFor(cols: number) {
  if (cols >= 220) return 'ultrawide' as const;
  if (cols >= 160) return 'wide' as const;
  if (cols >= 120) return 'medium' as const;
  if (cols >= 80) return 'narrow' as const;
  return 'compact' as const;
}

function glyphFor(id: string): string {
  if (id === 'transcript') return 'T';
  if (id === 'header') return 'H';
  if (id === 'footer') return 'F';
  if (id === 'editor') return 'E';
  if (id === 'rail') return 'R';
  if (id.startsWith('panel:')) return 'P';
  return '·';
}

for (const size of SIZES) {
  const mode = modeFor(size.cols);
  const wantsDocks = mode === 'wide' || mode === 'ultrawide' || mode === 'medium';
  const layout = measureShellBentoLayout({
    viewport: { x: 0, y: 0, width: size.cols, height: size.rows },
    mode,
    chrome: { header: 3, footer: 2, editor: 5, activity: mode === 'narrow' ? 3 : 0 },
    leftPanels: wantsDocks && mode !== 'medium'
      ? [{ id: 'files', colSpan: 1, rowSpan: 2, priority: 10 }]
      : [],
    rightPanels: wantsDocks
      ? [
          { id: 'git', colSpan: 1, rowSpan: 1, priority: 8 },
          { id: 'term', colSpan: 1, rowSpan: 1, priority: 7 },
        ]
      : [],
    leftDockWidth: 36,
    rightDockWidth: 42,
    gap: 1,
    insetX: 1,
    insetY: 0,
    railMode: size.cols >= 160,
  });

  const grid = Array.from({ length: size.rows }, () => Array.from({ length: size.cols }, () => ' '));
  for (const cell of layout.paintOrder) {
    const g = glyphFor(cell.id);
    const { x, y, width, height } = cell.rect;
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (py < 0 || px < 0 || py >= size.rows || px >= size.cols) continue;
        const onBorder =
          dy === 0 || dy === height - 1 || dx === 0 || dx === width - 1;
        grid[py]![px] = onBorder ? (g === 'T' ? '░' : '█') : g;
      }
    }
  }

  console.log(`\n══ ${size.label} ${size.cols}×${size.rows} (${mode}) ══`);
  console.log(
    `cells: ${[...layout.cells.keys()].join(', ')}`,
  );
  for (const row of grid) {
    console.log(row.join(''));
  }
}

// Type-only keep ShellBentoCellId referenced for tree-shaking sanity
const _ids: ShellBentoCellId[] = ['header', 'transcript', 'editor', 'footer'];
void _ids;
