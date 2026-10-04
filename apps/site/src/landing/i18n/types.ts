export type Locale = "ko" | "en";

export interface NavItem {
  label: string;
  href: string;
}

export type DocSlug = "getting-started" | "how-conductor-works" | "jobs" | "control-tower" | "reference";

export type IconName =
  | "command"
  | "network"
  | "git-branch"
  | "shield"
  | "box"
  | "plug"
  | "gauge"
  | "history"
  | "keyboard"
  | "upload";

export interface Dict {
  meta: { title: string };
  header: {
    nav: NavItem[];
    docs: string;
    github: string;
    releaseLabel: string;
  };
  hero: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    sub: string;
    osTabs: { unix: string; windows: string };
    installNote: string;
    copy: string;
    copied: string;
    cta1: string;
    cta2: string;
    /** `{providers}` is replaced with the rounded models.dev provider count. */
    stats: { k: string; v: string }[];
  };
  tui: {
    windowTitle: string;
    hints: string;
    liveTag: string;
    replayNote: string;
    dock: { running: string; finished: string };
  };
  how: {
    eyebrow: string;
    title: string;
    lede: string;
    you: string;
    youPrompt: string;
    conductor: { title: string; body: string };
    tools: { name: string; tag: string; body: string; sample: string[]; lands: string }[];
    operator: { label: string; items: { title: string; body: string; icon: IconName }[] };
    steps: { no: string; title: string; body: string; foot: string }[];
  };
  demo: {
    eyebrow: string;
    title: string;
    lede: string;
    focusHint: string;
    focusedHint: string;
    keys: { chord: string; label: string; note?: string; action: "deck" | "inbox" | "hub" | "quota" | "dock" }[];
    promptPlaceholder: string;
    demoReply: string;
    unknownCommand: string;
    deck: {
      title: string;
      subtitle: string;
      groups: { blocked: string; remaining: string; done: string };
      states: { queued: string; running: string; needs_user: string; done: string };
      actions: string;
      worktree: string;
      answer: string;
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
      groups: Record<"jobs" | "provider" | "session" | "app", string>;
      items: { label: string; hint: string; group: "jobs" | "provider" | "session" | "app"; kw: string }[];
    };
    quota: {
      title: string;
      note: string;
      rows: { provider: string; detail: string; pct: number }[];
    };
    dock: {
      title: string;
      modes: { auto: string; pinned: string; hidden: string };
      hint: string;
    };
    transcriptNote: string;
  };
  features: {
    eyebrow: string;
    title: string;
    lede: string;
    cards: { title: string; body: string; foot: string; icon: IconName }[];
    lifecycle: { label: string; badge: string; steps: { tag: string; text: string }[] };
    /** `{providers}`, `{models}`, `{date}` come from the generated models.dev snapshot. */
    providers: { label: string; note: string; more: string };
  };
  surfaces: {
    eyebrow: string;
    title: string;
    lede: string;
    tabs: string[];
    cliLabel: string;
    cli: { cmd: string; desc: string }[];
    server: {
      lead: string;
      lines: { p: string; text: string }[];
      bullets: string[];
    };
    sdk: {
      lead: string;
      bullets: string[];
      note: string;
    };
    ide: {
      lead: string;
      bullets: string[];
      lines: string[];
    };
  };
  install: {
    eyebrow: string;
    title: string;
    lede: string;
    tabs: string[];
    notes: { title: string; body: string }[];
    afterTitle: string;
    afterSteps: string[];
    copy: string;
    copied: string;
  };
  footer: {
    tagline: string;
    project: { title: string; links: NavItem[] };
    guides: { title: string; labels: Record<DocSlug, string> };
    community: { title: string; links: NavItem[] };
    localeNote: string;
    colophon: string;
    license: string;
  };
}
