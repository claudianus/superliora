import type { Locale } from "../i18n/types";

export type Span = [string, string]; // [text, tone]
export type Tone =
  | "ink"
  | "w"
  | "dim"
  | "faint"
  | "primary"
  | "mint"
  | "red"
  | "amber"
  | "azure"
  | "violet";

/** Footer + Worker Dock state, mirroring the real footer slots (mode · model · cwd · git · quota). */
export interface Chips {
  model: string;
  quota: number;
  branch: string;
  /** Worker Dock band: undefined hides it (dock mode `auto` with nothing running). */
  dock?: { id: string; label: string; state: "running" | "finished" };
}

export type Step =
  | { k: "type"; text: string }
  | { k: "enter" }
  | { k: "line"; spans: Span[] }
  | { k: "task"; spans: Span[]; dur?: number }
  | { k: "pause"; ms: number }
  | { k: "chips"; patch: Partial<Chips> }
  | { k: "clear" };

export const INITIAL_CHIPS: Chips = {
  model: "opencode-go/kimi-k3",
  quota: 82,
  branch: "main",
  dock: undefined,
};

/*
 * A replay of the real 1.x tool surface: the conductor session edits through
 * Bash in the workspace and hands the side audit to an independent session via
 * SessionControl (absolute cwd, snapshot-only wait). It ends by saying tests
 * were not run, because a finished turn is not a verification verdict.
 */
export function buildSession(locale: Locale): Step[] {
  const ko = locale === "ko";
  const user = ko
    ? "웹훅 재시도 간격에 상한을 두고, 어디서 호출하는지도 확인해 줘"
    : "Cap the webhook retry backoff, and check who calls it";
  const reply = ko
    ? "retry.ts는 여기서 고치고, 호출부 조사는 별도 세션에 맡길게요."
    : "I'll patch retry.ts here and hand the caller audit to a separate session.";
  const auditLabel = ko ? "웹훅 호출부 조사" : "Audit webhook callers";

  return [
    { k: "chips", patch: { ...INITIAL_CHIPS } },
    { k: "type", text: user },
    { k: "enter" },
    { k: "pause", ms: 560 },
    { k: "line", spans: [["◆ ", "primary"], [reply, "ink"]] },
    { k: "pause", ms: 380 },
    {
      k: "task",
      dur: 720,
      spans: [["Bash  ", "ink"], ['rg -n "setTimeout|backoff" src/webhooks', "dim"]],
    },
    { k: "line", spans: [["    src/webhooks/retry.ts:42:  ", "faint"], ["setTimeout(fire, 100 * tries);", "dim"]] },
    {
      k: "task",
      dur: 680,
      spans: [
        ["SessionControl  ", "ink"],
        [`{"operation":"spawn","description":"${auditLabel}","cwd":"/work/paygate","prompt":"List every caller of scheduleRetry. Do not edit files."}`, "dim"],
      ],
    },
    { k: "line", spans: [["    coord_7f2 · rev 1 · ", "faint"], ["running", "azure"]] },
    { k: "chips", patch: { dock: { id: "coord_7f2", label: auditLabel, state: "running" } } },
    {
      k: "task",
      dur: 1100,
      // Heredoc input renders as a highlighted preview block, as the TUI streams it.
      spans: [
        ["Bash  ", "ink"],
        ["apply_patch <<'PATCH'\n", "dim"],
        ["      *** Update File: src/webhooks/retry.ts\n", "faint"],
        ["      -  setTimeout(fire, 100 * tries);\n", "red"],
        ["      +  setTimeout(fire, Math.min(30_000, 250 * 2 ** tries));\n", "mint"],
        ["      PATCH", "faint"],
      ],
    },
    { k: "chips", patch: { branch: "main*" } },
    {
      k: "task",
      dur: 700,
      spans: [["Bash  ", "ink"], ["git diff --stat", "dim"]],
    },
    { k: "line", spans: [["    src/webhooks/retry.ts | ", "faint"], ["2 ", "dim"], ["+", "mint"], ["-", "red"]] },
    {
      k: "task",
      dur: 900,
      spans: [["SessionControl  ", "ink"], ['{"operation":"wait","id":"coord_7f2","timeout":0}', "dim"]],
    },
    {
      k: "line",
      spans: [
        ["    coord_7f2: ", "azure"],
        [ko ? "호출부 3곳 (queue/worker.ts, billing/charge.ts, api/hooks.ts) · 파일 수정 없음" : "3 callers (queue/worker.ts, billing/charge.ts, api/hooks.ts) · no files edited", "dim"],
      ],
    },
    { k: "chips", patch: { dock: { id: "coord_7f2", label: auditLabel, state: "finished" }, quota: 81 } },
    { k: "pause", ms: 520 },
    {
      k: "line",
      spans: [
        ["◆ ", "primary"],
        [ko ? "재시도 간격은 이제 최대 30초입니다. 테스트는 아직 돌리지 않았어요." : "Backoff now caps at 30 s. I haven't run the tests yet.", "ink"],
      ],
    },
    {
      k: "line",
      spans: [
        ["  ", "faint"],
        [ko ? "pnpm test webhooks를 돌릴까요? diff는 /diff로 볼 수 있습니다." : "Want me to run pnpm test webhooks? /diff shows the change.", "faint"],
      ],
    },
    { k: "pause", ms: 5200 },
    { k: "chips", patch: { dock: undefined } },
    { k: "clear" },
  ];
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const toneClass: Record<string, string> = {
  ink: "text-ink",
  w: "text-ink-strong",
  dim: "text-dim",
  faint: "text-faint",
  primary: "text-primary",
  mint: "text-mint",
  red: "text-red",
  amber: "text-amber",
  azure: "text-azure",
  violet: "text-violet",
};
