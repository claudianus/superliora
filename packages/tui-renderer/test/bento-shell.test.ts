import { describe, expect, it } from 'vitest';
import {
  getShellBentoCell,
  hitTestShellBento,
  measureShellBentoLayout,
  shellBentoContentRect,
} from '../src/bento-shell';

describe('measureShellBentoLayout', () => {
  it('full-bleeds a center stack on wide terminals without docks', () => {
    const layout = measureShellBentoLayout({
      viewport: { x: 0, y: 0, width: 180, height: 40 },
      mode: 'wide',
      chrome: { header: 3, footer: 2, editor: 5 },
      insetX: 1,
      insetY: 0,
      gap: 1,
    });

    expect(layout.leftDock).toBeUndefined();
    expect(layout.rightDock).toBeUndefined();
    expect(layout.center.width).toBe(178);

    const header = getShellBentoCell(layout, 'header');
    const transcript = getShellBentoCell(layout, 'transcript');
    const editor = getShellBentoCell(layout, 'editor');
    const footer = getShellBentoCell(layout, 'footer');

    expect(header?.rect.height).toBe(3);
    expect(header?.rect.width).toBe(178); // full shell width
    expect(editor?.rect.height).toBe(5);
    expect(footer?.rect.height).toBe(2);
    expect(footer?.rect.width).toBe(178);
    expect(transcript?.rect.height).toBeGreaterThanOrEqual(4);

    // Vertical: header (full) → middle(transcript/editor) → footer (full)
    expect(transcript!.rect.y).toBe(header!.rect.y + header!.rect.height + 1);
    expect(editor!.rect.y).toBe(transcript!.rect.y + transcript!.rect.height + 1);
    expect(footer!.rect.y).toBe(editor!.rect.y + editor!.rect.height + 1);
  });

  it('places left and right dock panels beside the center on ultrawide', () => {
    const layout = measureShellBentoLayout({
      viewport: { x: 0, y: 0, width: 220, height: 50 },
      mode: 'ultrawide',
      chrome: { header: 2, footer: 1, editor: 4 },
      leftPanels: [{ id: 'files', colSpan: 1, rowSpan: 2, priority: 10 }],
      rightPanels: [
        { id: 'git', colSpan: 1, rowSpan: 1, priority: 8 },
        { id: 'term', colSpan: 1, rowSpan: 1, priority: 7 },
      ],
      leftDockWidth: 40,
      rightDockWidth: 48,
      gap: 1,
    });

    expect(layout.leftDock).toBeDefined();
    expect(layout.rightDock).toBeDefined();
    expect(layout.leftDock!.width).toBe(40);
    expect(layout.rightDock!.width).toBe(48);

    const header = getShellBentoCell(layout, 'header')!;
    const footer = getShellBentoCell(layout, 'footer')!;
    const files = getShellBentoCell(layout, 'panel:files');
    const git = getShellBentoCell(layout, 'panel:git');
    const term = getShellBentoCell(layout, 'panel:term');
    expect(files).toBeDefined();
    expect(git).toBeDefined();
    expect(term).toBeDefined();

    // Header/footer span the full shell; docks sit only in the middle band
    expect(header.rect.width).toBe(layout.area.width);
    expect(footer.rect.width).toBe(layout.area.width);
    expect(files!.rect.y).toBeGreaterThanOrEqual(header.rect.y + header.rect.height);
    expect(files!.rect.y + files!.rect.height).toBeLessThanOrEqual(footer.rect.y);

    // Two right panels stacked
    expect(term!.rect.y).toBeGreaterThan(git!.rect.y);
  });

  it('splits transcript | rail horizontally in rail mode', () => {
    const layout = measureShellBentoLayout({
      viewport: { x: 0, y: 0, width: 160, height: 40 },
      mode: 'wide',
      chrome: { header: 2, footer: 1, editor: 4, rail: 10 },
      railMode: true,
      gap: 1,
    });

    const transcript = getShellBentoCell(layout, 'transcript');
    const rail = getShellBentoCell(layout, 'rail');
    expect(transcript).toBeDefined();
    expect(rail).toBeDefined();
    expect(transcript!.rect.y).toBe(rail!.rect.y);
    expect(transcript!.rect.height).toBe(rail!.rect.height);
    expect(rail!.rect.x).toBeGreaterThan(transcript!.rect.x);
  });

  it('hit-tests front-most cells and content rect insets by 1', () => {
    const layout = measureShellBentoLayout({
      viewport: { x: 0, y: 0, width: 100, height: 30 },
      mode: 'narrow',
      chrome: { header: 2, footer: 1, editor: 3 },
      gap: 1,
    });
    const editor = getShellBentoCell(layout, 'editor')!;
    const hit = hitTestShellBento(layout, editor.rect.x + 1, editor.rect.y + 1);
    expect(hit?.cellId).toBe('editor');

    const content = shellBentoContentRect(editor.rect);
    expect(content.width).toBe(editor.rect.width - 2);
    expect(content.height).toBe(editor.rect.height - 2);
  });
});
