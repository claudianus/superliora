import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clipboard } from '#/utils/clipboard/clipboard-native';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('#/utils/clipboard/clipboard-native', () => ({
  clipboard: {
    setText: vi.fn(),
  },
}));

const clipboardMock = clipboard as unknown as { setText: ReturnType<typeof vi.fn> };
const spawnSyncMock = vi.mocked(spawnSync);

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  spawnSyncMock.mockImplementation(() => {
    throw new Error('platform clipboard fallback should not run');
  });
});

describe('copyTextToClipboard', () => {
  it('copies text with the native clipboard when available', async () => {
    clipboardMock.setText.mockResolvedValue(undefined);

    await expect(copyTextToClipboard('cd "/tmp/proj-b"')).resolves.toBeUndefined();
    expect(clipboardMock.setText).toHaveBeenCalledWith('cd "/tmp/proj-b"');
  });

  it('keeps native clipboard method context when copying text', async () => {
    clipboardMock.setText.mockImplementation(function (this: unknown, text: string): void {
      expect(this).toBe(clipboardMock);
      expect(text).toBe('cd "/tmp/proj-b"');
    });

    await expect(copyTextToClipboard('cd "/tmp/proj-b"')).resolves.toBeUndefined();
  });

  it('falls back to OSC 52 when all platform clipboard commands fail', async () => {
    clipboardMock.setText = undefined as unknown as ReturnType<typeof vi.fn>;
    spawnSyncMock.mockReturnValue({ status: 1, stderr: 'missing' } as ReturnType<typeof spawnSync>);
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // A copy must never surface as an error: over SSH the terminal escape is
    // the only path that works, so the platform failure is not the end.
    await expect(copyTextToClipboard('cd "/tmp/proj-b"')).resolves.toBeUndefined();
    const encoded = Buffer.from('cd "/tmp/proj-b"', 'utf8').toString('base64');
    expect(write).toHaveBeenCalledWith(`\u001B]52;c;${encoded}\u001B\\`);
    write.mockRestore();
  });
});
