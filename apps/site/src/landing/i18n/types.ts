export type Locale = "ko" | "en";

export interface NavItem {
  label: string;
  href: string;
}

export interface JobSeed {
  id: string;
  kind: string;
  title: string;
  state: "queued" | "running" | "needs_user" | "done";
  model: string;
  owns: string;
  progress: number;
  verify?: string;
  sha?: string;
}

export interface Dict {
  meta: { title: string };
  header: {
    nav: NavItem[];
    version: string;
    github: string;
    docs: string;
  };
  hero: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    sub: string;
    installLabel: string;
    installCmd: string;
    copied: string;
    copy: string;
    nodeNote: string;
    cta1: string;
    cta2: string;
    platforms: string[];
    stats: { k: string; v: string }[];
  };
  tui: {
    windowTitle: string;
    hints: string;
    liveTag: string;
    replayNote: string;
  };
  flow: {
    eyebrow: string;
    title: string;
    lede: string;
    steps: { no: string; title: string; body: string; foot: string }[];
    railLabels: string[];
  };
  demo: {
    eyebrow: string;
    title: string;
    lede: string;
    focusHint: string;
    focusedHint: string;
    keys: { chord: string; label: string; action: string }[];
    deck: {
      title: string;
      subtitle: string;
      states: Record<string, string>;
      owns: string;
      ledger: string;
      verifyOk: string;
      empty: string;
    };
    inbox: {
      title: string;
      subtitle: string;
      from: string;
      question: string;
      options: string[];
      answered: string;
      empty: string;
    };
    hub: {
      placeholder: string;
      noMatch: string;
      groups: Record<string, string>;
      items: { label: string; hint: string; group: string; kw: string }[];
    };
    quota: {
      title: string;
      note: string;
      rows: { provider: string; detail: string; pct: number }[];
    };
    plan: {
      title: string;
      unspecified: string;
      items: string[];
      handoff: string;
    };
    transcriptNote: string;
  };
  systems: {
    eyebrow: string;
    title: string;
    lede: string;
    cards: { no: string; title: string; body: string; foot: string; icon: string }[];
    providersLabel: string;
    /** Templates filled with the live catalog counts: {providers} {models} {date} {count}. */
    providersNote: string;
    providersMore: string;
    failover: { label: string; steps: { tag: string; text: string; cls: string }[] };
  };
  surfaces: {
    eyebrow: string;
    title: string;
    lede: string;
    tabs: string[];
    cli: { cmd: string; desc: string }[];
    server: {
      lead: string;
      lines: { p: string; text: string }[];
      bullets: string[];
    };
    sdk: {
      lead: string;
      bullets: string[];
    };
    ide: {
      lead: string;
      bullets: string[];
    };
  };
  install: {
    eyebrow: string;
    title: string;
    lede: string;
    tabs: string[];
    cmds: { label: string; code: string }[];
    notes: { title: string; body: string }[];
    afterTitle: string;
    afterSteps: string[];
    copy: string;
    copied: string;
  };
  footer: {
    tagline: string;
    columns: { title: string; links: { label: string; href: string }[] }[];
    localeNote: string;
    colophon: string;
    license: string;
  };
}
