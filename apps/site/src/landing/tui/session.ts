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
    ? "웹훅 재시도 간격에 상한을 넣어줘"
    : "Cap the webhook retry backoff";
  const reply = koLang
    ? "현재 워크스페이스에서 파일을 확인하고 수정하겠습니다."
    : "I'll inspect and edit the file in the current workspace.";

  return [
    { k: "chips", patch: { model: "opencode-go/kimi-k3", quota: 82, inbox: 0, latency: "—", branch: "main*" } },
    { k: "type", text: user },
    { k: "enter" },
    { k: "pause", ms: 620 },
    { k: "line", spans: [["◆ ", "primary"], [reply, "ink"]] },
    { k: "pause", ms: 420 },
    {
      k: "task",
      dur: 900,
      spans: [["Bash  ", "ink"], ["pwd", "dim"]],
    },
    { k: "line", spans: [["  /workspace/project", "faint"]] },
    {
      k: "task",
      dur: 640,
      spans: [["Bash  ", "ink"], ["cat src/webhooks/retry.ts", "dim"]],
    },
    {
      k: "task",
      dur: 640,
      spans: [["Bash  ", "ink"], ['rg "setTimeout|backoff" src/webhooks', "dim"]],
    },
    {
      k: "task",
      dur: 980,
      spans: [
        ["Bash  ", "ink"],
        ["apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/webhooks/retry.ts\n@@\n-setTimeout(fire, 100 * tries);\n+setTimeout(fire, Math.min(30000, 250 * 2 ** tries));\n*** End Patch\nPATCH", "dim"],
      ],
    },
    {
      k: "task",
      dur: 900,
      spans: [["Bash  ", "ink"], ["git diff -- src/webhooks/retry.ts", "dim"]],
    },
    { k: "line", spans: [["     − ", "red"], ["setTimeout(fire, 100 * tries);", "faint"]] },
    { k: "line", spans: [["     + ", "mint"], ["setTimeout(fire, Math.min(30000, 250 * 2 ** tries));", "w"]] },
    { k: "pause", ms: 300 },
    {
      k: "task",
      dur: 900,
      spans: [
        ["SessionControl  ", "ink"],
        ['{"operation":"spawn","description":"Inspect webhook callers","prompt":"Inspect webhook callers without editing files; report any assumptions."}', "dim"],
      ],
    },
    { k: "line", spans: [["  agentId=worker_1 · taskId=task_1 · running", "azure"]] },
    {
      k: "task",
      dur: 1300,
      spans: [["SessionControl  ", "ink"], ['{"operation":"wait","id":"task_1","timeout":30}', "dim"]],
    },
    {
      k: "line",
      spans: [
        ["  worker_1: ", "azure"],
        [koLang ? "호출부 확인 완료. 별도 파일 수정 없음." : "Caller inspection complete. No files edited.", "dim"],
      ],
    },
    { k: "chips", patch: { latency: "214ms", quota: 81 } },
    { k: "pause", ms: 560 },
    {
      k: "line",
      spans: [
        ["◆ ", "primary"],
        [koLang ? "변경 내용이 현재 워크스페이스에 있습니다. 테스트는 실행하지 않았습니다." : "Changes are in the current workspace. Tests were not run.", "ink"],
      ],
    },
    {
      k: "line",
      spans: [
        ["  ", "faint"],
        [koLang ? "diff를 검토한 뒤 필요한 검사와 커밋·푸시를 선택하세요." : "Review the diff, then choose the checks, commit, and push you need.", "faint"],
      ],
    },
    { k: "pause", ms: 5200 },
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
  azure: "text-azure",
  violet: "text-violet",
};
