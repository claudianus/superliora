import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importThemeSource } from '#/tui/theme/importer';

let home: string;
let fixtures: string;
const originalHome = process.env['SUPERLIORA_HOME'];

interface ImportedThemeDefinition {
  readonly schemaVersion?: number;
  readonly name: string;
  readonly colors: Record<string, string>;
  readonly ansi: {
    readonly normal: readonly string[];
    readonly bright: readonly string[];
    readonly cursor?: string;
  };
  readonly source: {
    readonly kind?: string;
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'kimi-theme-import-'));
  fixtures = join(home, 'fixtures');
  await mkdir(fixtures, { recursive: true });
  process.env['SUPERLIORA_HOME'] = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env['SUPERLIORA_HOME'];
  } else {
    process.env['SUPERLIORA_HOME'] = originalHome;
  }
});

describe('theme importer', () => {
  it('imports Base16/Base24 YAML with optional # prefixes', async () => {
    const { result, definition } = await importFixture('ocean.yaml', `
scheme: "Ocean"
variant: "dark"
base00: "2b303b"
base02: "4f5b66"
base03: "65737e"
base05: "c0c5ce"
base07: "eff1f5"
base08: "bf616a"
base0A: "ebcb8b"
base0B: "a3be8c"
base0C: "96b5b4"
base0D: "8fa1b3"
base0E: "b48ead"
`);

    expect(result.themeName).toBe('ocean');
    expect(definition.schemaVersion).toBe(2);
    expect(definition.colors['background']).toBe('#2B303B');
    expect(definition.colors['text']).toBe('#C0C5CE');
    expect(definition.ansi.normal).toHaveLength(8);
    expect(definition.source.kind).toBe('file');
  });

  it('imports Alacritty TOML palettes', async () => {
    const { definition } = await importFixture('nord.toml', `
[colors.primary]
background = "#2e3440"
foreground = "#d8dee9"

[colors.cursor]
cursor = "#eceff4"

[colors.normal]
black = "#3b4252"
red = "#bf616a"
green = "#a3be8c"
yellow = "#ebcb8b"
blue = "#81a1c1"
magenta = "#b48ead"
cyan = "#88c0d0"
white = "#e5e9f0"

[colors.bright]
black = "#4c566a"
red = "#bf616a"
green = "#a3be8c"
yellow = "#ebcb8b"
blue = "#81a1c1"
magenta = "#b48ead"
cyan = "#8fbcbb"
white = "#eceff4"
`);

    expect(definition.name).toBe('nord');
    expect(definition.colors['background']).toBe('#2E3440');
    expect(definition.ansi.bright).toHaveLength(8);
    expect(definition.ansi.cursor).toBe('#ECEFF4');
  });

  it('imports iTerm2 plist colors', async () => {
    const { definition } = await importFixture('plist.itermcolors', `
<plist><dict>
<key>Background Color</key><dict>
<key>Red Component</key><real>0.1</real>
<key>Green Component</key><real>0.2</real>
<key>Blue Component</key><real>0.3</real>
</dict>
<key>Foreground Color</key><dict>
<key>Red Component</key><real>0.8</real>
<key>Green Component</key><real>0.9</real>
<key>Blue Component</key><real>1</real>
</dict>
<key>Ansi 0 Color</key><dict>
<key>Red Component</key><real>0</real>
<key>Green Component</key><real>0</real>
<key>Blue Component</key><real>0</real>
</dict>
</dict></plist>
`);

    expect(definition.colors['background']).toBe('#1A334D');
    expect(definition.colors['text']).toBe('#CCE6FF');
    expect(definition.ansi.normal[0]).toBe('#000000');
  });

  it('imports Gogh shell palettes', async () => {
    const { definition } = await importFixture('gogh.sh', `
BACKGROUND_COLOR="#101820"
FOREGROUND_COLOR="#F2F4F8"
CURSOR_COLOR="#F2F4F8"
COLOR_01="#000000"
COLOR_02="#D12F2C"
COLOR_03="#819400"
COLOR_04="#B08500"
COLOR_05="#2587CC"
COLOR_06="#696EBF"
COLOR_07="#289C93"
COLOR_08="#A0A0A0"
COLOR_09="#5D5D5D"
COLOR_10="#F54235"
COLOR_11="#B8C800"
COLOR_12="#F6C600"
COLOR_13="#2B9AF3"
COLOR_14="#826BDB"
COLOR_15="#33D6C5"
COLOR_16="#F5F5F5"
`);

    expect(definition.colors['background']).toBe('#101820');
    expect(definition.colors['error']).toBe('#D12F2C');
    expect(definition.ansi.normal).toHaveLength(8);
  });

  it('imports Windows Terminal JSON palettes', async () => {
    const { result, definition } = await importFixture('win.json', JSON.stringify({
      name: 'Win Theme',
      background: '#0C0C0C',
      foreground: '#CCCCCC',
      cursorColor: '#FFFFFF',
      black: '#0C0C0C',
      red: '#C50F1F',
      green: '#13A10E',
      yellow: '#C19C00',
      blue: '#0037DA',
      purple: '#881798',
      cyan: '#3A96DD',
      white: '#CCCCCC',
      brightBlack: '#767676',
      brightRed: '#E74856',
      brightGreen: '#16C60C',
      brightYellow: '#F9F1A5',
      brightBlue: '#3B78FF',
      brightPurple: '#B4009E',
      brightCyan: '#61D6D6',
      brightWhite: '#F2F2F2',
    }));

    expect(result.themePath).toBe(join(home, 'themes', 'win-theme.json'));
    expect(result.packPath).toBe(join(home, 'theme-packs', 'win-theme', 'win-theme.json'));
    expect(definition.name).toBe('win-theme');
    expect(definition.ansi.bright[7]).toBe('#F2F2F2');
  });
});

async function importFixture(
  name: string,
  text: string,
): Promise<{
  readonly result: Awaited<ReturnType<typeof importThemeSource>>;
  readonly definition: ImportedThemeDefinition;
}> {
  const path = join(fixtures, name);
  await writeFile(path, text, 'utf-8');
  const result = await importThemeSource(path);
  const definition = JSON.parse(await readFile(result.themePath, 'utf-8')) as ImportedThemeDefinition;
  return { result, definition };
}
