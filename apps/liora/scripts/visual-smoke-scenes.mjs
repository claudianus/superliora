#!/usr/bin/env node
/**
 * Capture curated TUI scenes for the public site Theatre SSOT.
 * Writes .superliora/visual-smoke/scenes/<id>.{ansi,txt} and optionally
 * copies into apps/site/public/tui-frames/.
 *
 * Usage:
 *   node apps/liora/scripts/visual-smoke-scenes.mjs
 *   node apps/liora/scripts/visual-smoke-scenes.mjs --site
 */
import { mkdir, mkdtemp, rm, writeFile, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const bundlePath = join(repoRoot, 'apps/liora/dist/main.mjs');
const snapshotDir = join(repoRoot, '.superliora/visual-smoke/scenes');
const siteFramesDir = join(repoRoot, 'apps/site/public/tui-frames');
const copyToSite = process.argv.includes('--site');

const COLS = 120;
const ROWS = 36;
const SETTLE_MS = 2200;
const STEP_MS = 900;
const LONG_MS = 1600;

const C = {
  primary: '\x1b[38;2;0;213;255m',
  accent: '\x1b[38;2;167;139;250m',
  text: '\x1b[38;2;230;237;243m',
  dim: '\x1b[38;2;154;167;178m',
  muted: '\x1b[38;2;111;122;134m',
  success: '\x1b[38;2;54;211;153m',
  warn: '\x1b[38;2;245;197;66m',
  error: '\x1b[38;2;255;92;122m',
  user: '\x1b[38;2;253;230;138m',
  reset: '\x1b[0m',
};

const SCENE_IDS = [
  'idle-welcome',
  'chrome-bands',
  'job-deck',
  'command-hub',
  'model-picker',
  'status-route',
  'ask-mode',
  'inbox',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(input) {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '');
}

function lastSyncBody(frames) {
  const re = /\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g;
  let match;
  let last = '';
  while ((match = re.exec(frames)) !== null) {
    last = match[1];
  }
  return last || frames.slice(-120_000);
}

function paintLine(line, color) {
  return `${color}${line}${C.reset}`;
}

function box(title, bodyLines, width = 96) {
  const inner = width - 4;
  const titleBit = ` ${title} `;
  const topFill = Math.max(1, inner - titleBit.length + 1);
  const top = `╭${titleBit}${'─'.repeat(topFill)}╮`;
  const bottom = `╰${'─'.repeat(width - 2)}╯`;
  const mid = bodyLines.map((line) => {
    const plain = stripAnsi(line);
    const clipped = plain.length > inner ? `${plain.slice(0, inner - 1)}…` : plain;
    const pad = Math.max(0, inner - clipped.length);
    // Rebuild from clipped plain when overflow; keep ANSI when it fits.
    const content =
      plain.length > inner
        ? `${C.text}${clipped}${C.reset}${' '.repeat(pad)}`
        : `${line}${' '.repeat(pad)}`;
    return `│ ${content} │`;
  });
  return [top, ...mid, bottom].join('\n');
}

function colorizeChrome(txt) {
  return txt
    .split('\n')
    .map((line) => {
      if (line.includes('Todo Board') || line.includes('Worker Dock')) return paintLine(line, C.primary);
      if (line.includes('● coder') || line.includes('+ ●') || line.includes('+ ✓') || line.includes('✓ Bash')) {
        return paintLine(line, C.success);
      }
      if (line.includes('failed') || line.includes('interrupted') || line.includes('❯ int')) {
        return paintLine(line, C.warn);
      }
      if (
        line.includes('FLEET') ||
        line.includes('BOARD') ||
        line.includes('TAPE') ||
        line.includes('WKR') ||
        line.includes('TK ')
      ) {
        return paintLine(line, C.dim);
      }
      return paintLine(line, C.text);
    })
    .join('\n');
}

const CHROME_BANDS_TXT = `╭ Todo Board · 1/3 done ───────────────────────────────────────────────────────────────────────────╮
│   flow +3 · ███░░░░░ 33% · wip 1/1 · next 1 · done 1                                             │
│   Doing (1)                    │ Next (1)                     │ Done (1)                         │
│   ──────────────────────────── │ ──────────────────────────── │ ────────────────────────────     │
│   + ● 배포 Job interrupt 복구  │ + ○ GH Pages URL 확인 및 공… │ + ✓ 애니메이션 완료 (2f8)        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

╭ Worker Dock · 1 worker · Σ820/s · 50s ───────────────────────────────────────────────────────────╮
│ FLEET 1 · Σ820/s · Σ42.0k · wall 50s · job-fail 6 · ⏸1 · ░░░░░░░░                               │
│ TK  Bash✓coderexit0 · Read▸coder                                                                 │
│ WKR      ST MODEL    ELAP TOOLS   TOK    /s  SPARK TODO LIVE                                     │
│ ● coder    qwen3.8…  50s    14  42.0k 820/s ▃▅█   1/3 ◌ Checking Pages DNS before share link     │
│ TAPE                                                                                             │
│ 12s ago ✓ Bash gh pages deploy exit 0                                                            │
│     now ▸ Read CNAME                                                                             │
│ BOARD                                                                                            │
│ running 1 · interrupted 1 · failed 6 · done 0                                                    │
│ ❯ int00000 배포 Job interrupted                                                                  │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
`;

function authoredScenes() {
  return {
    'idle-welcome': {
      ansi: [
        '',
        `  ${C.primary}SuperLiora${C.reset}  ${C.muted}Neon Noir · conductor${C.reset}`,
        `  ${C.text}Finish the work. Watch the workers.${C.reset}`,
        '',
        `  ${C.accent}Tip${C.reset}  ${C.dim}Describe the outcome — not the steps.${C.reset}`,
        `       ${C.dim}Jobs run in the background while you stay here.${C.reset}`,
        '',
        `  ${C.muted}/login${C.reset}   connect a model`,
        `  ${C.muted}/model${C.reset}   Smart Auto or pick a model`,
        `  ${C.muted}Alt+J${C.reset}    open Job Deck`,
        `  ${C.muted}Ctrl+K${C.reset}   Command Hub`,
        '',
        `  ${C.primary}❯${C.reset} `,
      ].join('\n'),
    },
    'chrome-bands': {
      ansi: colorizeChrome(CHROME_BANDS_TXT),
    },
    'job-deck': {
      ansi: box('Job Deck · Alt+J', [
        `${C.primary}● job_a1b2${C.reset}  ${C.success}running${C.reset}  fix login redirect after OAuth`,
        `${C.dim}branch liora/job-a1b2 · 42s · 820 tok/s${C.reset}`,
        '',
        `${C.accent}diff${C.reset}  src/auth/callback.ts`,
        `${C.success}+  return redirect("/app")${C.reset}`,
        `${C.error}-  return redirect("/")${C.reset}`,
        '',
        `${C.dim}tests${C.reset}  ${C.success}✓ auth.redirect${C.reset}  ${C.muted}12 passed${C.reset}`,
        `${C.dim}Land${C.reset}   ready when green — push stays optional`,
      ]),
    },
    'command-hub': {
      ansi: box('Command Hub · Ctrl+K', [
        `${C.primary}❯${C.reset} model`,
        '',
        `${C.success}▸ /model${C.reset}              ${C.dim}picks Smart Auto or a model${C.reset}`,
        `  /status               ${C.dim}route · fallback · pools${C.reset}`,
        `  /jobs                 ${C.dim}list background jobs${C.reset}`,
        `  /theme                ${C.dim}Neon Noir and friends${C.reset}`,
        `  Visual Quality        ${C.dim}motion · phosphor · density${C.reset}`,
        `  Extensions            ${C.dim}skills · MCP · hooks${C.reset}`,
      ]),
    },
    'model-picker': {
      ansi: box('/model · Neon Noir', [
        `${C.primary}● Smart Auto${C.reset}          ${C.dim}picks a live model for this turn${C.reset}`,
        `  qwen3-coder           ${C.muted}fast · tools${C.reset}`,
        `  claude-sonnet         ${C.muted}deep · long context${C.reset}`,
        `  custom-endpoint       ${C.muted}your OpenAI-compatible URL${C.reset}`,
        '',
        `${C.dim}fallback${C.reset}  qwen3-coder → claude-sonnet`,
        `${C.dim}roles${C.reset}     explore · coder · plan`,
      ]),
    },
    'status-route': {
      ansi: box('/status · route', [
        `${C.primary}model${C.reset}     Smart Auto  ${C.success}live${C.reset}`,
        `${C.dim}fallback${C.reset}  qwen3-coder → claude-sonnet`,
        `${C.dim}oauth${C.reset}     anthropic pool  ${C.success}2 ready${C.reset}`,
        `${C.dim}api keys${C.reset}  openrouter pool ${C.success}3 ready${C.reset}`,
        `${C.dim}endpoint${C.reset}  custom https://llm.example.test/v1`,
        '',
        `${C.accent}Never-Halt${C.reset}  on  ${C.dim}retry · swap · keep the job alive${C.reset}`,
      ]),
    },
    'ask-mode': {
      ansi: box('Ask · Shift-Tab', [
        `${C.warn}mode${C.reset}  Ask  ${C.dim}(no new jobs — answers only)${C.reset}`,
        '',
        `${C.user}you${C.reset}`,
        `${C.text}Why did the OAuth callback bounce to /?${C.reset}`,
        '',
        `${C.primary}conductor${C.reset}`,
        `${C.text}Callback still returns redirect("/"). Deck shows the one-line fix.${C.reset}`,
        `${C.dim}Switch to Build when you want a job to apply it.${C.reset}`,
      ]),
    },
    inbox: {
      ansi: box('Inbox · Alt+I · needs_user', [
        `${C.warn}● job_a1b2${C.reset}  Which redirect wins after login?`,
        `  ${C.dim}/app (product) · /dashboard (legacy)${C.reset}`,
        '',
        `${C.primary}❯${C.reset} /app`,
        '',
        `${C.success}answered${C.reset}  job resumes in its own worktree`,
      ]),
    },
  };
}

async function tryLiveCapture() {
  if (!existsSync(bundlePath)) {
    console.warn('visual-smoke-scenes: missing bundle — authored frames only');
    return null;
  }

  let spawn;
  try {
    ({ spawn } = await import('node-pty'));
  } catch {
    console.warn('visual-smoke-scenes: node-pty unavailable — authored frames only');
    return null;
  }

  const home = await mkdtemp(join(tmpdir(), 'visual-smoke-home-'));
  const cwd = await mkdtemp(join(tmpdir(), 'visual-smoke-cwd-'));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'settings.json'), JSON.stringify({ theme: 'superliora-neon-noir' }, null, 2));

  let frames = '';
  let pty;
  try {
    pty = spawn(process.execPath, [bundlePath], {
      name: 'xterm-256color',
      cols: COLS,
      rows: ROWS,
      cwd,
      env: {
        ...process.env,
        SUPERLIORA_HOME: home,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        NO_COLOR: '',
      },
    });
  } catch (error) {
    console.warn(
      `visual-smoke-scenes: pty spawn failed (${error instanceof Error ? error.message : String(error)}) — authored frames only`,
    );
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
    return null;
  }
  pty.onData((chunk) => {
    frames += chunk;
  });

  const snapshots = {};

  try {
    await sleep(SETTLE_MS);
    snapshots['idle-welcome'] = lastSyncBody(frames);

    pty.write('/status\r');
    await sleep(LONG_MS);
    snapshots['status-route'] = lastSyncBody(frames);

    pty.write('\u001b');
    await sleep(STEP_MS);
    pty.write('/model\r');
    await sleep(LONG_MS);
    snapshots['model-picker'] = lastSyncBody(frames);

    pty.write('\u001b');
    await sleep(STEP_MS);
    pty.write('\u000b'); // Ctrl+K
    await sleep(LONG_MS);
    snapshots['command-hub'] = lastSyncBody(frames);

    pty.write('\u001b');
    await sleep(STEP_MS);
    pty.resize(160, 36);
    await sleep(STEP_MS);
    snapshots['chrome-bands'] = lastSyncBody(frames);

    for (const id of Object.keys(snapshots)) {
      const plain = stripAnsi(snapshots[id] ?? '');
      if (plain.replace(/\s+/g, '').length < 40) delete snapshots[id];
    }
  } catch (error) {
    console.warn(
      `visual-smoke-scenes: live capture aborted (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    try {
      pty.write('\u0003');
      await sleep(200);
      pty.write('\u0003');
      await sleep(200);
      pty.kill();
    } catch {
      // gone
    }
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }

  return Object.keys(snapshots).length > 0 ? snapshots : null;
}

async function main() {
  await mkdir(snapshotDir, { recursive: true });
  const authored = authoredScenes();

  const desktopChrome = '/Users/modumaru/Desktop/code/superliora/.superliora/visual-smoke/chrome-bands-preview.txt';
  if (existsSync(desktopChrome)) {
    const txt = await readFile(desktopChrome, 'utf8');
    authored['chrome-bands'] = { ansi: colorizeChrome(txt) };
  }

  const live = await tryLiveCapture();

  const manifest = {
    generatedAt: new Date().toISOString(),
    cols: COLS,
    rows: ROWS,
    theme: 'superliora-neon-noir',
    scenes: [],
  };

  for (const id of SCENE_IDS) {
    const fallback = authored[id];
    const liveAnsi = live?.[id];
    const useLive = Boolean(liveAnsi && stripAnsi(liveAnsi).trim().length > 40);
    const ansi = useLive ? liveAnsi : fallback.ansi;
    const txt = stripAnsi(ansi);
    await writeFile(join(snapshotDir, `${id}.ansi`), ansi.endsWith('\n') ? ansi : `${ansi}\n`);
    await writeFile(join(snapshotDir, `${id}.txt`), txt.endsWith('\n') ? txt : `${txt}\n`);
    manifest.scenes.push({
      id,
      source: useLive ? 'live' : id === 'chrome-bands' ? 'capture' : 'authored',
      lines: txt.split('\n').length,
    });
    console.log(
      `scene ${id}: ${useLive ? 'LIVE' : id === 'chrome-bands' ? 'capture' : 'authored'} (${String(txt.split('\n').length)} lines)`,
    );
  }

  await writeFile(join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (copyToSite) {
    await mkdir(siteFramesDir, { recursive: true });
    for (const scene of manifest.scenes) {
      await copyFile(join(snapshotDir, `${scene.id}.ansi`), join(siteFramesDir, `${scene.id}.ansi`));
      await copyFile(join(snapshotDir, `${scene.id}.txt`), join(siteFramesDir, `${scene.id}.txt`));
    }
    // Compact JSON for site runtime (scene → playlist clusters).
    const siteManifest = {
      ...manifest,
      playlist: [
        { cluster: 'keep-going', scenes: ['status-route', 'model-picker'] },
        { cluster: 'see-fleet', scenes: ['chrome-bands', 'job-deck', 'inbox'] },
        { cluster: 'stay-control', scenes: ['ask-mode', 'inbox'] },
        { cluster: 'studio', scenes: ['command-hub', 'job-deck'] },
      ],
      hero: ['idle-welcome', 'chrome-bands', 'job-deck', 'command-hub'],
    };
    await writeFile(join(siteFramesDir, 'manifest.json'), `${JSON.stringify(siteManifest, null, 2)}\n`);
    console.log(`visual-smoke-scenes: copied to ${siteFramesDir}`);
  }

  console.log(`visual-smoke-scenes: wrote ${String(manifest.scenes.length)} scenes → ${snapshotDir}`);
}

main().catch((error) => {
  console.error(`visual-smoke-scenes: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
