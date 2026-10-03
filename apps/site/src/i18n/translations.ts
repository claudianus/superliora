import {
  INSTALL_CMD,
  INSTALL_PS,
  INSTALL_SH,
  NODE_REQUIREMENT,
  USAGE_COMMANDS,
  type UsageCommandId,
  type WorkflowStepId,
} from '../content';

export type Lang = 'ko' | 'en';

export type DocSlug =
  | 'getting-started'
  | 'how-conductor-works'
  | 'jobs'
  | 'control-tower'
  | 'reference';

export interface InstallCommand {
  label: string;
  cmd: string;
}

export interface WorkflowStep {
  id: WorkflowStepId;
  title: string;
  body: string;
}

export interface UsageItem {
  id: UsageCommandId;
  cmd: string;
  title: string;
  body: string;
}

export interface TowerItem {
  keys: string;
  title: string;
  body: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  body: string;
}

export interface SiteVisuals {
  statusRoute: {
    chrome: string;
    badge: string;
    strategyLabel: string;
    strategy: string;
    ready: string;
    candidates: { rank: string; name: string; state: string; tone: 'ready' | 'cool' | 'idle' }[];
    roles: { role: string; model: string }[];
    footer: string;
  };
  jobDeck: {
    chrome: string;
    badge: string;
    subtitle: string;
    inbox: string;
    jobs: { id: string; title: string; status: string; phase: string; age: string; tone: 'run' | 'ask' | 'done' }[];
    actions: string[];
  };
  workerDock: {
    chrome: string;
    badge: string;
    subtitle: string;
    summary: string;
    workers: { name: string; action: string; rate: string; tone: 'live' | 'idle' }[];
    lane: { count: string; label: string }[];
  };
  commandHub: {
    chrome: string;
    badge: string;
    query: string;
    modes: { label: string; active?: boolean }[];
    rows: { label: string; desc: string; keys: string; selected?: boolean }[];
  };
  diffStudio: {
    chrome: string;
    badge: string;
    tabs: { label: string; active?: boolean }[];
    file: string;
    lines: { kind: 'ctx' | 'add' | 'del'; mark: string; text: string }[];
    stats: string;
    hint: string;
  };
  howFlow: {
    chrome: string;
    badge: string;
    steps: { title: string; body: string }[];
  };
}

export interface ClusterItem {
  id: string;
  title: string;
  lead: string;
  features: FeatureItem[];
}

export interface DocSection {
  heading: string;
  body: string;
  /** Single terminal block under the body. */
  code?: string;
  /** Label shown in the code block header. Falls back to docsShell.terminal. */
  codeLabel?: string;
  /** Tabbed terminal blocks (e.g. per-OS install commands). Replaces `code` when present. */
  tabs?: { label: string; code: string }[];
  /** Checklist rows rendered under the body. */
  list?: string[];
  /** Info callout rendered after the body/list. */
  note?: string;
}

export interface DocPage {
  slug: DocSlug;
  title: string;
  lead: string;
  sections: DocSection[];
}

export interface Translation {
  lang: Lang;
  dir: 'ltr';
  meta: {
    title: string;
    description: string;
    ogLocale: string;
  };
  skip: string;
  nav: {
    features: string;
    usage: string;
    workflow: string;
    install: string;
    docs: string;
    menuOpen: string;
    menuClose: string;
  };
  hero: {
    brand: string;
    eyebrow: string;
    h1: string;
    lead: string;
    command: string;
    proof: { value: string; label: string }[];
    install: string;
    github: string;
    docs: string;
    frame: {
      conductor: string;
      conductorState: string;
      inbox: string;
      jobLabel: string;
      jobName: string;
      jobStatus: string;
      boardTitle: string;
      progress: string;
      doingLabel: string;
      nextLabel: string;
      doneLabel: string;
      doing: string;
      next: string;
      done: string;
      workerName: string;
      workerModel: string;
      workerRate: string;
      stream: string[];
    };
  };
  clusters: {
    kicker: string;
    title: string;
    body: string;
    items: ClusterItem[];
  };
  usage: {
    kicker: string;
    title: string;
    body: string;
    items: UsageItem[];
  };
  workflow: {
    kicker: string;
    title: string;
    body: string;
    steps: WorkflowStep[];
  };
  tower: {
    kicker: string;
    title: string;
    body: string;
    items: TowerItem[];
  };
  install: {
    kicker: string;
    title: string;
    body: string;
    requirements: string;
    commands: InstallCommand[];
    next: string;
  };
  footer: {
    copyright: string;
    github: string;
    english: string;
    korean: string;
    docs: string;
    issues: string;
    security: string;
    tagline: string;
  };
  theme: {
    light: string;
    dark: string;
    toLight: string;
    toDark: string;
  };
  copy: {
    idle: string;
    done: string;
    label: string;
    doneLabel: string;
  };
  visuals: SiteVisuals;
  docsNav: { slug: DocSlug; label: string }[];
  docs: Record<DocSlug, DocPage>;
  docsShell: {
    home: string;
    onThisSite: string;
    /** Sidebar heading above the guide index. */
    guide: string;
    /** Right-rail heading above the section links. */
    toc: string;
    prev: string;
    next: string;
    copy: string;
    copied: string;
    terminal: string;
    /** Suffix for the reading-time meta, e.g. "분 읽기" / "min read". */
    minRead: string;
    /** "Section X of Y" meta. */
    of: string;
  };
}

export const defaultLang: Lang = 'ko';
export const PRODUCT_VERSION = '0.13.7';

const visualsKo: SiteVisuals = {
  statusRoute: {
    chrome: 'Session · Runtime',
    badge: 'Bash + SessionControl',
    strategyLabel: 'Workspace',
    strategy: 'Direct',
    ready: '2 tools',
    candidates: [
      { rank: '#1', name: 'Bash', state: 'workspace', tone: 'ready' },
      { rank: '#2', name: 'SessionControl', state: 'workers', tone: 'ready' },
      { rank: '#3', name: 'Native Job', state: 'explicit', tone: 'idle' },
    ],
    roles: [
      { role: 'Model', model: 'selected' },
      { role: 'Workspace', model: 'current' },
      { role: 'Review', model: 'manual' },
    ],
    footer: '직접 실행 · Job 격리는 명시적으로',
  },
  jobDeck: {
    chrome: 'Job Deck',
    badge: 'Alt+J',
    subtitle: 'Job monitor',
    inbox: 'Inbox 1',
    jobs: [
      { id: 'job_a1', title: 'Auth redirect', status: 'running', phase: 'Bash', age: '12s', tone: 'run' },
      { id: 'job_b4', title: 'Session expiry', status: 'needs you', phase: 'waiting', age: '41s', tone: 'ask' },
      { id: 'job_c2', title: 'Route guard', status: 'done', phase: 'landed', age: '3m', tone: 'done' },
    ],
    actions: ['Answer', 'Resume', 'Cancel'],
  },
  workerDock: {
    chrome: 'Worker Dock',
    badge: 'live',
    subtitle: '1 worker · fleet',
    summary: 'Σ 820/s',
    workers: [
      { name: 'coder', action: 'Bash · src/auth/redirect.ts', rate: '820/s', tone: 'live' },
      { name: 'scout', action: 'idle · waiting', rate: '—', tone: 'idle' },
    ],
    lane: [
      { count: '1', label: 'running' },
      { count: '1', label: 'needs you' },
      { count: '1', label: 'done' },
    ],
  },
  commandHub: {
    chrome: 'Command Hub',
    badge: 'Ctrl+K',
    query: 'jobs',
    modes: [
      { label: 'Session', active: true },
      { label: 'Bash' },
      { label: 'SessionControl' },
    ],
    rows: [
      { label: 'Sessions', desc: '세션 열기·이어서 하기', keys: '/sessions', selected: true },
      { label: 'Job Deck', desc: '진행·diff·결과', keys: 'Alt+J' },
      { label: 'Inbox', desc: '질문에 한 줄로 답', keys: 'Alt+I' },
      { label: 'Permissions', desc: '실행 승인 설정', keys: '/permission' },
    ],
  },
  diffStudio: {
    chrome: 'Diff · Studio',
    badge: 'in-TUI',
    tabs: [
      { label: 'Diff', active: true },
      { label: 'Search' },
      { label: 'Files' },
    ],
    file: 'src/auth/redirect.ts',
    lines: [
      { kind: 'ctx', mark: ' ', text: 'export function afterLogin(user) {' },
      { kind: 'del', mark: '-', text: '  return "/home"' },
      { kind: 'add', mark: '+', text: '  return "/app"' },
      { kind: 'ctx', mark: ' ', text: '}' },
    ],
    stats: '+1  −1',
    hint: '터미널을 떠나지 않음',
  },
  howFlow: {
    chrome: 'Flow',
    badge: 'one lap',
    steps: [
      { title: '결과 적기', body: '원하는 결과와 실행할 검사를 적기' },
      { title: '직접 실행', body: '현재 작업 공간에서 Bash로 작업' },
      { title: '선택적 Job', body: '명시적으로 요청할 때만 격리' },
      { title: '직접 검토', body: 'diff·검사 결과를 보고 land 선택' },
    ],
  },
};

const visualsEn: SiteVisuals = {
  statusRoute: {
    chrome: 'Session · Runtime',
    badge: 'Bash + SessionControl',
    strategyLabel: 'Workspace',
    strategy: 'Direct',
    ready: '2 tools',
    candidates: [
      { rank: '#1', name: 'Bash', state: 'workspace', tone: 'ready' },
      { rank: '#2', name: 'SessionControl', state: 'workers', tone: 'ready' },
      { rank: '#3', name: 'Native Job', state: 'explicit', tone: 'idle' },
    ],
    roles: [
      { role: 'Model', model: 'selected' },
      { role: 'Workspace', model: 'current' },
      { role: 'Review', model: 'manual' },
    ],
    footer: 'Direct execution · explicit Job isolation',
  },
  jobDeck: {
    chrome: 'Job Deck',
    badge: 'Alt+J',
    subtitle: 'Job monitor',
    inbox: 'Inbox 1',
    jobs: [
      { id: 'job_a1', title: 'Auth redirect', status: 'running', phase: 'Bash', age: '12s', tone: 'run' },
      { id: 'job_b4', title: 'Session expiry', status: 'needs you', phase: 'waiting', age: '41s', tone: 'ask' },
      { id: 'job_c2', title: 'Route guard', status: 'done', phase: 'landed', age: '3m', tone: 'done' },
    ],
    actions: ['Answer', 'Resume', 'Cancel'],
  },
  workerDock: {
    chrome: 'Worker Dock',
    badge: 'live',
    subtitle: '1 worker · fleet',
    summary: 'Σ 820/s',
    workers: [
      { name: 'coder', action: 'Bash · src/auth/redirect.ts', rate: '820/s', tone: 'live' },
      { name: 'scout', action: 'idle · waiting', rate: '—', tone: 'idle' },
    ],
    lane: [
      { count: '1', label: 'running' },
      { count: '1', label: 'needs you' },
      { count: '1', label: 'done' },
    ],
  },
  commandHub: {
    chrome: 'Command Hub',
    badge: 'Ctrl+K',
    query: 'jobs',
    modes: [
      { label: 'Session', active: true },
      { label: 'Bash' },
      { label: 'SessionControl' },
    ],
    rows: [
      { label: 'Sessions', desc: 'Open or resume a session', keys: '/sessions', selected: true },
      { label: 'Job Deck', desc: 'Progress, diffs, results', keys: 'Alt+J' },
      { label: 'Inbox', desc: 'Answer in one line', keys: 'Alt+I' },
      { label: 'Permissions', desc: 'Execution approvals', keys: '/permission' },
    ],
  },
  diffStudio: {
    chrome: 'Diff · Studio',
    badge: 'in-TUI',
    tabs: [
      { label: 'Diff', active: true },
      { label: 'Search' },
      { label: 'Files' },
    ],
    file: 'src/auth/redirect.ts',
    lines: [
      { kind: 'ctx', mark: ' ', text: 'export function afterLogin(user) {' },
      { kind: 'del', mark: '-', text: '  return "/home"' },
      { kind: 'add', mark: '+', text: '  return "/app"' },
      { kind: 'ctx', mark: ' ', text: '}' },
    ],
    stats: '+1  −1',
    hint: 'Stay in the terminal',
  },
  howFlow: {
    chrome: 'Flow',
    badge: 'one lap',
    steps: [
      { title: 'Describe', body: 'Write the result and checks you want' },
      { title: 'Run directly', body: 'Bash works in the current workspace' },
      { title: 'Optional Job', body: 'Request isolation explicitly' },
      { title: 'Review', body: 'Inspect diffs and results before land' },
    ],
  },
};

const docsNavKo: Translation['docsNav'] = [
  { slug: 'getting-started', label: '시작하기' },
  { slug: 'how-conductor-works', label: '어떻게 일하나요' },
  { slug: 'jobs', label: '작업 다루기' },
  { slug: 'control-tower', label: '단축키' },
  { slug: 'reference', label: '명령 모음' },
];

const docsNavEn: Translation['docsNav'] = [
  { slug: 'getting-started', label: 'Getting started' },
  { slug: 'how-conductor-works', label: 'How it works' },
  { slug: 'jobs', label: 'Jobs' },
  { slug: 'control-tower', label: 'Shortcuts' },
  { slug: 'reference', label: 'Commands' },
];

const clustersKo: ClusterItem[] = [
  {
    id: 'runtime',
    title: '두 도구로 작업합니다',
    lead: '모델의 도구는 Bash와 SessionControl뿐입니다.',
    features: [
      { id: 'bash', title: 'Bash', body: '현재 작업 공간에서 명령을 실행하고 파일을 읽고 수정합니다.' },
      { id: 'session-control', title: 'SessionControl', body: '워커 세션을 시작하고 메시지·결과를 주고받습니다. 워커도 같은 두 도구를 씁니다.' },
      { id: 'model-selection', title: '모델 선택', body: '/model로 이 세션에서 사용할 모델을 고릅니다.' },
      { id: 'login', title: '로그인', body: '/login으로 OAuth, API 키, 커스텀 엔드포인트를 연결합니다.' },
      { id: 'accounts', title: '계정 설정', body: '연결한 프로바이더와 자격 증명을 관리합니다.' },
      { id: 'custom-endpoint', title: '커스텀 엔드포인트', body: 'OpenAI 호환 URL을 연결할 수 있습니다.' },
    ],
  },
  {
    id: 'see-fleet',
    title: '돌아가는 일이 한눈에',
    lead: '명시적으로 만든 native Job은 Job Deck·Worker Dock·Kanban에서 봅니다.',
    features: [
      { id: 'worker-dock', title: 'Worker Dock', body: '누가 어떤 도구를 도는지 옆 밴드에서 실시간으로 봅니다.' },
      { id: 'todo-board', title: 'To\u200Bdo Board', body: '하는 중·다음·완료를 보드로 읽습니다.' },
      { id: 'worktree', title: '선택적 격리', body: 'native Job이나 --worktree를 명시적으로 선택하면 별도 작업 공간을 씁니다. 일반 세션은 현재 폴더에서 실행됩니다.' },
      { id: 'job-deck', title: 'Job Deck', body: 'Alt+J로 diff·결과·진행을 엽니다. 힌트는 한 줄이고, 입력하면 Search:가 뜹니다.' },
      { id: 'inbox', title: 'Inbox', body: '질문이 뜨면 Alt+I에서 한 줄로 답합니다. 다른 목록처럼 입력하면 검색·페이지가 됩니다.' },
      { id: 'land', title: '검토 후 합치기', body: 'diff와 검사 결과를 직접 보고 land를 선택합니다. push는 별도로 요청합니다.' },
    ],
  },
  {
    id: 'stay-control',
    title: '맡기되, 핸들은 당신 것',
    lead: '실행 승인과 Job 수명 주기는 당신이 정합니다.',
    features: [
      { id: 'sessions', title: '세션', body: '프로젝트별 대화를 열고 /sessions나 --continue로 이어 갑니다.' },
      { id: 'native-jobs', title: 'Native Job', body: '/job create로 명시적으로 작업을 만들고 답변·재개·취소를 제어합니다.' },
      { id: 'permissions', title: '권한 모드', body: 'manual·auto·yolo 중 세션의 실행 승인 방식을 고릅니다.' },
    ],
  },
  {
    id: 'studio',
    title: '터미널이 IDE처럼',
    lead: '찾기·diff·설정이 같은 화면 안에 있습니다.',
    features: [
      { id: 'in-tui-diff', title: '화면 안 diff', body: '파일·검색·변경을 터미널을 떠나지 않고 봅니다.' },
      { id: 'command-hub', title: 'Command Hub', body: 'Ctrl+K로 설정·세션·작업·업그레이드·Quota를 찾습니다.' },
      { id: 'visual-quality', title: 'Visual Quality', body: '모션·밀도·글로우를 Neon Noir에 맞춥니다. Welcome·로그인·에디터 프레임은 살아 있고 thinking은 thought-orb입니다. Settings → Appearance에서 고른 값을 미리 보고 Esc로 되돌립니다. 답변이 흐르는 동안 코드 펜스가 하이라이트됩니다. 클래식 Windows 콘솔에서도 그 크롬은 움직이고, Windows Terminal은 스플래시까지 풀 클록입니다. 모션 off면 정지.' },
      { id: 'performance', title: 'Performance', body: '저사양에서는 Settings → Appearance 또는 /performance로 off · auto · on을 켭니다.' },
      { id: 'locale', title: '한국어 / English', body: 'UI 언어를 바꿔도 흐름은 같습니다.' },
    ],
  },
];

const clustersEn: ClusterItem[] = [
  {
    id: 'runtime',
    title: 'Two tools for the work',
    lead: 'The model has exactly Bash and SessionControl.',
    features: [
      { id: 'bash', title: 'Bash', body: 'Run commands and read or edit files in the current workspace.' },
      { id: 'session-control', title: 'SessionControl', body: 'Start worker sessions and exchange messages and results. Workers use the same two tools.' },
      { id: 'model-selection', title: 'Model selection', body: '/model selects the model for this session.' },
      { id: 'login', title: 'Login', body: '/login connects OAuth, an API key, or a custom endpoint.' },
      { id: 'accounts', title: 'Account settings', body: 'Manage connected providers and credentials.' },
      { id: 'custom-endpoint', title: 'Custom endpoint', body: 'Connect an OpenAI-compatible URL.' },
    ],
  },
  {
    id: 'see-fleet',
    title: 'See the fleet',
    lead: 'Explicit native Jobs appear in the Job Deck, Worker Dock, and Kanban board.',
    features: [
      { id: 'worker-dock', title: 'Worker Dock', body: 'Watch who is running which tool in the side band.' },
      { id: 'todo-board', title: 'To\u200Bdo Board', body: 'Read doing / next / done as a board, not a wall of logs.' },
      { id: 'worktree', title: 'Optional isolation', body: 'Choose a native Job or --worktree explicitly for a separate workspace. Ordinary sessions run in the current folder.' },
      { id: 'job-deck', title: 'Job Deck', body: 'Alt+J opens diffs, results, and progress. One hint line; type to Search: like other lists.' },
      { id: 'inbox', title: 'Inbox', body: 'When it asks, answer in Alt+I. Type to search, same paging as other lists.' },
      { id: 'land', title: 'Review, then land', body: 'Inspect diffs and check results yourself, then choose land. Push is a separate request.' },
    ],
  },
  {
    id: 'stay-control',
    title: 'Stay in control',
    lead: 'You control execution approvals and the Job lifecycle.',
    features: [
      { id: 'sessions', title: 'Sessions', body: 'Open a project conversation and resume with /sessions or --continue.' },
      { id: 'native-jobs', title: 'Native Job', body: 'Create work explicitly with /job create, then answer, resume, or cancel it.' },
      { id: 'permissions', title: 'Permission modes', body: 'Choose manual, auto, or yolo for execution approvals in the session.' },
    ],
  },
  {
    id: 'studio',
    title: 'Studio in the terminal',
    lead: 'Search, diffs, and settings live on the same screen.',
    features: [
      { id: 'in-tui-diff', title: 'In-TUI diff', body: 'Files, search, and changes without leaving the terminal.' },
      { id: 'command-hub', title: 'Command Hub', body: 'Ctrl+K finds settings, sessions, jobs, upgrade, and Quota.' },
      { id: 'visual-quality', title: 'Visual Quality', body: 'Tune motion, density, and glow for Neon Noir. Welcome, login, and editor frames stay live; thinking is a thought-orb. Settings → Appearance previews a highlighted value (Esc restores). Assistant code fences highlight while the reply is still streaming. Classic Windows consoles keep that chrome moving; Windows Terminal still gets the full clock (including splash). Motion off is static.' },
      { id: 'performance', title: 'Performance', body: 'Opt-in for low-spec machines: off, auto, or on. Settings → Appearance or /performance.' },
      { id: 'locale', title: '한국어 / English', body: 'Same flow in either UI language.' },
    ],
  },
];

export const translations: Record<Lang, Translation> = {
  ko: {
    lang: 'ko',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — 코딩 에이전트를 돌리는 터미널',
      description:
        'Bash와 SessionControl로 현재 작업 공간에서 코딩합니다. 격리가 필요하면 native Job을 명시적으로 만들고, diff와 검사 결과를 직접 검토한 뒤 land하세요.',
      ogLocale: 'ko_KR',
    },
    skip: '본문으로 건너뛰기',
    nav: {
      features: '주요 기능',
      usage: '사용법',
      workflow: '워크플로우',
      install: '설치법',
      docs: '가이드',
      menuOpen: '메뉴 열기',
      menuClose: '메뉴 닫기',
    },
    hero: {
      brand: 'SuperLiora',
      eyebrow: 'AI 코딩 에이전트 · 로컬 우선',
      h1: '코딩 에이전트를 돌리는 터미널.',
      lead: 'Bash로 현재 작업 공간에서 실행하고, SessionControl로 워커를 다룹니다. 격리된 native Job은 필요할 때 명시적으로 만드세요.',
      command: '$ liora',
      proof: [
        { value: '두 도구', label: 'Bash + SessionControl' },
        { value: '직접 실행', label: '현재 작업 공간이 기본' },
        { value: '명시적 Job', label: '격리·검토·land는 선택' },
      ],
      install: '설치법',
      github: 'GitHub',
      docs: '가이드',
      frame: {
        conductor: 'SESSION · CONTROL PLANE',
        conductorState: '3 jobs · 1 needs you',
        inbox: 'INBOX 01',
        jobLabel: 'Job',
        jobName: 'Auth redirect',
        jobStatus: 'running',
        boardTitle: 'Board',
        progress: '1 / 3',
        doingLabel: 'Doing',
        nextLabel: 'Next',
        doneLabel: 'Done',
        doing: '로그인 후 /app으로',
        next: '세션 만료 처리',
        done: '라우트 가드',
        workerName: 'coder',
        workerModel: 'selected model',
        workerRate: '820 /s',
        stream: [
          'liora · session open',
          '/login · account ready',
          '/model · selected',
          'Bash · current workspace',
          'SessionControl · spawn worker',
          '/job create · explicit isolation',
          'inbox · Alt+I waiting',
          'deck · Alt+J live',
          'review · inspect diff before land',
        ],
      },
    },
    clusters: {
      kicker: '주요 기능',
      title: '현재 작업 공간에서, 두 도구로.',
      body: 'Bash 실행, 워커 세션, 명시적 native Job, 실행 승인. 한 터미널에서 다룹니다.',
      items: clustersKo,
    },
    usage: {
      kicker: '사용법',
      title: '시작은 이 다섯 줄입니다.',
      body: '프로젝트에서 열고, 계정과 모델을 붙인 뒤 결과를 적습니다.',
      items: [
        {
          id: 'liora',
          cmd: USAGE_COMMANDS[0].cmd,
          title: '세션 열기',
          body: '프로젝트 폴더에서 세션을 엽니다.',
        },
        {
          id: 'continue',
          cmd: USAGE_COMMANDS[1].cmd,
          title: '이어서 하기',
          body: '이 폴더의 최근 세션을 다시 엽니다.',
        },
        {
          id: 'prompt',
          cmd: USAGE_COMMANDS[2].cmd,
          title: '요청 실행',
          body: '프롬프트를 CLI로 전달해 현재 작업 공간에서 실행합니다.',
        },
        {
          id: 'login',
          cmd: USAGE_COMMANDS[3].cmd,
          title: '계정 연결',
          body: 'OAuth, API 키, 또는 커스텀 엔드포인트를 연결합니다.',
        },
        {
          id: 'model',
          cmd: USAGE_COMMANDS[4].cmd,
          title: '모델 고르기',
          body: '이 세션에서 사용할 모델을 고릅니다.',
        },
      ],
    },
    workflow: {
      kicker: '워크플로우',
      title: '적고, 실행하고, 검토하기.',
      body: '기본은 현재 작업 공간에서 직접 실행입니다. Job 격리와 land는 명시적으로 선택합니다.',
      steps: [
        {
          id: 'write',
          title: '결과를 적기',
          body: '“로그인 후 /app으로 가게 해줘”처럼 원하는 결과와 실행할 검사를 적습니다. Bash는 현재 작업 공간에서 실행됩니다.',
        },
        {
          id: 'job',
          title: '필요하면 native Job',
          body: '/job create로 격리된 백그라운드 작업을 명시적으로 만듭니다. 세션 전체의 격리는 --worktree로 선택합니다.',
        },
        {
          id: 'inbox',
          title: 'Inbox에서 답하기',
          body: 'native Job이 질문하면 Alt+I에서 답합니다. 진행과 diff는 Alt+J Job Deck에서 봅니다.',
        },
        {
          id: 'land',
          title: '검토 후 land',
          body: 'diff와 요청한 검사 결과를 직접 확인합니다. native Job은 /job land로 합칠 방식을 고르고, push는 별도로 요청합니다.',
        },
      ],
    },
    tower: {
      kicker: '손에 익는 키',
      title: '자주 쓰는 다섯 가지.',
      body: '처음엔 이것만으로 충분합니다.',
      items: [
        {
          keys: 'Alt+J',
          title: 'Job Deck',
          body: '지금 돌아가는 Job과 diff를 엽니다.',
        },
        {
          keys: 'Alt+I',
          title: 'Inbox',
          body: '에이전트가 물은 내용에 한 줄로 답합니다.',
        },
        {
          keys: '/sessions',
          title: '세션 목록',
          body: '저장된 세션을 열어 이어서 작업합니다.',
        },
        {
          keys: 'Ctrl+K',
          title: 'Command Hub',
          body: '설정·세션·작업·업그레이드·Quota. macOS는 Cmd+K. Ctrl+Space나 ?로도 엽니다.',
        },
        {
          keys: '/permission',
          title: '실행 승인',
          body: 'manual·auto·yolo 중 승인 방식을 고릅니다.',
        },
      ],
    },
    install: {
      kicker: '설치법',
      title: '한 줄이면 설치됩니다.',
      body: '그다음 프로젝트에서 liora를 켜고 /login과 /model로 연결하세요. 호스트에 Node가 없으면 한 줄이 데이터 홈에 Node.js 24.15.0을 받습니다. Windows는 여유 있는 드라이브(약 100 GB)를 고를 수 있고, SUPERLIORA_HOME은 모든 OS에서 됩니다. 설치 후 바탕 화면 바로가기가 생기며, 터미널이 얇으면 /host-setup을 쓰세요. GitHub Release가 나오면 liora upgrade 또는 /upgrade로 갱신합니다.',
      requirements: NODE_REQUIREMENT,
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
        { label: 'Windows cmd', cmd: INSTALL_CMD },
      ],
      next: '짧은 가이드 보기',
    },
    footer: {
      copyright: '© SuperLiora Contributors',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      docs: '가이드',
      issues: 'Issues',
      security: 'Security',
      tagline: '터미널 AI 코딩 에이전트',
    },
    theme: {
      light: '라이트',
      dark: '다크',
      toLight: '라이트 테마로 전환',
      toDark: '다크 테마로 전환',
    },
    copy: {
      idle: '복사',
      done: '완료',
      label: '명령 복사',
      doneLabel: '복사됨',
    },
    visuals: visualsKo,
    docsNav: docsNavKo,
    docsShell: {
      home: '홈',
      onThisSite: '가이드',
      guide: '가이드 목차',
      toc: '이 페이지',
      prev: '이전',
      next: '다음',
      copy: '복사',
      copied: '복사됨',
      terminal: '터미널',
      minRead: '분 읽기',
      of: '/',
    },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: '시작하기',
        lead: '설치부터 첫 작업까지.',
        sections: [
          {
            heading: '설치법',
            body: `${NODE_REQUIREMENT}. 운영체제에 맞는 한 줄을 실행합니다. 호스트에 Node가 없으면 데이터 홈에 Node.js 24.15.0을 받습니다.`,
            tabs: [
              { label: 'macOS / Linux', code: INSTALL_SH },
              { label: 'Windows PowerShell', code: INSTALL_PS },
              { label: 'Windows cmd', code: INSTALL_CMD },
            ],
            note: 'Windows에서 프로필 디스크가 빠듯하면 여유 있는 드라이브(약 100 GB)를 고릅니다. SUPERLIORA_HOME은 모든 OS에서 됩니다. 파이프된 irm | iex는 플래그를 무시합니다. 먼저 $env:SUPERLIORA_HOME을 두거나, 받아서 .\\install.ps1 --home D:\\SuperLiora를 실행하세요. Unix는 install.sh --home 또는 SUPERLIORA_HOME.',
          },
          {
            heading: '설치 후',
            body: '설치가 끝나면 아래 순서대로 환경을 맞춥니다.',
            list: [
              '바탕 화면의 SuperLiora를 더블클릭해 실제 터미널에서 TUI를 엽니다.',
              '/host-setup은 확인 목록을 보여 준 뒤 Windows Terminal(Windows), CaskaydiaCove Nerd Font, Oh My Posh, zoxide, fzf를 적용합니다.',
              '클래식 콘솔은 시네마틱 스플래시 없이 에디터·orb·허브 크롬만 움직이고, Windows Terminal은 스플래시까지 풀 TUI 모션입니다.',
              'GitHub Release가 나오면 liora upgrade 또는 /upgrade로 설치를 갱신합니다. 추적은 공개 Release이고, main 최신은 --main.',
              'UI 언어는 SUPERLIORA_LOCALE=ko|en, Settings → Language, 또는 /locale.',
            ],
          },
          {
            heading: '사용법',
            body: '프로젝트 폴더에서 세션을 열고 /login과 /model로 모델을 연결한 뒤 원하는 결과를 적습니다. /login으로 OAuth, API 키, 커스텀 엔드포인트를 연결합니다. 일반 실행은 현재 작업 공간을 사용합니다.',
            code: 'liora\nliora --continue\nliora -p "Fix the webhook handler"\n/login\n/model\n/host-setup',
          },
          {
            heading: '워크플로우',
            body: '첫 작업의 흐름은 이렇습니다.',
            list: [
              '모델은 Bash와 SessionControl만 사용합니다. Bash 명령은 현재 작업 공간에서 실행됩니다.',
              '격리가 필요하면 /job create로 native Job을 명시적으로 만들거나 liora --worktree로 세션을 엽니다.',
              'native Job은 Alt+J에서 보고 Alt+I에서 답합니다. diff와 검사 결과를 직접 검토한 뒤 /job land를 선택합니다.',
            ],
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: '어떻게 일하나요',
        lead: '기본은 현재 작업 공간에서 직접 실행. 워커와 native Job은 별도로 다룹니다.',
        sections: [
          {
            heading: '두 모델 도구',
            body: 'Bash와 SessionControl이 모델에 공개되는 도구의 전부입니다.',
            list: [
              'Bash로 현재 작업 공간의 파일을 읽고 수정하고 명령을 실행합니다.',
              'SessionControl로 워커 세션을 spawn·list·message·wait·stop·compact합니다. 워커도 Bash와 SessionControl만 사용합니다.',
            ],
          },
          {
            heading: '명시적 native Job',
            body: '/job create는 운영자용 native 제어입니다. 모델 도구와 별개로 백그라운드 작업을 만들고, Job Deck·Worker Dock·Kanban에서 진행을 봅니다.',
          },
          {
            heading: '선택적 격리',
            body: '일반 프롬프트와 워커는 현재 작업 공간에서 실행됩니다. native Job이나 세션의 --worktree를 명시적으로 선택할 때 별도 작업 공간을 사용합니다.',
            note: 'liora --worktree는 세션 전체를 옮깁니다. /job create는 Job 단위의 작업 공간을 만듭니다.',
          },
          {
            heading: '승인과 직접 검토',
            body: '/permission으로 실행 승인 방식을 고릅니다. 검사는 요청한 경우 실행하고, 결과와 diff를 직접 확인합니다. 자동 검토·검사 통과를 전제로 land하지 않습니다.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: '작업 다루기',
        lead: '목록, 진행 보기, 답변, 합치기.',
        sections: [
          {
            heading: '명시적으로 만들기',
            body: '격리된 백그라운드 작업이 필요할 때 native Job을 만듭니다. 일반 프롬프트가 자동으로 Job이 되지는 않습니다.',
            code: '/job create Fix the webhook handler',
          },
          {
            heading: '보기',
            body: '/jobs로 목록을 보고, Alt+J로 진행 화면을 엽니다.',
            code: '/jobs\n/jobs deck',
          },
          {
            heading: '조향',
            body: '답변·재개·취소로 실행 중 작업을 다룹니다.',
            code: '/job inbox\n/job answer <id> <text>\n/job resume\n/job cancel <id>',
          },
          {
            heading: '검토 후 land',
            body: 'diff와 검사 결과를 직접 검토합니다. /job review와 /job verify는 명시적으로 요청하는 별도 Job이며, 검토 완료나 검사 통과를 보장하지 않습니다. /job land에서 통합 방식을 선택합니다.',
            code: '/job review <id>\n/job verify <id> Run the project tests and report results\n/job land <id>\n/job push <id>',
            note: 'land와 push는 별도 운영자 동작입니다. 요청한 검사가 실제로 실행됐는지 결과를 확인하세요.',
          },
          {
            heading: '정리',
            body: '끝난 작업 폴더를 치웁니다.',
            code: '/job gc',
          },
        ],
      },
      'control-tower': {
        slug: 'control-tower',
        title: '단축키',
        lead: '손에 익히면 편해지는 키.',
        sections: [
          {
            heading: '기본',
            body: '처음엔 이 목록만으로 충분합니다.',
            list: [
              'Alt+J 진행 · Alt+I 질문함 · /sessions 세션 목록',
              'Ctrl+K Command Hub (macOS는 Cmd)',
              'Hub는 Ctrl+Space, ?, /help로도 엽니다.',
            ],
          },
          {
            heading: '실행 승인',
            body: 'manual / auto / yolo 중 세션의 실행 승인 방식을 고릅니다.',
            code: '/permission manual',
          },
          {
            heading: '세션과 워커',
            body: '/sessions로 저장된 세션을 열고, /jobs dock으로 Worker Dock을 다룹니다. 워커 제어는 모델의 SessionControl 도구에서 이뤄집니다.',
            code: '/sessions\n/jobs dock\n/jobs bg',
          },
        ],
      },
      reference: {
        slug: 'reference',
        title: '명령 모음',
        lead: '자주 쓰는 것만.',
        sections: [
          {
            heading: '실행',
            body: '세션을 열고, 갱신하고, 점검을 돌립니다.',
            code: 'liora\nliora --continue\nliora -p "Fix the webhook handler"\nliora --worktree [name]\nliora upgrade\nliora doctor\nliora gc',
          },
          {
            heading: '슬래시',
            body: '세션 안에서 쓰는 명령입니다.',
            list: [
              '/login · /model · /host-setup — 계정·모델·터미널 설정',
              '/jobs · /job — 작업 목록과 조향',
              '/sessions · /jobs dock · /jobs bg — 세션·워커·백그라운드 작업',
              '/status · /quota · /help · /upgrade — 상태·잔량·도움·갱신',
              '/resume · /locale · /permission — 이어하기·언어·권한',
            ],
            note: '/resume는 /sessions의 별칭. /permission은 manual|auto|yolo. 저사양은 Settings → Appearance 또는 /performance. /quota는 실시간 남은 크레딧. 푸터 칩은 활성 프로바이더이고, 남은 양이 불명이면 숨깁니다.',
          },
          {
            heading: '모델 도구와 native 제어',
            body: '모델 도구는 Bash와 SessionControl뿐입니다. /job 명령은 native 운영자 제어이며, 일반 실행을 대신하는 강제 경로가 아닙니다.',
          },
          {
            heading: '메이저 버전 마이그레이션',
            body: '모델 도구는 Bash와 SessionControl로 전환됐습니다. plan·goal·skills·MCP·memory·인지 카탈로그·persona·역할별 모델 라우팅은 제거됐습니다. 이전 명령이나 설정의 호환 별칭은 없습니다.',
            list: [
              '워커·단계·전체 턴을 자동으로 재시도하거나 이미 실행된 작업을 재실행하지 않습니다. 실패 뒤 재개나 재시도는 명시적으로 요청합니다.',
              '자동 검토·강제 검사·검사 통과 보장은 없습니다. 필요한 검사와 리뷰를 요청하고 관찰된 결과를 직접 확인합니다.',
              '컨텍스트 압축은 /compact 또는 SessionControl의 compact로 명시적으로 요청합니다.',
              '운영자가 설정한 native 프로바이더 경로·상태·출력 전 폴백은 유지됩니다. 이미 출력이나 도구 실행이 시작된 턴을 자동으로 다시 실행한다는 뜻은 아닙니다.',
            ],
            note: '기존 TOML에서 [research] 섹션과 [loop_control]의 max_retries_per_step을 직접 제거하세요. 이 항목을 포함한 폐기된 설정은 구성 검증에서 거부됩니다. 업그레이드가 홈 디렉터리의 설정을 자동으로 다시 쓰지는 않습니다.',
          },
        ],
      },
    },
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Run coding agents from your terminal',
      description:
        'Code in your current workspace with Bash and SessionControl. Create native Jobs explicitly for isolation, inspect diffs and check results yourself, then choose land.',
      ogLocale: 'en_US',
    },
    skip: 'Skip to content',
    nav: {
      features: 'Features',
      usage: 'Usage',
      workflow: 'Workflow',
      install: 'Install',
      docs: 'Guide',
      menuOpen: 'Open menu',
      menuClose: 'Close menu',
    },
    hero: {
      brand: 'SuperLiora',
      eyebrow: 'AI CODING AGENT · LOCAL FIRST',
      h1: 'Run coding agents from your terminal.',
      lead: 'Execute in your workspace with Bash and manage workers with SessionControl. Create isolated native Jobs explicitly when you need them.',
      command: '$ liora',
      proof: [
        { value: 'Two tools', label: 'Bash + SessionControl' },
        { value: 'Direct execution', label: 'current workspace by default' },
        { value: 'Explicit Jobs', label: 'choose isolation, review, and land' },
      ],
      install: 'Install',
      github: 'GitHub',
      docs: 'Guide',
      frame: {
        conductor: 'SESSION · CONTROL PLANE',
        conductorState: '3 jobs · 1 needs you',
        inbox: 'INBOX 01',
        jobLabel: 'Job',
        jobName: 'Auth redirect',
        jobStatus: 'running',
        boardTitle: 'Board',
        progress: '1 / 3',
        doingLabel: 'Doing',
        nextLabel: 'Next',
        doneLabel: 'Done',
        doing: 'Send /app after login',
        next: 'Handle session expiry',
        done: 'Route guard',
        workerName: 'coder',
        workerModel: 'selected model',
        workerRate: '820 /s',
        stream: [
          'liora · session open',
          '/login · account ready',
          '/model · selected',
          'Bash · current workspace',
          'SessionControl · spawn worker',
          '/job create · explicit isolation',
          'inbox · Alt+I waiting',
          'deck · Alt+J live',
          'review · inspect diff before land',
        ],
      },
    },
    clusters: {
      kicker: 'Features',
      title: 'Two tools. Your workspace.',
      body: 'Bash execution, worker sessions, explicit native Jobs, and approvals in one terminal.',
      items: clustersEn,
    },
    usage: {
      kicker: 'Usage',
      title: 'Five lines to start.',
      body: 'Open a session in the project, connect an account and a model, then write the outcome.',
      items: [
        {
          id: 'liora',
          cmd: USAGE_COMMANDS[0].cmd,
          title: 'Open a session',
          body: 'Start a session in this project folder.',
        },
        {
          id: 'continue',
          cmd: USAGE_COMMANDS[1].cmd,
          title: 'Resume',
          body: 'Reopen the latest session in this folder.',
        },
        {
          id: 'prompt',
          cmd: USAGE_COMMANDS[2].cmd,
          title: 'Run a prompt',
          body: 'Pass a prompt from the CLI to execute in the current workspace.',
        },
        {
          id: 'login',
          cmd: USAGE_COMMANDS[3].cmd,
          title: 'Connect an account',
          body: 'Connect OAuth, an API key, or a custom endpoint.',
        },
        {
          id: 'model',
          cmd: USAGE_COMMANDS[4].cmd,
          title: 'Pick a model',
          body: 'Choose the model for this session.',
        },
      ],
    },
    workflow: {
      kicker: 'Workflow',
      title: 'Write, execute, review.',
      body: 'Direct workspace execution is the default. Choose Job isolation and land explicitly.',
      steps: [
        {
          id: 'write',
          title: 'Describe the result',
          body: '“After login, go to /app.” Include any checks you want run. Bash executes in the current workspace.',
        },
        {
          id: 'job',
          title: 'Optional native Job',
          body: 'Use /job create explicitly for isolated background work. Use --worktree to isolate the whole session.',
        },
        {
          id: 'inbox',
          title: 'Answer in Inbox',
          body: 'When a native Job asks, reply in Alt+I. Watch progress and diffs on the Job Deck (Alt+J).',
        },
        {
          id: 'land',
          title: 'Review, then land',
          body: 'Inspect the diff and requested check results yourself. For native Jobs, /job land selects how to integrate changes; request push separately.',
        },
      ],
    },
    tower: {
      kicker: 'Keys that stick',
      title: 'Five shortcuts.',
      body: 'Enough for the first week.',
      items: [
        {
          keys: 'Alt+J',
          title: 'Job Deck',
          body: 'Open live Jobs and diffs.',
        },
        {
          keys: 'Alt+I',
          title: 'Inbox',
          body: 'Answer questions from running work.',
        },
        {
          keys: '/sessions',
          title: 'Session list',
          body: 'Open a saved session to continue working.',
        },
        {
          keys: 'Ctrl+K',
          title: 'Command Hub',
          body: 'Settings, sessions, jobs, upgrade, Quota. Cmd+K on macOS. Also Ctrl+Space or ?.',
        },
        {
          keys: '/permission',
          title: 'Execution approvals',
          body: 'Choose manual, auto, or yolo.',
        },
      ],
    },
    install: {
      kicker: 'Install',
      title: 'One line to install.',
      body: 'Then run liora in a project and connect a model with /login and /model. If the host has no Node, the one-liner downloads Node.js 24.15.0 into the data home. Windows may pick a roomier drive (~100 GB); SUPERLIORA_HOME works on every OS. After install, a Desktop shortcut opens the TUI; run /host-setup if the terminal is thin. After a GitHub Release, liora upgrade or /upgrade updates the install.',
      requirements: NODE_REQUIREMENT,
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
        { label: 'Windows cmd', cmd: INSTALL_CMD },
      ],
      next: 'Open the short guide',
    },
    footer: {
      copyright: '© SuperLiora Contributors',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      docs: 'Guide',
      issues: 'Issues',
      security: 'Security',
      tagline: 'Terminal AI coding agent',
    },
    theme: {
      light: 'Light',
      dark: 'Dark',
      toLight: 'Switch to light theme',
      toDark: 'Switch to dark theme',
    },
    copy: {
      idle: 'Copy',
      done: 'OK',
      label: 'Copy command',
      doneLabel: 'Copied',
    },
    visuals: visualsEn,
    docsNav: docsNavEn,
    docsShell: {
      home: 'Home',
      onThisSite: 'Guide',
      guide: 'Guide index',
      toc: 'On this page',
      prev: 'Previous',
      next: 'Next',
      copy: 'Copy',
      copied: 'Copied',
      terminal: 'Terminal',
      minRead: 'min read',
      of: 'of',
    },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: 'Getting started',
        lead: 'From install to your first workspace session.',
        sections: [
          {
            heading: 'Install',
            body: `${NODE_REQUIREMENT}. Run the one-liner for your OS. If the host has no Node, it downloads Node.js 24.15.0 into the data home.`,
            tabs: [
              { label: 'macOS / Linux', code: INSTALL_SH },
              { label: 'Windows PowerShell', code: INSTALL_PS },
              { label: 'Windows cmd', code: INSTALL_CMD },
            ],
            note: 'On Windows, a tight profile disk picks a roomier drive (~100 GB free). SUPERLIORA_HOME works on every OS. Piped irm | iex ignores flags — set $env:SUPERLIORA_HOME first, or download and run .\\install.ps1 --home D:\\SuperLiora. On Unix, install.sh --home or SUPERLIORA_HOME.',
          },
          {
            heading: 'After install',
            body: 'After install, set up the environment in this order.',
            list: [
              'Double-click SuperLiora on the Desktop to open the TUI in a real terminal.',
              'Run /host-setup to see a confirm list, then apply Windows Terminal (Windows), CaskaydiaCove Nerd Font, Oh My Posh, zoxide, and fzf.',
              'Classic consoles keep chrome (editor, orb, hub) moving without the cinematic splash; Windows Terminal keeps full TUI motion (including splash).',
              'After a GitHub Release, liora upgrade or /upgrade updates the install. That tracks published releases, not arbitrary main commits. Use --main for tip of main.',
              'UI language: SUPERLIORA_LOCALE=ko|en, Settings → Language, or /locale.',
            ],
          },
          {
            heading: 'Usage',
            body: 'Open a session in a project folder, connect a model with /login and /model, then write the outcome. /login connects OAuth, API keys, and custom endpoints. Ordinary execution uses the current workspace.',
            code: 'liora\nliora --continue\nliora -p "Fix the webhook handler"\n/login\n/model\n/host-setup',
          },
          {
            heading: 'Workflow',
            body: 'Start in the workspace; choose isolation only when needed.',
            list: [
              'The model uses only Bash and SessionControl. Bash commands run in the current workspace.',
              'For isolation, create a native Job explicitly with /job create or start a session with liora --worktree.',
              'Watch native Jobs in Alt+J and answer in Alt+I. Inspect diffs and check results yourself before /job land.',
            ],
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: 'How it works',
        lead: 'Direct workspace execution by default, with separate worker and native Job controls.',
        sections: [
          {
            heading: 'Two model tools',
            body: 'Bash and SessionControl are the entire model-facing tool surface.',
            list: [
              'Bash reads and edits files and executes commands in the current workspace.',
              'SessionControl supports spawn, list, message, wait, stop, and compact for worker sessions. Workers use the same two tools.',
            ],
          },
          {
            heading: 'Explicit native Jobs',
            body: '/job create is a native operator control, separate from the model tools. Create background work explicitly and monitor it in the Job Deck, Worker Dock, and Kanban board.',
          },
          {
            heading: 'Optional isolation',
            body: 'Ordinary prompts and workers run in the current workspace. A separate workspace is used when you explicitly choose a native Job or --worktree session.',
            note: 'liora --worktree moves the whole session. /job create creates a Job-specific workspace.',
          },
          {
            heading: 'Approvals and manual review',
            body: '/permission selects execution approvals. Ask for the checks you want run, then inspect their results and the diff yourself. Land does not imply automatic review or passing checks.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: 'Jobs',
        lead: 'List, watch, answer, and merge.',
        sections: [
          {
            heading: 'Create explicitly',
            body: 'Create a native Job when you need isolated background work. An ordinary prompt does not automatically become a Job.',
            code: '/job create Fix the webhook handler',
          },
          {
            heading: 'Watch',
            body: 'List with /jobs. Open the live view with Alt+J.',
            code: '/jobs\n/jobs deck',
          },
          {
            heading: 'Steer',
            body: 'Answer, resume, or cancel running work.',
            code: '/job inbox\n/job answer <id> <text>\n/job resume\n/job cancel <id>',
          },
          {
            heading: 'Review, then land',
            body: 'Inspect diffs and check results yourself. /job review and /job verify create separate Jobs only on request; they do not guarantee completed review or passing checks. /job land selects how to integrate the changes.',
            code: '/job review <id>\n/job verify <id> Run the project tests and report results\n/job land <id>\n/job push <id>',
            note: 'Land and push are separate operator actions. Confirm that the requested checks actually ran.',
          },
          {
            heading: 'Clean up',
            body: 'Remove finished job folders.',
            code: '/job gc',
          },
        ],
      },
      'control-tower': {
        slug: 'control-tower',
        title: 'Shortcuts',
        lead: 'Keys that pay off quickly.',
        sections: [
          {
            heading: 'Basics',
            body: 'This list alone is enough for the first week.',
            list: [
              'Alt+J progress · Alt+I inbox · /sessions session list',
              'Ctrl+K hub (Cmd on macOS)',
              'Command Hub also opens with Ctrl+Space, ?, or /help.',
            ],
          },
          {
            heading: 'Execution approvals',
            body: 'Choose manual, auto, or yolo for session execution approvals.',
            code: '/permission manual',
          },
          {
            heading: 'Sessions and workers',
            body: '/sessions opens saved sessions; /jobs dock controls the Worker Dock. The model uses SessionControl to manage workers.',
            code: '/sessions\n/jobs dock\n/jobs bg',
          },
        ],
      },
      reference: {
        slug: 'reference',
        title: 'Commands',
        lead: 'The ones you will actually use.',
        sections: [
          {
            heading: 'CLI',
            body: 'Open a session, update the install, or check the machine.',
            code: 'liora\nliora --continue\nliora -p "Fix the webhook handler"\nliora --worktree [name]\nliora upgrade\nliora doctor\nliora gc',
          },
          {
            heading: 'Slash',
            body: 'Commands you type inside a session.',
            list: [
              '/login · /model · /host-setup — accounts, models, terminal setup',
              '/jobs · /job — the job list and steering',
              '/sessions · /jobs dock · /jobs bg — sessions, workers, background work',
              '/status · /quota · /help · /upgrade — status, credits, help, updates',
              '/resume · /locale · /permission — resume, language, permissions',
            ],
            note: '/resume is an alias of /sessions. /permission is manual|auto|yolo. For low-spec machines, Settings → Appearance or /performance. /quota shows live remaining credits; the footer chip is the active provider; unknown remaining stays hidden.',
          },
          {
            heading: 'Model tools and native controls',
            body: 'The model has only Bash and SessionControl. /job commands are native operator controls, not a mandatory path for ordinary execution.',
          },
          {
            heading: 'Major-version migration',
            body: 'The model-facing tools are now Bash and SessionControl. Plan, goal, skills, MCP, memory, cognitive catalogs, persona, and role-based model routing are removed. Retired commands and settings have no compatibility aliases.',
            list: [
              'No automatic worker, step, or whole-turn retries, and no replay of effects already executed. Request resumption or retry explicitly after a failure.',
              'There is no automatic review, forced verification, or guarantee of passing checks. Request the checks and reviews you need, then inspect the observed results.',
              'Request context compaction explicitly with /compact or SessionControl compact.',
              'Operator-configured native provider routes, status, and pre-output fallback remain. They do not imply automatic replay of a turn after output or tool execution has begun.',
            ],
            note: 'Manually remove the [research] section and max_retries_per_step under [loop_control] from existing TOML. Retired settings, including these fields, are rejected by config validation. Upgrades do not automatically rewrite settings in your home directory.',
          },
        ],
      },
    },
  },
};
