import { visibleWidth } from '#/tui/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageThumbnail } from '#/tui/components/media/image-thumbnail';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';

const image: ImageAttachment = {
  id: 1,
  kind: 'image',
  bytes: new Uint8Array([137, 80, 78, 71]),
  mime: 'image/png',
  width: 800,
  height: 600,
  placeholder: '[image #1 (800×600)]',
};

describe('ImageThumbnail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps rendered output within narrow widths', () => {
    stubTerminalImageProtocol('none');

    const component = new ImageThumbnail(image);

    for (const width of [39, 20, 3, 1]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('does not rebuild inline image children on repeated same-width renders', () => {
    stubTerminalImageProtocol('kitty');

    const bufferFrom = vi.spyOn(Buffer, 'from');
    const component = new ImageThumbnail(image);
    bufferFrom.mockClear();

    component.render(80);
    component.render(80);

    expect(bufferFrom).not.toHaveBeenCalled();
  });

  it('renders inline images through the native renderer protocol encoder', () => {
    stubTerminalImageProtocol('kitty');

    const component = new ImageThumbnail(image);
    const lines = component.render(80);

    expect(lines.at(-1)).toContain('\u001B_Ga=T,f=100');
    expect(lines.at(-1)).toContain('c=40');
    expect(lines.length).toBeLessThanOrEqual(12);
  });
});

function stubTerminalImageProtocol(protocol: 'kitty' | 'iterm2' | 'none'): void {
  vi.stubEnv('TERM', protocol === 'kitty' ? 'xterm-kitty' : 'xterm-256color');
  vi.stubEnv('TERM_PROGRAM', protocol === 'iterm2' ? 'WezTerm' : '');
  vi.stubEnv('KITTY_WINDOW_ID', protocol === 'kitty' ? '1' : '');
  vi.stubEnv('WEZTERM_PANE', protocol === 'iterm2' ? '1' : '');
  vi.stubEnv('GHOSTTY_RESOURCES_DIR', '');
  vi.stubEnv('TMUX', '');
  vi.stubEnv('ZELLIJ', '');
  vi.stubEnv('CI', '');
}
