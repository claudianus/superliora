export type LineTone = 'dim' | 'text' | 'primary' | 'accent' | 'success' | 'warn' | 'error' | 'user';

export interface TheatreLine {
  text: string;
  tone?: LineTone;
}

export interface TheatreFrame {
  id: string;
  lines: TheatreLine[];
  footer?: string;
}

/** Neon Noir Conductor Theatre — 10 beats, KO + EN grids. */
export function theatreFrames(lang: 'ko' | 'en'): TheatreFrame[] {
  if (lang === 'ko') return FRAMES_KO;
  return FRAMES_EN;
}

const FRAMES_EN: TheatreFrame[] = [
  {
    id: 'welcome',
    footer: 'SuperLiora · Conductor',
    lines: [
      { text: '┌─ SuperLiora ─────────────────────────────────────────┐', tone: 'primary' },
      { text: '│  How Conductor works                                 │', tone: 'text' },
      { text: '│  1. Type a task — Conductor creates a Job.           │', tone: 'dim' },
      { text: '│  2. Workers run in the background (Worker Dock).     │', tone: 'dim' },
      { text: '│  3. Alt+J opens the Job Deck.                        │', tone: 'dim' },
      { text: '│  Tip: describe the outcome; Conductor staffs the rest.│', tone: 'accent' },
      { text: '└──────────────────────────────────────────────────────┘', tone: 'primary' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
  {
    id: 'ack',
    footer: 'job_a1b2 — fix login redirect — queued',
    lines: [
      { text: ' you  Fix the login redirect after OAuth.', tone: 'user' },
      { text: '', tone: 'dim' },
      { text: ' conductor', tone: 'primary' },
      { text: ' accepted  job_a1b2 — fix login redirect — queued', tone: 'success' },
      { text: ' brief     success_criteria: oauth returns to /app', tone: 'dim' },
      { text: ' worktree  ~/.superliora/worktrees/a1b2/repo', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
  {
    id: 'strip',
    footer: 'needs_user 0 · running 1 · queued 0',
    lines: [
      { text: ' job strip  ● job_a1b2 running · fix login redirect', tone: 'primary' },
      { text: '            tokens/s ▁▂▄▆█▆▄  · elapsed 42s', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' tip  Alt+J watches workers live · Alt+I opens Inbox', tone: 'accent' },
      { text: '', tone: 'dim' },
      { text: '❯ keep going on auth edge cases', tone: 'text' },
    ],
  },
  {
    id: 'dock',
    footer: 'Worker Dock · /agents',
    lines: [
      { text: ' Worker Dock                                      auto', tone: 'primary' },
      { text: ' ┌──────────┬──────────┬──────────────────────────┐', tone: 'dim' },
      { text: ' │ worker   │ state    │ move                     │', tone: 'dim' },
      { text: ' ├──────────┼──────────┼──────────────────────────┤', tone: 'dim' },
      { text: ' │ coder-1  │ running  │ Edit src/auth/callback.ts│', tone: 'success' },
      { text: ' │ explore  │ done     │ Grep oauth redirect      │', tone: 'dim' },
      { text: ' └──────────┴──────────┴──────────────────────────┘', tone: 'dim' },
      { text: ' TAPE  Write · highlight · stream', tone: 'accent' },
    ],
  },
  {
    id: 'deck',
    footer: 'Job Deck · Alt+J',
    lines: [
      { text: ' Job Deck                                   [Esc close]', tone: 'primary' },
      { text: ' ❯ job_a1b2  running  fix login redirect', tone: 'primary' },
      { text: '   job_c9d0  queued   harden session cookie', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' worker transcript', tone: 'accent' },
      { text: ' −  return "/";', tone: 'error' },
      { text: ' +  return "/app";', tone: 'success' },
      { text: ' ·  tests  auth.redirect.spec.ts  pass', tone: 'success' },
    ],
  },
  {
    id: 'inbox',
    footer: 'Inbox · Alt+I · needs_user',
    lines: [
      { text: ' Inbox                                              1', tone: 'warn' },
      { text: ' ❯ job_a1b2 needs_user', tone: 'warn' },
      { text: '   Keep legacy /dashboard redirect as fallback?', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' you  No — /app only.', tone: 'user' },
      { text: ' conductor  answered · job_a1b2 resumed', tone: 'success' },
    ],
  },
  {
    id: 'brief',
    footer: 'Intent Composer · Alt+B · hotfix',
    lines: [
      { text: ' Intent Composer                         mode hotfix', tone: 'primary' },
      { text: ' outcome     Patch cookie SameSite on session', tone: 'text' },
      { text: ' success_criteria  integration test green', tone: 'success' },
      { text: ' must_not_touch    packages/oauth', tone: 'warn' },
      { text: ' verify            pnpm test:local auth', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' [Enter] JobCreate  ·  no LLM turn on hotfix path', tone: 'accent' },
    ],
  },
  {
    id: 'timeline',
    footer: 'Timeline region',
    lines: [
      { text: ' Timeline', tone: 'primary' },
      { text: ' ● Intake     job_a1b2 accepted', tone: 'dim' },
      { text: ' ● Running    coder-1 Edit callback.ts', tone: 'success' },
      { text: ' ● Needs you  answered · resumed', tone: 'warn' },
      { text: ' ○ Land       waiting on Merge Preview', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' chat stays free while Jobs run', tone: 'accent' },
    ],
  },
  {
    id: 'merge',
    footer: 'Merge Preview · Land ≠ push',
    lines: [
      { text: ' Merge Preview                              job_a1b2', tone: 'primary' },
      { text: ' Gates', tone: 'accent' },
      { text: '  ✓ checks green     ✓ no conflict     ✓ summary', tone: 'success' },
      { text: '  ✓ size ok          · visual n/a', tone: 'success' },
      { text: '', tone: 'dim' },
      { text: ' Land ≠ push — approve lands the worktree merge.', tone: 'warn' },
      { text: ' [Y] approve   [N] reject   [P] Push Preview', tone: 'text' },
    ],
  },
  {
    id: 'land',
    footer: 'Land complete · local main',
    lines: [
      { text: ' conductor', tone: 'primary' },
      { text: ' land complete  job_a1b2 → main (local)', tone: 'success' },
      { text: ' receipt        merge --no-edit  ·  push not run', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' next  open Push Preview when you want remote publish', tone: 'accent' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
];

const FRAMES_KO: TheatreFrame[] = [
  {
    id: 'welcome',
    footer: 'SuperLiora · Conductor',
    lines: [
      { text: '┌─ SuperLiora ─────────────────────────────────────────┐', tone: 'primary' },
      { text: '│  Conductor 사용법                                      │', tone: 'text' },
      { text: '│  1. 채팅에 작업을 입력하면 Job을 만듭니다.                   │', tone: 'dim' },
      { text: '│  2. 워커는 백그라운드 (Worker Dock /agents).              │', tone: 'dim' },
      { text: '│  3. Alt+J로 Job Deck을 엽니다.                          │', tone: 'dim' },
      { text: '│  Tip: 결과만 적으세요. 스태핑은 Conductor가 합니다.           │', tone: 'accent' },
      { text: '└──────────────────────────────────────────────────────┘', tone: 'primary' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
  {
    id: 'ack',
    footer: 'job_a1b2 — 로그인 리다이렉트 수정 — queued',
    lines: [
      { text: ' you  OAuth 후 로그인 리다이렉트를 고쳐줘.', tone: 'user' },
      { text: '', tone: 'dim' },
      { text: ' conductor', tone: 'primary' },
      { text: ' accepted  job_a1b2 — 로그인 리다이렉트 수정 — queued', tone: 'success' },
      { text: ' brief     success_criteria: oauth → /app', tone: 'dim' },
      { text: ' worktree  ~/.superliora/worktrees/a1b2/repo', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
  {
    id: 'strip',
    footer: 'needs_user 0 · running 1 · queued 0',
    lines: [
      { text: ' job strip  ● job_a1b2 running · 로그인 리다이렉트 수정', tone: 'primary' },
      { text: '            tokens/s ▁▂▄▆█▆▄  · elapsed 42s', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' tip  Alt+J 워커 감시 · Alt+I Inbox', tone: 'accent' },
      { text: '', tone: 'dim' },
      { text: '❯ auth 엣지 케이스도 이어서', tone: 'text' },
    ],
  },
  {
    id: 'dock',
    footer: 'Worker Dock · /agents',
    lines: [
      { text: ' Worker Dock                                      auto', tone: 'primary' },
      { text: ' ┌──────────┬──────────┬──────────────────────────┐', tone: 'dim' },
      { text: ' │ worker   │ state    │ move                     │', tone: 'dim' },
      { text: ' ├──────────┼──────────┼──────────────────────────┤', tone: 'dim' },
      { text: ' │ coder-1  │ running  │ Edit src/auth/callback.ts│', tone: 'success' },
      { text: ' │ explore  │ done     │ Grep oauth redirect      │', tone: 'dim' },
      { text: ' └──────────┴──────────┴──────────────────────────┘', tone: 'dim' },
      { text: ' TAPE  Write · highlight · stream', tone: 'accent' },
    ],
  },
  {
    id: 'deck',
    footer: 'Job Deck · Alt+J',
    lines: [
      { text: ' Job Deck                                   [Esc 닫기]', tone: 'primary' },
      { text: ' ❯ job_a1b2  running  로그인 리다이렉트 수정', tone: 'primary' },
      { text: '   job_c9d0  queued   세션 쿠키 강화', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' worker transcript', tone: 'accent' },
      { text: ' −  return "/";', tone: 'error' },
      { text: ' +  return "/app";', tone: 'success' },
      { text: ' ·  tests  auth.redirect.spec.ts  pass', tone: 'success' },
    ],
  },
  {
    id: 'inbox',
    footer: 'Inbox · Alt+I · needs_user',
    lines: [
      { text: ' Inbox                                              1', tone: 'warn' },
      { text: ' ❯ job_a1b2 needs_user', tone: 'warn' },
      { text: '   레거시 /dashboard 리다이렉트를 폴백으로 둘까요?', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' you  아니 — /app만.', tone: 'user' },
      { text: ' conductor  answered · job_a1b2 resumed', tone: 'success' },
    ],
  },
  {
    id: 'brief',
    footer: 'Intent Composer · Alt+B · hotfix',
    lines: [
      { text: ' Intent Composer                         mode hotfix', tone: 'primary' },
      { text: ' outcome     세션 쿠키 SameSite 패치', tone: 'text' },
      { text: ' success_criteria  통합 테스트 그린', tone: 'success' },
      { text: ' must_not_touch    packages/oauth', tone: 'warn' },
      { text: ' verify            pnpm test:local auth', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' [Enter] JobCreate  ·  hotfix 경로는 LLM 턴 없음', tone: 'accent' },
    ],
  },
  {
    id: 'timeline',
    footer: 'Timeline 영역',
    lines: [
      { text: ' Timeline', tone: 'primary' },
      { text: ' ● Intake     job_a1b2 accepted', tone: 'dim' },
      { text: ' ● Running    coder-1 Edit callback.ts', tone: 'success' },
      { text: ' ● Needs you  answered · resumed', tone: 'warn' },
      { text: ' ○ Land       Merge Preview 대기', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' Job이 도는 동안 채팅은 자유', tone: 'accent' },
    ],
  },
  {
    id: 'merge',
    footer: 'Merge Preview · Land ≠ push',
    lines: [
      { text: ' Merge Preview                              job_a1b2', tone: 'primary' },
      { text: ' Gates', tone: 'accent' },
      { text: '  ✓ checks green     ✓ no conflict     ✓ summary', tone: 'success' },
      { text: '  ✓ size ok          · visual n/a', tone: 'success' },
      { text: '', tone: 'dim' },
      { text: ' Land ≠ push — 승인은 worktree를 로컬로 land합니다.', tone: 'warn' },
      { text: ' [Y] 승인   [N] 거절   [P] Push Preview', tone: 'text' },
    ],
  },
  {
    id: 'land',
    footer: 'Land 완료 · local main',
    lines: [
      { text: ' conductor', tone: 'primary' },
      { text: ' land complete  job_a1b2 → main (local)', tone: 'success' },
      { text: ' receipt        merge --no-edit  ·  push not run', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' next  원격 배포가 필요하면 Push Preview', tone: 'accent' },
      { text: '', tone: 'dim' },
      { text: '❯ ', tone: 'primary' },
    ],
  },
];
