import {
  LANDING_SECTION_IDS,
  USAGE_COMMANDS,
  WORKFLOW_KEYS,
  WORKFLOW_STEP_IDS,
  type LandingSectionId,
} from './content';
import { translations, type Lang } from './i18n/translations';

export interface LandingManifest {
  lang: Lang;
  nav: { id: LandingSectionId; href: string; label: string }[];
  hero: {
    h1: string;
    lead: string;
    installCta: string;
    command: string;
  };
  features: {
    title: string;
    body: string;
    items: { id: string; title: string; lead: string }[];
  };
  usage: { id: string; cmd: string; title: string; body: string }[];
  workflow: { id: string; title: string; body: string }[];
  workflowKeys: { jobDeck: string; inbox: string };
  install: {
    requirements: string;
    commands: string[];
  };
}

export function getLandingManifest(lang: Lang): LandingManifest {
  const t = translations[lang];
  return {
    lang,
    nav: LANDING_SECTION_IDS.map((id) => ({
      id,
      href: `#${id}`,
      label: t.nav[id],
    })),
    hero: {
      h1: t.hero.h1,
      lead: t.hero.lead,
      installCta: t.hero.install,
      command: t.hero.command,
    },
    features: {
      title: t.clusters.title,
      body: t.clusters.body,
      items: t.clusters.items.map((cluster) => ({
        id: cluster.id,
        title: cluster.title,
        lead: cluster.lead,
      })),
    },
    usage: USAGE_COMMANDS.map((spec) => {
      const item = t.usage.items.find((row) => row.id === spec.id);
      if (!item) {
        throw new Error(`missing usage copy for ${spec.id} (${lang})`);
      }
      return {
        id: spec.id,
        cmd: spec.cmd,
        title: item.title,
        body: item.body,
      };
    }),
    workflow: WORKFLOW_STEP_IDS.map((id) => {
      const step = t.workflow.steps.find((row) => row.id === id);
      if (!step) {
        throw new Error(`missing workflow step ${id} (${lang})`);
      }
      return { id, title: step.title, body: step.body };
    }),
    workflowKeys: { ...WORKFLOW_KEYS },
    install: {
      requirements: t.install.requirements,
      commands: t.install.commands.map((row) => row.cmd),
    },
  };
}

export function installCommandsFromReadme(markdown: string): { sh: string; ps: string; cmd: string } {
  const sh = markdown.match(/curl -fsSL \S+install\.sh \| bash/)?.[0];
  const cmd = markdown.match(
    /powershell -NoProfile -ExecutionPolicy Bypass -Command "irm \S+install\.ps1 \| iex"/,
  )?.[0];
  const ps = markdown.match(/irm \S+install\.ps1 \| iex/)?.[0];
  if (!sh || !ps || !cmd) {
    throw new Error('README is missing the SuperLiora install one-liners');
  }
  return { sh, ps, cmd };
}

export {
  INSTALL_CMD,
  INSTALL_PS,
  INSTALL_SH,
  LANDING_SECTION_IDS,
  NODE_REQUIREMENT,
  USAGE_COMMANDS,
  WORKFLOW_KEYS,
} from './content';
