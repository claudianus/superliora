import type { Locale } from "../i18n/types";

export type Span = [string, string]; // [text, tone]
export type Tone =
  | "ink"
  | "w"
  | "dim"
  | "faint"
  | "gold"
  | "mint"
  | "red"
  | "azure"
  | "violet";

export interface Chips {
  model: string;
  quota: number;
  inbox: number;
  latency: string;
  branch: string;
}

export type Step =
  | { k: "type"; text: string }
  | { k: "enter" }
  | { k: "line"; spans: Span[] }
  | { k: "task"; spans: Span[]; dur?: number }
  | { k: "pause"; ms: number }
  | { k: "chips"; patch: Partial<Chips> }
  | { k: "clear" };

export function buildSession(locale: Locale): Step[] {
  const koLang = locale === "ko";
  const user = koLang
    ? "웹훅 재시도 폭풍 잡고, 실패 경로 테스트 추가해줘"
    : "Fix the webhook retry storm and add a test for the failing path";
  const reply = koLang
    ? "implement Job 하나로 갑니다. 소유 경로는 src/webhooks — 덱은 Alt+J예요."
    : "Going with one implement job. Ownership is src/webhooks — deck is Alt+J.";
  const inboxMsg = koLang
    ? "인박스 +1 — Stripe 샌드박스 키 없음 · 목으로 두고 진행 (답변은 Alt+I)"
    : "inbox +1 — no Stripe sandbox key · proceeding with a mock (answer at Alt+I)";

  return [
    { k: "chips", patch: { model: "opencode-go/kimi-k3", quota: 82, inbox: 0, latency: "—", branch: "main*" } },
    { k: "type", text: user },
    { k: "enter" },
    { k: "pause", ms: 620 },
    {
      k: "line",
      spans: [
        ["◆ ", "gold"],
        [reply, "ink"],
      ],
    },
    { k: "pause", ms: 420 },
    {
      k: "line",
      spans: [
        ["  ACK ", "faint"],
        ["job_1x9m4qt", "azure"],
        [" [queued] kind=implement model=", "dim"],
        ["opencode-go/kimi-k3", "gold"],
        [" owns=", "dim"],
        ["src/webhooks", "ink"],
      ],
    },
    { k: "pause", ms: 780 },
    {
      k: "task",
      dur: 900,
      spans: [
        ["spawn worktree  ", "dim"],
        ["~/.superliora/worktrees/liora/job_1x9m4qt", "faint"],
      ],
    },
    {
      k: "task",
      dur: 640,
      spans: [
        ["Read  ", "ink"],
        ["src/webhooks/retry.ts", "dim"],
      ],
    },
    {
      k: "task",
      dur: 640,
      spans: [
        ['Grep  "backoff"  ', "ink"],
        ["· 6 hits in 3 files", "faint"],
      ],
    },
    {
      k: "task",
      dur: 980,
      spans: [
        ["Edit  ", "ink"],
        ["src/webhooks/retry.ts", "dim"],
        ["   (+14 −3)", "mint"],
      ],
    },
    {
      k: "line",
      spans: [
        ["     + ", "mint"],
        ["const MAX_TRIES = 5;", "w"],
      ],
    },
    {
      k: "line",
      spans: [
        ["     + ", "mint"],
        ["delay = Math.min(cap, 2 ** tries * 250 + jitter());", "w"],
      ],
    },
    {
      k: "line",
      spans: [
        ["     − ", "red"],
        ["setTimeout(fire, 100 * tries); // unbounded", "faint"],
      ],
    },
    { k: "pause", ms: 300 },
    {
      k: "task",
      dur: 1300,
      spans: [
        ["Bash  ", "ink"],
        ["pnpm vitest run test/webhooks", "dim"],
      ],
    },
    {
      k: "line",
      spans: [
        ["        ✓ 41 passed · +1 ", "mint"],
        ["retry-storm.spec.ts", "w"],
        [" · 2.1s", "faint"],
      ],
    },
    { k: "chips", patch: { inbox: 1 } },
    {
      k: "line",
      spans: [
        ["     ◆ ", "gold"],
        [inboxMsg, "gold"],
      ],
    },
    {
      k: "task",
      dur: 1500,
      spans: [
        ["Bash  ", "ink"],
        ["pnpm run gate:fast", "dim"],
      ],
    },
    {
      k: "line",
      spans: [
        ["        ✓ lint · typecheck · ", "mint"],
        ["1,204 tests", "w"],
        [" · 18.4s", "faint"],
      ],
    },
    { k: "chips", patch: { latency: "214ms", quota: 81 } },
    { k: "pause", ms: 560 },
    {
      k: "line",
      spans: [
        ["● ", "mint"],
        ["job_1x9m4qt", "azure"],
        [" done", "mint"],
        [" · verify=green · sha 4f9c2a1 · 48s", "faint"],
      ],
    },
    { k: "pause", ms: 700 },
    {
      k: "line",
      spans: [
        ["⏎ ", "gold"],
        [koLang ? "Land" : "Land", "gold"],
        [" job_1x9m4qt", "azure"],
        [" → main", "dim"],
      ],
    },
    { k: "pause", ms: 520 },
    {
      k: "line",
      spans: [
        ["  landed → main @ 4f9c2a1 · clean", "mint"],
      ],
    },
    {
      k: "line",
      spans: [
        ["  snapshot  ", "faint"],
        ["fix(webhooks): bound retry backoff, pin sandbox stub", "ink"],
      ],
    },
    {
      k: "line",
      spans: [
        ["            ", "faint"],
        ["Job-Id: job_1x9m4qt", "faint"],
      ],
    },
    { k: "pause", ms: 5200 },
    { k: "clear" },
  ];
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const toneClass: Record<string, string> = {
  ink: "text-ink",
  w: "text-[#fff6e3]",
  dim: "text-dim",
  faint: "text-faint",
  gold: "text-gold",
  mint: "text-mint",
  red: "text-red",
  azure: "text-azure",
  violet: "text-violet",
};
