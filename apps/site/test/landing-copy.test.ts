import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getLandingManifest,
  installCommandsFromReadme,
  INSTALL_PS,
  INSTALL_SH,
  LANDING_SECTION_IDS,
  NODE_REQUIREMENT,
  USAGE_COMMANDS,
  WORKFLOW_KEYS,
} from '../src/landing';
import { translations, type Lang } from '../src/i18n/translations';

const repoRoot = resolve(import.meta.dirname, '../../..');
const siteSrc = resolve(import.meta.dirname, '../src');

const BANNED = [
  { re: /\bultrawork\b/i, label: 'ultrawork' },
  { re: /\bblood\s*moon\b/i, label: 'blood moon' },
  { re: /#E63946|#E8414E/i, label: 'blood moon hex' },
  { re: /\/mission\b/i, label: '/mission' },
  { re: /\/ultrawork\b/i, label: '/ultrawork' },
  { re: /\bultraswarm\b/i, label: 'ultraswarm' },
  { re: /\bllm\s*wiki\b/i, label: 'llm wiki' },
  { re: /\bliora\s*memory\b/i, label: 'liora memory' },
  { re: /\b128\s+(specialist\s+)?(sub)?agents?\b/i, label: '128 agents' },
  { re: /\bMission\s+mode\b/i, label: 'Mission mode' },
  { re: /\bMission\s+Control\b/i, label: 'Mission Control' },
];

function walkStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkStrings(item, out);
  }
  return out;
}

describe('shipped landing copy', () => {
  it('keeps install one-liners identical to README.md and README.ko.md', () => {
    const en = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    const ko = readFileSync(resolve(repoRoot, 'README.ko.md'), 'utf8');
    expect(installCommandsFromReadme(en)).toEqual({ sh: INSTALL_SH, ps: INSTALL_PS });
    expect(installCommandsFromReadme(ko)).toEqual({ sh: INSTALL_SH, ps: INSTALL_PS });
    expect(en).toContain('24.15.0');
    expect(ko).toContain('24.15.0');
  });

  it.each(['ko', 'en'] as const)(
    'exposes 설치법 / 사용법 / 주요 기능 / 워크플로우 as first-class nav on %s',
    (lang: Lang) => {
      const manifest = getLandingManifest(lang);
      expect(manifest.nav.map((item) => item.id)).toEqual([...LANDING_SECTION_IDS]);
      expect(manifest.nav.map((item) => item.href)).toEqual(LANDING_SECTION_IDS.map((id) => `#${id}`));
      expect(manifest.install.commands).toEqual([INSTALL_SH, INSTALL_PS]);
      expect(manifest.install.requirements).toBe(NODE_REQUIREMENT);
      expect(manifest.hero.h1.trim().length).toBeGreaterThan(8);
      expect(manifest.hero.lead.trim().length).toBeGreaterThan(20);
      expect(manifest.hero.installCta.trim().length).toBeGreaterThan(0);
    },
  );

  it('keeps Korean and English section parity for the four required topics', () => {
    const ko = getLandingManifest('ko');
    const en = getLandingManifest('en');
    expect(ko.nav.map((item) => item.id)).toEqual(en.nav.map((item) => item.id));
    expect(ko.usage.map((item) => item.id)).toEqual(en.usage.map((item) => item.id));
    expect(ko.workflow.map((item) => item.id)).toEqual(en.workflow.map((item) => item.id));
    expect(ko.nav.map((item) => item.label)).toEqual(['주요 기능', '사용법', '워크플로우', '설치법']);
    expect(en.nav.map((item) => item.label)).toEqual(['Features', 'Usage', 'Workflow', 'Install']);
    expect(ko.hero.installCta).toBe('설치법');
    expect(en.hero.installCta).toBe('Install');
  });

  it('ships the five usage commands from the product README', () => {
    for (const lang of ['ko', 'en'] as const) {
      const usage = getLandingManifest(lang).usage;
      const cmds = USAGE_COMMANDS.map((item) => item.cmd);
      expect(usage.map((item) => item.cmd)).toEqual(cmds);
      const readme = readFileSync(resolve(repoRoot, lang === 'ko' ? 'README.ko.md' : 'README.md'), 'utf8');
      for (const cmd of cmds) {
        expect(readme).toContain(cmd);
      }
      for (const item of usage) {
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.body.trim().length).toBeGreaterThan(8);
      }
    }
  });

  it('states the Conductor → Job → Inbox → Land workflow with real keys', () => {
    for (const lang of ['ko', 'en'] as const) {
      const manifest = getLandingManifest(lang);
      const blob = [
        manifest.hero.lead,
        ...manifest.workflow.map((step) => `${step.title} ${step.body}`),
        manifest.features.body,
      ].join('\n');
      expect(blob).toMatch(/Conductor/);
      expect(blob).toMatch(/git worktree/);
      expect(blob).toContain(WORKFLOW_KEYS.jobDeck);
      expect(blob).toContain(WORKFLOW_KEYS.inbox);
      expect(blob).toMatch(/Land/);
      expect(manifest.workflow.map((step) => step.id)).toEqual(['write', 'job', 'inbox', 'land']);
    }
  });

  it('keeps retired product language out of shipped translations', () => {
    const hits: string[] = [];
    for (const lang of ['ko', 'en'] as const) {
      for (const text of walkStrings(translations[lang])) {
        for (const ban of BANNED) {
          if (ban.re.test(text)) hits.push(`${lang}: ${ban.label} ← ${text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('renders the four topics as real section ids and a primary install CTA', () => {
    const sections = readFileSync(resolve(siteSrc, 'components/Sections.tsx'), 'utf8');
    const app = readFileSync(resolve(siteSrc, 'App.tsx'), 'utf8');
    for (const id of LANDING_SECTION_IDS) {
      expect(sections).toContain(`id="${id}"`);
    }
    expect(sections).toContain('data-cta="install"');
    expect(sections).toContain('getLandingManifest');
    expect(app).toContain('getLandingManifest');
    expect(app).toContain('href: item.href');
  });

  it('never mounts landing blocks at opacity 0, and keeps the first viewport eager', () => {
    const reveal = readFileSync(resolve(siteSrc, 'components/Reveal.tsx'), 'utf8');
    const bento = readFileSync(resolve(siteSrc, 'components/BentoGrid.tsx'), 'utf8');
    const sections = readFileSync(resolve(siteSrc, 'components/Sections.tsx'), 'utf8');
    const css = readFileSync(resolve(siteSrc, 'index.css'), 'utf8');
    expect(reveal).not.toMatch(/opacity:\s*0/);
    expect(bento).not.toMatch(/opacity:\s*0/);
    expect(reveal).toMatch(/eager/);
    expect(sections).toMatch(/className="hero-copy" eager/);
    expect(sections).toMatch(/className="hero-visual" eager/);
    expect(sections).toMatch(/className="hero-proof-wrap" eager/);
    expect(css).not.toMatch(/html\s*\{[^}]*overflow-x:\s*clip/s);
    expect(css).not.toMatch(/body\s*\{[^}]*overflow-x:\s*clip/s);
  });

  it('ships a WebGL2 field and a live command ticker on the landing', () => {
    const field = readFileSync(resolve(siteSrc, 'components/NoirField.tsx'), 'utf8');
    const ticker = readFileSync(resolve(siteSrc, 'components/CommandTicker.tsx'), 'utf8');
    const app = readFileSync(resolve(siteSrc, 'App.tsx'), 'utf8');
    const sections = readFileSync(resolve(siteSrc, 'components/Sections.tsx'), 'utf8');
    expect(field).toContain('webgl2');
    expect(field).toContain('u_mouse');
    expect(ticker).toContain('getLandingManifest');
    expect(app).toContain('NoirField');
    expect(app).toContain('PointerField');
    expect(app).toContain('LivingField');
    expect(readFileSync(resolve(siteSrc, 'components/LivingField.tsx'), 'utf8')).toContain('data-living="on"');
    expect(readFileSync(resolve(siteSrc, 'components/PointerField.tsx'), 'utf8')).toContain('data-atmosphere="on"');
    expect(readFileSync(resolve(siteSrc, 'components/PointerField.tsx'), 'utf8')).not.toMatch(/if \(reduce\) return null/);
    expect(sections).toContain('CommandTicker');
    expect(sections).toContain('data-stage="cinematic"');
    expect(sections).toContain('workflow-cinema');
    expect(readFileSync(resolve(siteSrc, 'components/tui/TuiChrome.tsx'), 'utf8')).toContain('crt-scanlines');
    expect(readFileSync(resolve(siteSrc, 'components/ProductFrame.tsx'), 'utf8')).toContain('TermStream');
    expect(readFileSync(resolve(siteSrc, 'components/TermStream.tsx'), 'utf8')).toContain('data-term-stream="on"');
  });
});
