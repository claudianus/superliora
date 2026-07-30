import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadPluginOutputStyles,
  renderOutputStylesReminder,
} from '../../src/plugin/output-styles';

describe('plugin output styles', () => {
  it('loads markdown styles and renders a reminder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'output-styles-'));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'terse.md'),
      '---\nname: terse\ndescription: Short\n---\nKeep answers short.\n',
      'utf8',
    );

    const styles = await loadPluginOutputStyles({ pluginId: 'demo', outputStylesDir: dir });
    expect(styles).toHaveLength(1);
    expect(styles[0]).toMatchObject({
      pluginId: 'demo',
      name: 'terse',
      description: 'Short',
      body: 'Keep answers short.',
      forceForPlugin: false,
    });

    const reminder = renderOutputStylesReminder(styles);
    expect(reminder).toContain('plugin-output-style:demo:terse');
    expect(reminder).toContain('Keep answers short.');
  });

  it('force-for-plugin wins when multiple styles exist', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'output-styles-force-'));
    await writeFile(path.join(dir, 'a.md'), '---\nname: a\n---\nStyle A\n', 'utf8');
    await writeFile(
      path.join(dir, 'b.md'),
      '---\nname: b\nforce-for-plugin: true\n---\nStyle B\n',
      'utf8',
    );
    const styles = await loadPluginOutputStyles({ pluginId: 'demo', outputStylesDir: dir });
    const reminder = renderOutputStylesReminder(styles);
    expect(reminder).toContain('Style B');
    expect(reminder).not.toContain('Style A');
  });
});
