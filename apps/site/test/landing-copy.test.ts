import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getLandingManifest,
  installCommandsFromReadme,
  INSTALL_CMD,
  INSTALL_PS,
  INSTALL_SH,
  LANDING_SECTION_IDS,
  NODE_REQUIREMENT,
  USAGE_COMMANDS,
  WORKFLOW_KEYS,
} from '../src/landing';
import { PRODUCT_VERSION, translations, type Lang } from '../src/i18n/translations';

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
    expect(installCommandsFromReadme(en)).toEqual({ sh: INSTALL_SH, ps: INSTALL_PS, cmd: INSTALL_CMD });
    expect(installCommandsFromReadme(ko)).toEqual({ sh: INSTALL_SH, ps: INSTALL_PS, cmd: INSTALL_CMD });
    expect(en).toContain('24.15.0');
    expect(ko).toContain('24.15.0');
  });

  it.each(['ko', 'en'] as const)(
    'exposes 설치법 / 사용법 / 주요 기능 / 워크플로우 as first-class nav on %s',
    (lang: Lang) => {
      const manifest = getLandingManifest(lang);
      expect(manifest.nav.map((item) => item.id)).toEqual([...LANDING_SECTION_IDS]);
      expect(manifest.nav.map((item) => item.href)).toEqual(LANDING_SECTION_IDS.map((id) => `#${id}`));
      expect(manifest.install.commands).toEqual([INSTALL_SH, INSTALL_PS, INSTALL_CMD]);
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

  it('teaches 0.12.7–0.12.8 install facts on landing and getting-started', () => {
    for (const lang of ['ko', 'en'] as const) {
      const t = translations[lang];
      const page = t.docs['getting-started'];
      const docsBlob = page.sections.map((section) => `${section.heading}\n${section.body}\n${section.code ?? ''}`).join('\n');
      expect(t.install.body).toMatch(/\/host-setup/);
      expect(t.install.body).toMatch(/Desktop|바탕/);
      expect(docsBlob).toContain('SUPERLIORA_HOME');
      expect(docsBlob).toContain('install.ps1 --home');
      expect(docsBlob).toContain('/host-setup');
      expect(docsBlob).toContain('SUPERLIORA_LOCALE');
      expect(docsBlob).toContain('CaskaydiaCove');
      expect(docsBlob).toContain('Oh My Posh');
      expect(docsBlob).toContain('zoxide');
      expect(docsBlob).toContain('fzf');
      expect(docsBlob).toMatch(/Desktop|바탕/);
      expect(docsBlob).toContain(INSTALL_SH);
      expect(docsBlob).toContain(INSTALL_PS);
      expect(docsBlob).toContain(INSTALL_CMD);
      expect(page.sections.map((section) => section.heading)).toEqual(
        lang === 'ko' ? ['설치법', '설치 후', '사용법', '워크플로우'] : ['Install', 'After install', 'Usage', 'Workflow'],
      );
      expect(t.install.body).toContain('24.15.0');
      expect(t.install.body).toMatch(/download|받습/);
      expect(t.install.body).toContain('liora upgrade');
      expect(docsBlob).toContain('liora upgrade');
      expect(docsBlob).toContain('/upgrade');
      expect(docsBlob).toMatch(/irm \| iex/);
      expect(docsBlob).toMatch(/ignores flags|플래그를 무시/);
      expect(docsBlob).toMatch(/24\.15\.0/);
      expect(docsBlob).toMatch(/data home|데이터 홈/);
    }
  });

  it('teaches 0.12.9 upgrade, hub, and hygiene commands in EN and KO', () => {
    expect(PRODUCT_VERSION).toBe('0.12.16');
    const readmeTokens = [
      'liora upgrade',
      'liora doctor',
      'liora gc',
      '/host-setup',
      '/jobs',
      '/locale',
      'Alt+J',
      'Alt+I',
      'Ctrl+K',
      'SUPERLIORA_LOCALE',
      'Command Hub',
      'install.ps1 --home',
    ];
    for (const name of ['README.md', 'README.ko.md'] as const) {
      const readme = readFileSync(resolve(repoRoot, name), 'utf8');
      for (const token of readmeTokens) {
        expect(readme, name).toContain(token);
      }
      expect(readme, name).toContain('24.15.0');
      expect(readme, name).toMatch(/irm \| iex/);
      expect(readme, name).toMatch(/ignores flags|플래그를 무시/);
      expect(readme, name).toMatch(/download|받/);
      expect(readme, name).not.toMatch(/# After install, double-click SuperLiora on the Desktop/);
      expect(readme, name).not.toMatch(/# 설치 후 바탕 화면의 SuperLiora를 더블클릭/);
      expect(readme, name).toMatch(/double-click SuperLiora on the Desktop|바탕 화면의 SuperLiora를 더블클릭/);
      expect(readme, name).not.toMatch(/\bliora vis\b/);
    }

    for (const lang of ['ko', 'en'] as const) {
      const t = translations[lang];
      const started = t.docs['getting-started'];
      const afterInstall = started.sections.find((section) => section.heading === (lang === 'ko' ? '설치 후' : 'After install'));
      expect(afterInstall?.body).toContain('liora upgrade');
      expect(afterInstall?.body).toContain('/upgrade');
      expect(afterInstall?.body).toContain('--main');
      expect(afterInstall?.body).toContain('/locale');

      const slash = t.docs.reference.sections.find((section) => section.heading === (lang === 'ko' ? '슬래시' : 'Slash'));
      expect(slash?.body).toContain('/upgrade');
      expect(slash?.body).toContain('/resume');
      expect(slash?.body).toMatch(/\/sessions/);
      expect(slash?.body).toContain('/locale');
      expect(slash?.body).toContain('/permission');
      expect(slash?.body).toMatch(/manual\|auto\|yolo/);
      expect(slash?.body).toContain('/performance');
      expect(slash?.body).not.toMatch(/\/appearance/);
      expect(slash?.body).not.toMatch(/\/transcript/);

      const reference = t.docs.reference;
      const refBlob = reference.sections
        .map((section) => `${section.heading}\n${section.body}\n${section.code ?? ''}`)
        .join('\n');
      expect(refBlob).toContain('liora upgrade');
      expect(refBlob).toContain('liora doctor');
      expect(refBlob).toContain('liora gc');
      expect(refBlob).not.toMatch(/\bliora vis\b/);

      const tower = [t.tower.items.map((item) => item.body).join('\n'), t.docs['control-tower'].sections.map((section) => section.body).join('\n')].join('\n');
      expect(tower).toContain('Ctrl+Space');
      expect(tower).toMatch(/\?/);
      expect(tower).toContain('/help');
      expect(tower).toMatch(/Cmd/);

      const clusterBlob = t.clusters.items
        .flatMap((cluster) => cluster.features.map((feature) => `${feature.id} ${feature.body}`))
        .join('\n');
      expect(clusterBlob).toMatch(/performance/i);
      expect(clusterBlob).toContain('/performance');
      expect(t.install.body).toContain('liora upgrade');
    }
  });

  it('teaches 0.12.10 Windows chrome motion in EN and KO', () => {
    expect(PRODUCT_VERSION).toBe('0.12.16');
    for (const lang of ['ko', 'en'] as const) {
      const t = translations[lang];
      const visual = t.clusters.items
        .flatMap((cluster) => cluster.features)
        .find((feature) => feature.id === 'visual-quality');
      expect(visual?.body).toContain('Windows Terminal');
      expect(visual?.body).toMatch(/classic|클래식/i);
      expect(visual?.body).toMatch(/console|콘솔/);

      const afterInstall = t.docs['getting-started'].sections.find(
        (section) => section.heading === (lang === 'ko' ? '설치 후' : 'After install'),
      );
      expect(afterInstall?.body).toContain('Windows Terminal');
      expect(afterInstall?.body).toMatch(/splash|스플래시/);
    }
  });

  it('teaches live /quota and the footer remaining chip in EN and KO', () => {
    for (const name of ['README.md', 'README.ko.md'] as const) {
      const readme = readFileSync(resolve(repoRoot, name), 'utf8');
      expect(readme, name).toContain('/quota');
      expect(readme, name).not.toMatch(/\bliora quota\b/);
    }

    for (const lang of ['ko', 'en'] as const) {
      const t = translations[lang];
      const slash = t.docs.reference.sections.find((section) => section.heading === (lang === 'ko' ? '슬래시' : 'Slash'));
      expect(slash?.body).toContain('/quota');
      expect(slash?.body).toMatch(/footer|푸터/);
      expect(slash?.body).toMatch(/hidden|숨깁/);

      const reference = t.docs.reference;
      const refBlob = reference.sections
        .map((section) => `${section.heading}\n${section.body}\n${section.code ?? ''}`)
        .join('\n');
      expect(refBlob).toContain('liora upgrade');
      expect(refBlob).toContain('liora doctor');
      expect(refBlob).toContain('liora gc');
      expect(refBlob).not.toMatch(/\bliora quota\b/);
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
    expect(sections).toMatch(/className="product-band__frame" eager|product-band__frame/);
    expect(sections).toMatch(/className="hero-proof-wrap" eager/);
    expect(sections).toMatch(/hero-band--cinematic/);
    expect(sections).toContain('product-band');
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
    expect(sections).toContain('data-stage="editorial"');
    expect(sections).toContain('workflow-cinema');
    expect(sections).toContain('pillar-grid');
    expect(sections).toContain('usage-table');
    expect(sections).not.toContain('CommandTicker');
    expect(sections).not.toContain('topic-rail');
    expect(readFileSync(resolve(siteSrc, 'components/tui/TuiChrome.tsx'), 'utf8')).toContain('crt-scanlines');
    expect(readFileSync(resolve(siteSrc, 'components/ProductFrame.tsx'), 'utf8')).toContain('TermStream');
    expect(readFileSync(resolve(siteSrc, 'components/TermStream.tsx'), 'utf8')).toContain('data-term-stream="on"');
  });
});
