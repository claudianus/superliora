export type LineTone = 'dim' | 'text' | 'primary' | 'accent' | 'success' | 'warn' | 'error' | 'user' | 'keyword' | 'string';

export interface TheatreLine {
  text: string;
  tone?: LineTone;
}

export interface DockWorker {
  name: string;
  state: 'running' | 'done' | 'queued';
  move: string;
}

export interface BoardCol {
  label: string;
  cards: string[];
}

export interface TheatreFrame {
  id: string;
  headerRight?: string;
  board?: BoardCol[];
  dock?: DockWorker[];
  lines: TheatreLine[];
  footerLeft: string;
  footerRight: string;
  composer?: string;
}

export function theatreFrames(lang: 'ko' | 'en'): TheatreFrame[] {
  return lang === 'ko' ? FRAMES_KO : FRAMES_EN;
}

const FRAMES_EN: TheatreFrame[] = [
  {
    id: 'welcome',
    headerRight: 'Neon Noir · Build',
    lines: [
      { text: '  SuperLiora', tone: 'primary' },
      { text: '  Finish the work. Watch the workers.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: '  Tip  Describe the outcome — not the steps.', tone: 'accent' },
      { text: '       Jobs run in the background while you stay here.', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: '  /login   connect a model', tone: 'dim' },
      { text: '  Alt+J    open Job Deck', tone: 'dim' },
    ],
    footerLeft: 'ready',
    footerRight: 'ctx · idle',
    composer: '',
  },
  {
    id: 'ack',
    headerRight: 'Neon Noir · Build',
    lines: [
      { text: ' you', tone: 'user' },
      { text: ' Fix the login redirect after OAuth.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' conductor', tone: 'primary' },
      { text: ' On it — job_a1b2 queued in its own branch.', tone: 'success' },
      { text: ' Done means: OAuth lands on /app.', tone: 'dim' },
    ],
    footerLeft: '● 1 job running',
    footerRight: 'auto · 12%',
    composer: '',
  },
  {
    id: 'strip',
    headerRight: 'Neon Noir · Build',
    board: [
      { label: 'DOING', cards: ['OAuth → /app'] },
      { label: 'NEXT', cards: ['Session cookie'] },
      { label: 'DONE', cards: ['Find callback'] },
    ],
    lines: [
      { text: ' job strip', tone: 'primary' },
      { text: ' ● job_a1b2  running  fix login redirect', tone: 'success' },
      { text: '   ▁▂▄▆█▆▄  38 tok/s · 42s', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' You can keep chatting — work continues underneath.', tone: 'accent' },
    ],
    footerLeft: '● job_a1b2 · Alt+J deck',
    footerRight: 'auto · 28%',
    composer: 'also harden the session cookie',
  },
  {
    id: 'dock',
    headerRight: 'Worker Dock · auto',
    dock: [
      { name: 'coder-1', state: 'running', move: 'Edit auth/callback.ts' },
      { name: 'explore', state: 'done', move: 'Grep oauth redirect' },
    ],
    lines: [
      { text: ' Live tools', tone: 'primary' },
      { text: ' Read   src/auth/callback.ts', tone: 'dim' },
      { text: ' Edit   return path → /app', tone: 'success' },
      { text: ' Bash   pnpm test auth.redirect', tone: 'keyword' },
    ],
    footerLeft: '2 workers · dock pinned',
    footerRight: 'auto · 41%',
  },
  {
    id: 'deck',
    headerRight: 'Job Deck · Alt+J',
    lines: [
      { text: ' ❯ job_a1b2  running  fix login redirect', tone: 'primary' },
      { text: '   job_c9d0  queued   harden session cookie', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' ─ worker diff ─────────────────────────', tone: 'accent' },
      { text: ' −  return "/";', tone: 'error' },
      { text: ' +  return "/app";', tone: 'success' },
      { text: ' ·  auth.redirect.spec.ts  pass', tone: 'string' },
    ],
    footerLeft: 'deck · Enter opens transcript',
    footerRight: 'auto · 55%',
  },
  {
    id: 'inbox',
    headerRight: 'Inbox · Alt+I',
    lines: [
      { text: ' ❯ needs your answer', tone: 'warn' },
      { text: '   Keep /dashboard as a fallback redirect?', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' you', tone: 'user' },
      { text: ' No — /app only.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' conductor  Got it. Resumed job_a1b2.', tone: 'success' },
    ],
    footerLeft: 'inbox clear',
    footerRight: 'auto · 62%',
  },
  {
    id: 'brief',
    headerRight: 'Intent · hotfix',
    lines: [
      { text: ' Quick brief', tone: 'primary' },
      { text: ' outcome     Patch cookie SameSite', tone: 'text' },
      { text: ' done when   integration test green', tone: 'success' },
      { text: ' leave alone packages/oauth', tone: 'warn' },
      { text: '', tone: 'dim' },
      { text: ' Enter → start job (no waiting around)', tone: 'accent' },
    ],
    footerLeft: 'composer · Alt+B',
    footerRight: 'hotfix · pool 2',
  },
  {
    id: 'timeline',
    headerRight: 'Timeline',
    lines: [
      { text: ' ● Accepted     job_a1b2', tone: 'dim' },
      { text: ' ● Coding       callback.ts', tone: 'success' },
      { text: ' ● You answered fallback → no', tone: 'warn' },
      { text: ' ○ Ready to land', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' Chat stays free while Jobs run.', tone: 'accent' },
    ],
    footerLeft: 'timeline · region',
    footerRight: 'auto · 74%',
  },
  {
    id: 'merge',
    headerRight: 'Merge Preview',
    lines: [
      { text: ' Ready to bring job_a1b2 into main?', tone: 'primary' },
      { text: '', tone: 'dim' },
      { text: ' ✓ tests green    ✓ no conflicts', tone: 'success' },
      { text: ' ✓ clear summary  ·  size ok', tone: 'success' },
      { text: '', tone: 'dim' },
      { text: ' This merges locally. Push is a separate step.', tone: 'warn' },
      { text: ' [Y] land   [N] hold', tone: 'text' },
    ],
    footerLeft: 'merge preview',
    footerRight: 'gates ok',
  },
  {
    id: 'land',
    headerRight: 'Neon Noir · Build',
    board: [
      { label: 'DOING', cards: [] },
      { label: 'NEXT', cards: [] },
      { label: 'DONE', cards: ['OAuth → /app', 'Session cookie'] },
    ],
    lines: [
      { text: ' conductor', tone: 'primary' },
      { text: ' Landed job_a1b2 on local main.', tone: 'success' },
      { text: ' Remote push not run — open Push when you want.', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' What next?', tone: 'accent' },
    ],
    footerLeft: 'idle · land receipt',
    footerRight: 'auto · 18%',
    composer: '',
  },
];

const FRAMES_KO: TheatreFrame[] = [
  {
    id: 'welcome',
    headerRight: 'Neon Noir · Build',
    lines: [
      { text: '  SuperLiora', tone: 'primary' },
      { text: '  일은 맡기고, 진행은 눈으로 보세요.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: '  Tip  절차보다 “끝난 모습”을 적으세요.', tone: 'accent' },
      { text: '       작업은 백그라운드에서 돌아가고, 당신은 여기 남습니다.', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: '  /login   모델 연결', tone: 'dim' },
      { text: '  Alt+J    Job Deck 열기', tone: 'dim' },
    ],
    footerLeft: 'ready',
    footerRight: 'ctx · idle',
    composer: '',
  },
  {
    id: 'ack',
    headerRight: 'Neon Noir · Build',
    lines: [
      { text: ' you', tone: 'user' },
      { text: ' OAuth 로그인 후 리다이렉트 고쳐줘.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' conductor', tone: 'primary' },
      { text: ' 알겠어요 — job_a1b2를 별도 브랜치에 넣었습니다.', tone: 'success' },
      { text: ' 완료 기준: OAuth 후 /app으로 도착.', tone: 'dim' },
    ],
    footerLeft: '● Job 1개 실행 중',
    footerRight: 'auto · 12%',
    composer: '',
  },
  {
    id: 'strip',
    headerRight: 'Neon Noir · Build',
    board: [
      { label: 'DOING', cards: ['OAuth → /app'] },
      { label: 'NEXT', cards: ['세션 쿠키'] },
      { label: 'DONE', cards: ['콜백 찾기'] },
    ],
    lines: [
      { text: ' job strip', tone: 'primary' },
      { text: ' ● job_a1b2  running  로그인 리다이렉트', tone: 'success' },
      { text: '   ▁▂▄▆█▆▄  38 tok/s · 42s', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' 채팅은 계속해도 됩니다. 아래에서는 일이 돌아갑니다.', tone: 'accent' },
    ],
    footerLeft: '● job_a1b2 · Alt+J deck',
    footerRight: 'auto · 28%',
    composer: '세션 쿠키도 같이 강화해줘',
  },
  {
    id: 'dock',
    headerRight: 'Worker Dock · auto',
    dock: [
      { name: 'coder-1', state: 'running', move: 'Edit auth/callback.ts' },
      { name: 'explore', state: 'done', move: 'Grep oauth redirect' },
    ],
    lines: [
      { text: ' 실시간 도구', tone: 'primary' },
      { text: ' Read   src/auth/callback.ts', tone: 'dim' },
      { text: ' Edit   return 경로 → /app', tone: 'success' },
      { text: ' Bash   pnpm test auth.redirect', tone: 'keyword' },
    ],
    footerLeft: '워커 2 · dock pinned',
    footerRight: 'auto · 41%',
  },
  {
    id: 'deck',
    headerRight: 'Job Deck · Alt+J',
    lines: [
      { text: ' ❯ job_a1b2  running  로그인 리다이렉트', tone: 'primary' },
      { text: '   job_c9d0  queued   세션 쿠키 강화', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' ─ 워커 diff ──────────────────────────', tone: 'accent' },
      { text: ' −  return "/";', tone: 'error' },
      { text: ' +  return "/app";', tone: 'success' },
      { text: ' ·  auth.redirect.spec.ts  pass', tone: 'string' },
    ],
    footerLeft: 'deck · Enter로 트랜스크립트',
    footerRight: 'auto · 55%',
  },
  {
    id: 'inbox',
    headerRight: 'Inbox · Alt+I',
    lines: [
      { text: ' ❯ 답변이 필요해요', tone: 'warn' },
      { text: '   /dashboard 폴백 리다이렉트를 남길까요?', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' you', tone: 'user' },
      { text: ' 아니 — /app만.', tone: 'text' },
      { text: '', tone: 'dim' },
      { text: ' conductor  확인. job_a1b2 다시 돌립니다.', tone: 'success' },
    ],
    footerLeft: 'inbox 비움',
    footerRight: 'auto · 62%',
  },
  {
    id: 'brief',
    headerRight: 'Intent · hotfix',
    lines: [
      { text: ' 짧은 brief', tone: 'primary' },
      { text: ' 결과        쿠키 SameSite 패치', tone: 'text' },
      { text: ' 완료 조건   통합 테스트 통과', tone: 'success' },
      { text: ' 건드리지 말 것  packages/oauth', tone: 'warn' },
      { text: '', tone: 'dim' },
      { text: ' Enter → Job 시작 (기다림 없음)', tone: 'accent' },
    ],
    footerLeft: 'composer · Alt+B',
    footerRight: 'hotfix · pool 2',
  },
  {
    id: 'timeline',
    headerRight: 'Timeline',
    lines: [
      { text: ' ● 접수됨       job_a1b2', tone: 'dim' },
      { text: ' ● 코딩 중      callback.ts', tone: 'success' },
      { text: ' ● 답변 반영    폴백 → 아니오', tone: 'warn' },
      { text: ' ○ 합칠 준비', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' Job이 도는 동안 채팅은 비어 있습니다.', tone: 'accent' },
    ],
    footerLeft: 'timeline',
    footerRight: 'auto · 74%',
  },
  {
    id: 'merge',
    headerRight: 'Merge Preview',
    lines: [
      { text: ' job_a1b2를 main에 넣을까요?', tone: 'primary' },
      { text: '', tone: 'dim' },
      { text: ' ✓ 테스트 통과   ✓ 충돌 없음', tone: 'success' },
      { text: ' ✓ 요약 있음     ·  크기 OK', tone: 'success' },
      { text: '', tone: 'dim' },
      { text: ' 로컬 합치기입니다. 원격 push는 다음 단계.', tone: 'warn' },
      { text: ' [Y] 합치기   [N] 보류', tone: 'text' },
    ],
    footerLeft: 'merge preview',
    footerRight: 'gates ok',
  },
  {
    id: 'land',
    headerRight: 'Neon Noir · Build',
    board: [
      { label: 'DOING', cards: [] },
      { label: 'NEXT', cards: [] },
      { label: 'DONE', cards: ['OAuth → /app', '세션 쿠키'] },
    ],
    lines: [
      { text: ' conductor', tone: 'primary' },
      { text: ' job_a1b2를 로컬 main에 합쳤습니다.', tone: 'success' },
      { text: ' 원격 push는 하지 않았습니다. 필요할 때 Push를 여세요.', tone: 'dim' },
      { text: '', tone: 'dim' },
      { text: ' 다음은요?', tone: 'accent' },
    ],
    footerLeft: 'idle · land 완료',
    footerRight: 'auto · 18%',
    composer: '',
  },
];
