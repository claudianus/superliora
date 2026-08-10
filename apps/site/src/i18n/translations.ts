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

export interface DocPage {
  slug: DocSlug;
  title: string;
  lead: string;
  sections: { heading: string; body: string; code?: string }[];
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
    how: string;
    install: string;
    docs: string;
    menuOpen: string;
    menuClose: string;
  };
  hero: {
    brand: string;
    h1: string;
    lead: string;
    install: string;
    github: string;
    docs: string;
    frame: {
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
    };
  };
  clusters: {
    kicker: string;
    title: string;
    body: string;
    items: ClusterItem[];
  };
  how: {
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
  };
}

export const defaultLang: Lang = 'ko';
export const PRODUCT_VERSION = '0.6.0';

const INSTALL_SH =
  'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash';
const INSTALL_PS =
  'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex';

const visualsKo: SiteVisuals = {
  statusRoute: {
    chrome: 'Status · Route',
    badge: 'Smart Auto',
    strategyLabel: 'Strategy',
    strategy: 'Smart Auto',
    ready: '2 / 3 ready',
    candidates: [
      { rank: '#1', name: 'claude · opus', state: 'ready', tone: 'ready' },
      { rank: '#2', name: 'qwen · coder', state: 'cooling → failover', tone: 'cool' },
      { rank: '#3', name: 'gpt · mini', state: 'standby', tone: 'idle' },
    ],
    roles: [
      { role: 'Explore', model: 'fast' },
      { role: 'Coding', model: 'opus' },
      { role: 'Plan', model: 'sonnet' },
    ],
    footer: 'A → B failover · never-halt on',
  },
  jobDeck: {
    chrome: 'Job Deck',
    badge: 'Alt+J',
    subtitle: 'Mission monitor',
    inbox: 'Inbox 1',
    jobs: [
      { id: 'job_a1', title: 'Auth redirect', status: 'running', phase: 'tests 2/3', age: '12s', tone: 'run' },
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
      { name: 'coder', action: 'Edit src/auth/redirect.ts', rate: '820/s', tone: 'live' },
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
    query: 'ask mode',
    modes: [
      { label: 'Ask', active: true },
      { label: 'Build' },
      { label: 'Goal' },
    ],
    rows: [
      { label: 'Ask / Build', desc: '실행 없이 답만', keys: 'Shift-Tab', selected: true },
      { label: 'Job Deck', desc: '진행·diff·테스트', keys: 'Alt+J' },
      { label: 'Inbox', desc: '질문에 한 줄로 답', keys: 'Alt+I' },
      { label: 'Permissions', desc: '도구·쓰기 허용 범위', keys: 'Ctrl+K' },
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
      { title: '결과 적기', body: '끝난 모습을 한 줄로' },
      { title: '백그라운드', body: '채팅은 비워 두고 진행' },
      { title: '짧게 답하기', body: 'Inbox에서 끼어들기' },
      { title: '합치기', body: '통과분만 Land' },
    ],
  },
};

const visualsEn: SiteVisuals = {
  statusRoute: {
    chrome: 'Status · Route',
    badge: 'Smart Auto',
    strategyLabel: 'Strategy',
    strategy: 'Smart Auto',
    ready: '2 / 3 ready',
    candidates: [
      { rank: '#1', name: 'claude · opus', state: 'ready', tone: 'ready' },
      { rank: '#2', name: 'qwen · coder', state: 'cooling → failover', tone: 'cool' },
      { rank: '#3', name: 'gpt · mini', state: 'standby', tone: 'idle' },
    ],
    roles: [
      { role: 'Explore', model: 'fast' },
      { role: 'Coding', model: 'opus' },
      { role: 'Plan', model: 'sonnet' },
    ],
    footer: 'A → B failover · never-halt on',
  },
  jobDeck: {
    chrome: 'Job Deck',
    badge: 'Alt+J',
    subtitle: 'Mission monitor',
    inbox: 'Inbox 1',
    jobs: [
      { id: 'job_a1', title: 'Auth redirect', status: 'running', phase: 'tests 2/3', age: '12s', tone: 'run' },
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
      { name: 'coder', action: 'Edit src/auth/redirect.ts', rate: '820/s', tone: 'live' },
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
    query: 'ask mode',
    modes: [
      { label: 'Ask', active: true },
      { label: 'Build' },
      { label: 'Goal' },
    ],
    rows: [
      { label: 'Ask / Build', desc: 'Answers only — no new jobs', keys: 'Shift-Tab', selected: true },
      { label: 'Job Deck', desc: 'Progress, diffs, tests', keys: 'Alt+J' },
      { label: 'Inbox', desc: 'Answer in one line', keys: 'Alt+I' },
      { label: 'Permissions', desc: 'Tool and write scope', keys: 'Ctrl+K' },
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
      { title: 'Describe', body: 'Write the finished state' },
      { title: 'Background', body: 'Chat stays clear' },
      { title: 'Answer', body: 'Step in via Inbox' },
      { title: 'Land', body: 'Merge what passed' },
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
    id: 'keep-going',
    title: '끊겨도 일이 이어집니다',
    lead: '모델·계정이 흔들려도 작업은 멈추지 않게 잡았습니다.',
    features: [
      { id: 'smart-auto', title: 'Smart Auto', body: '지금 살아서 응답하는 모델을 골라 이 턴을 이어 갑니다.' },
      { id: 'fallback', title: '모델 폴백', body: '하나가 죽으면 다음 후보로 바로 넘깁니다.' },
      { id: 'role-routing', title: '역할별 라우팅', body: '탐색·코딩·계획에 맞는 모델을 나눠 씁니다.' },
      { id: 'login', title: '로그인', body: '/login으로 계정을 붙이면 바로 쓸 수 있습니다.' },
      { id: 'oauth-pools', title: 'OAuth 풀', body: '계정 여러 개를 돌려 가며 한도·장애를 피합니다.' },
      { id: 'api-key-pools', title: 'API 키 풀', body: '키를 묶어두면 하나가 막혀도 다음 키로 갑니다.' },
      { id: 'never-halt', title: 'Never-Halt', body: '재시도·교체로 작업이 중간에 죽지 않게 붙잡습니다.' },
      { id: 'custom-endpoint', title: '커스텀 엔드포인트', body: 'OpenAI 호환 URL을 그대로 붙일 수 있습니다.' },
    ],
  },
  {
    id: 'see-fleet',
    title: '돌아가는 일이 한눈에',
    lead: 'Job Deck·Worker Dock·보드가 같은 화면에서 같이 움직입니다.',
    features: [
      { id: 'worker-dock', title: 'Worker Dock', body: '누가 어떤 도구를 도는지 옆 밴드에서 실시간으로 봅니다.' },
      { id: 'todo-board', title: 'To\u200bdo Board', body: '하는 중·다음·완료를 보드로 읽습니다.' },
      { id: 'worktree', title: '작업별 브랜치', body: '작업마다 분리된 브랜치라 병렬로 맡겨도 트리가 안 섞입니다.' },
      { id: 'job-deck', title: 'Job Deck', body: 'Alt+J로 diff·테스트·진행을 엽니다.' },
      { id: 'inbox', title: 'Inbox', body: '질문이 뜨면 Alt+I에서 한 줄로 답하고 이어서 돌립니다.' },
      { id: 'land', title: 'Land', body: '통과한 것만 로컬에 합칩니다. push는 원할 때.' },
    ],
  },
  {
    id: 'stay-control',
    title: '맡기되, 핸들은 당신 것',
    lead: '언제 실행하고 언제 묻기만 할지 당신이 정합니다.',
    features: [
      { id: 'ask-mode', title: 'Ask', body: 'Shift-Tab으로 질문만 하는 모드. 새 작업은 안 뜹니다.' },
      { id: 'goal', title: 'Goal', body: '목표를 남기면 끝날 때까지 밀어 봅니다. 채팅은 열려 있습니다.' },
      { id: 'permissions', title: '권한 모드', body: '도구·쓰기를 얼마나 허용할지 세션에서 고릅니다.' },
    ],
  },
  {
    id: 'studio',
    title: '터미널이 IDE처럼',
    lead: '찾기·diff·연구·확장이 같은 화면 안에 있습니다.',
    features: [
      { id: 'in-tui-diff', title: '화면 안 diff', body: '파일·검색·변경을 터미널을 떠나지 않고 봅니다.' },
      { id: 'command-hub', title: 'Command Hub', body: 'Ctrl+K로 설정·명령·모드를 한곳에서 찾습니다.' },
      { id: 'visual-quality', title: 'Visual Quality', body: '모션·밀도·글로우를 Neon Noir에 맞춰 조정합니다.' },
      { id: 'deep-research', title: 'Deep research', body: '긴 조사는 작업으로 돌려 두고 결과만 받습니다.' },
      { id: 'extensions', title: 'Extensions', body: '스킬·MCP·훅을 허브에서 붙입니다.' },
      { id: 'locale', title: '한국어 / English', body: 'UI 언어를 바꿔도 흐름은 같습니다.' },
      { id: 'media', title: '미디어', body: '이미지 등 미디어 생성을 같은 세션에서 다룹니다.' },
    ],
  },
];

const clustersEn: ClusterItem[] = [
  {
    id: 'keep-going',
    title: 'Work keeps going',
    lead: 'When a model or account blips, the job does not die with it.',
    features: [
      { id: 'smart-auto', title: 'Smart Auto', body: 'Picks a model that is alive for this turn.' },
      { id: 'fallback', title: 'Model fallback', body: 'If one dies, the next candidate takes over.' },
      { id: 'role-routing', title: 'Role routing', body: 'Explore, code, and plan can use different models.' },
      { id: 'login', title: 'Login', body: '/login connects an account and you are ready.' },
      { id: 'oauth-pools', title: 'OAuth pools', body: 'Rotate accounts to ride out limits and outages.' },
      { id: 'api-key-pools', title: 'API key pools', body: 'Bundle keys so a blocked one is not the end.' },
      { id: 'never-halt', title: 'Never-Halt', body: 'Retry and swap so a job stays alive mid-flight.' },
      { id: 'custom-endpoint', title: 'Custom endpoint', body: 'Point at your OpenAI-compatible URL.' },
    ],
  },
  {
    id: 'see-fleet',
    title: 'See the fleet',
    lead: 'Real TUI chrome is the hero — Dock, board, and branches move together.',
    features: [
      { id: 'worker-dock', title: 'Worker Dock', body: 'Watch who is running which tool in the side band.' },
      { id: 'todo-board', title: 'To\u200bdo Board', body: 'Read doing / next / done as a board, not a wall of logs.' },
      { id: 'worktree', title: 'Per-job branches', body: 'Each job gets its own branch so parallel work does not collide.' },
      { id: 'job-deck', title: 'Job Deck', body: 'Alt+J opens diffs, tests, and progress.' },
      { id: 'inbox', title: 'Inbox', body: 'When it asks, answer in Alt+I and it continues.' },
      { id: 'land', title: 'Land', body: 'Merge what passed locally. Push when you want.' },
    ],
  },
  {
    id: 'stay-control',
    title: 'Stay in control',
    lead: 'You decide when it runs and when it only answers.',
    features: [
      { id: 'ask-mode', title: 'Ask', body: 'Shift-Tab for answers only — no new jobs.' },
      { id: 'goal', title: 'Goal', body: 'Leave an objective and it pushes until done. Chat stays open.' },
      { id: 'permissions', title: 'Permission modes', body: 'Choose how much tool and write access the session gets.' },
    ],
  },
  {
    id: 'studio',
    title: 'Studio in the terminal',
    lead: 'Search, diffs, research, and extensions live on the same stage.',
    features: [
      { id: 'in-tui-diff', title: 'In-TUI diff', body: 'Files, search, and changes without leaving the terminal.' },
      { id: 'command-hub', title: 'Command Hub', body: 'Ctrl+K finds settings, commands, and modes.' },
      { id: 'visual-quality', title: 'Visual Quality', body: 'Tune motion, density, and glow for Neon Noir.' },
      { id: 'deep-research', title: 'Deep research', body: 'Long investigations run as jobs; you get the result.' },
      { id: 'extensions', title: 'Extensions', body: 'Skills, MCP, and hooks from one hub.' },
      { id: 'locale', title: '한국어 / English', body: 'Same flow in either UI language.' },
      { id: 'media', title: 'Media', body: 'Handle image and media generation in-session.' },
    ],
  },
];

export const translations: Record<Lang, Translation> = {
  ko: {
    lang: 'ko',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — 터미널에서 끝까지 맡기는 AI 코딩',
      description:
        'SuperLiora는 터미널 AI 코딩 에이전트입니다. 원하는 결과를 적으면 백그라운드에서 작업이 돌아가고, 진행을 보면서 필요할 때만 답하면 됩니다.',
      ogLocale: 'ko_KR',
    },
    skip: '본문으로 건너뛰기',
    nav: {
      features: '특장점',
      how: '흐름',
      install: '설치',
      docs: '가이드',
      menuOpen: '메뉴 열기',
      menuClose: '메뉴 닫기',
    },
    hero: {
      brand: 'SuperLiora',
      h1: '긴 코딩 작업, 터미널에서 끝까지.',
      lead: '원하는 결과를 적으세요. 작업은 따로 돌아가고, 당신은 진행을 보며 필요할 때만 끼어듭니다.',
      install: '설치하기',
      github: 'GitHub',
      docs: '가이드',
      frame: {
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
        workerModel: 'smart-auto',
        workerRate: '820 /s',
      },
    },
    clusters: {
      kicker: '왜 SuperLiora인가',
      title: '맡기고도 놓치지 않게.',
      body: '모델이 흔들려도, 워커가 많아도, 권한이 달라도 — 같은 터미널 안에서 이어집니다.',
      items: clustersKo,
    },
    how: {
      kicker: '한 바퀴',
      title: '적고, 보고, 답하고, 합치기.',
      body: '복잡한 파이프라인을 외울 필요 없습니다. 아래 네 가지만 기억하세요.',
      steps: [
        {
          title: '결과를 적기',
          body: '“로그인 후 /app으로 가게 해줘”처럼 끝난 모습을 적습니다.',
        },
        {
          title: '백그라운드에서 진행',
          body: '작업이 접수되면 바로 돌아가기 시작합니다. 채팅은 비어 있습니다.',
        },
        {
          title: '막히면 짧게 답하기',
          body: '질문이 뜨면 Inbox에서 한 줄로 답하고, 이어서 돌립니다.',
        },
        {
          title: '준비되면 합치기',
          body: '테스트와 충돌을 확인한 뒤 로컬 main에 합칩니다.',
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
          title: '진행 보기',
          body: '지금 돌아가는 작업과 코드 변경을 엽니다.',
        },
        {
          keys: 'Alt+I',
          title: '질문함',
          body: '에이전트가 물은 내용에 답합니다.',
        },
        {
          keys: 'Alt+B',
          title: '빠른 요청서',
          body: '급한 수정용으로 짧은 조건을 채웁니다.',
        },
        {
          keys: 'Ctrl+K',
          title: '전체 검색',
          body: '설정·명령·모드를 한곳에서 찾습니다.',
        },
        {
          keys: 'Shift-Tab',
          title: 'Ask / Build',
          body: '질문만 할지, 실행할지 바꿉니다.',
        },
      ],
    },
    install: {
      kicker: '시작',
      title: '설치하고 바로 열어보세요.',
      body: 'Node.js 24 이상이 있으면 됩니다. 켠 뒤 /login과 /model로 모델만 연결하세요.',
      requirements: 'Node.js ≥ 24.15.0',
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
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
    docsShell: { home: '홈', onThisSite: '가이드' },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: '시작하기',
        lead: '설치부터 첫 작업까지.',
        sections: [
          {
            heading: '설치',
            body: '터미널에서 한 줄로 설치합니다.',
            code: INSTALL_SH,
          },
          {
            heading: '첫 실행',
            body: '프로젝트 폴더에서 liora를 켠 뒤, /login과 /model로 모델을 연결하세요. 그리고 원하는 결과를 적으면 됩니다.',
            code: 'liora\n/login\n/model',
          },
          {
            heading: '이어서 하기',
            body: '같은 폴더의 최근 세션은 이렇게 다시 엽니다.',
            code: 'liora --continue',
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: '어떻게 일하나요',
        lead: '당신은 방향을 주고, 실행은 백그라운드 작업이 맡습니다.',
        sections: [
          {
            heading: '역할 나누기',
            body: '채팅 쪽은 읽고 정리하고 작업을 맡깁니다. 파일 수정·빌드·테스트는 분리된 작업에서 돌아갑니다.',
          },
          {
            heading: '기다리지 않기',
            body: '작업을 맡기면 바로 접수됩니다. 결과는 나중에 알림으로 옵니다.',
          },
          {
            heading: '브랜치가 나뉨',
            body: '작업마다 따로 떨어진 브랜치에서 돌아갑니다. 세션 전체를 옮기는 --worktree와는 다릅니다.',
          },
          {
            heading: 'Ask / Build',
            body: 'Shift-Tab으로 질문만 하는 모드와 실행 모드를 바꿉니다. 질문 모드에서는 새 작업이 시작되지 않습니다.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: '작업 다루기',
        lead: '목록, 진행 보기, 답변, 합치기.',
        sections: [
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
            heading: '합치기',
            body: '검사가 통과하면 로컬로 합칩니다. 원격 배포는 별도 단계입니다.',
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
            body: 'Alt+J 진행 · Alt+I 질문함 · Alt+B 빠른 요청서 · Ctrl+K 전체 검색.',
          },
          {
            heading: '작업 분위기',
            body: 'balanced / greenfield / hotfix / review. 급한 수정은 hotfix가 가볍습니다.',
            code: '/job mode hotfix',
          },
          {
            heading: '계획·목표',
            body: '큰 설계는 /plan, 끝까지 밀어볼 목표는 /goal로 넘깁니다. 채팅은 계속 열려 있습니다.',
            code: 'liora --plan\n/goal <objective>',
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
            body: '세션을 여는 방법.',
            code: 'liora\nliora --continue\nliora --plan\nliora --worktree [name]',
          },
          {
            heading: '슬래시',
            body: '/login · /model · /jobs · /job · /agents · /plan · /ask · /goal · /status · /help',
          },
          {
            heading: 'Ask 모드',
            body: '읽기만 할 때. 작업을 맡기려면 Build로 돌아오세요.',
          },
        ],
      },
    },
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Finish long coding work in the terminal',
      description:
        'SuperLiora is a terminal AI coding agent. Describe the outcome, let work run in the background, watch progress, and step in only when asked.',
      ogLocale: 'en_US',
    },
    skip: 'Skip to content',
    nav: {
      features: 'Features',
      how: 'Flow',
      install: 'Install',
      docs: 'Guide',
      menuOpen: 'Open menu',
      menuClose: 'Close menu',
    },
    hero: {
      brand: 'SuperLiora',
      h1: 'Finish long coding work in the terminal.',
      lead: 'Describe the outcome. Work runs in the background. You watch progress and step in only when asked.',
      install: 'Install',
      github: 'GitHub',
      docs: 'Guide',
      frame: {
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
        workerModel: 'smart-auto',
        workerRate: '820 /s',
      },
    },
    clusters: {
      kicker: 'Why SuperLiora',
      title: 'Hand it off without losing the thread.',
      body: 'Models blip, workers multiply, permissions change — the same terminal keeps the story.',
      items: clustersEn,
    },
    how: {
      kicker: 'The loop',
      title: 'Write, watch, answer, land.',
      body: 'No pipeline to memorize. Keep these four moves.',
      steps: [
        {
          title: 'Say the outcome',
          body: '“After OAuth, land on /app.” Describe done, not the steps.',
        },
        {
          title: 'Work runs underneath',
          body: 'Jobs start immediately. Your chat stays free.',
        },
        {
          title: 'Answer when stuck',
          body: 'When something needs you, reply in Inbox and it continues.',
        },
        {
          title: 'Land when ready',
          body: 'Review checks, then merge into local main.',
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
          title: 'See progress',
          body: 'Open live jobs and code changes.',
        },
        {
          keys: 'Alt+I',
          title: 'Inbox',
          body: 'Answer questions from running work.',
        },
        {
          keys: 'Alt+B',
          title: 'Quick brief',
          body: 'Fill a short form for hotfixes.',
        },
        {
          keys: 'Ctrl+K',
          title: 'Command Hub',
          body: 'Find settings and commands in one place.',
        },
        {
          keys: 'Shift-Tab',
          title: 'Ask / Build',
          body: 'Answers only, or run jobs.',
        },
      ],
    },
    install: {
      kicker: 'Start',
      title: 'Install, then open liora.',
      body: 'Needs Node.js 24+. After install, connect a model with /login and /model.',
      requirements: 'Node.js ≥ 24.15.0',
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
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
    docsShell: { home: 'Home', onThisSite: 'Guide' },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: 'Getting started',
        lead: 'From install to your first job.',
        sections: [
          {
            heading: 'Install',
            body: 'One line in the terminal.',
            code: INSTALL_SH,
          },
          {
            heading: 'First run',
            body: 'From a project folder, run liora, then /login and /model. Describe the outcome you want.',
            code: 'liora\n/login\n/model',
          },
          {
            heading: 'Resume',
            body: 'Reopen the latest session in this folder.',
            code: 'liora --continue',
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: 'How it works',
        lead: 'You set direction. Background jobs do the grinding.',
        sections: [
          {
            heading: 'Split roles',
            body: 'Chat reads, plans, and delegates. File edits, builds, and tests run in isolated jobs.',
          },
          {
            heading: 'Do not wait',
            body: 'Jobs are accepted immediately. Results come back as notices.',
          },
          {
            heading: 'Separate branches',
            body: 'Each job runs on its own branch. That is different from liora --worktree, which moves the whole session.',
          },
          {
            heading: 'Ask / Build',
            body: 'Shift-Tab switches ask-only and build. Ask mode will not start new jobs.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: 'Jobs',
        lead: 'List, watch, answer, land.',
        sections: [
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
            heading: 'Land',
            body: 'When checks pass, merge locally. Remote publish is a separate step.',
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
            body: 'Alt+J progress · Alt+I inbox · Alt+B quick brief · Ctrl+K hub.',
          },
          {
            heading: 'Modes',
            body: 'balanced / greenfield / hotfix / review. Hotfix stays light for urgent fixes.',
            code: '/job mode hotfix',
          },
          {
            heading: 'Plan and goals',
            body: 'Use /plan for big design, /goal to push until done. Chat stays open.',
            code: 'liora --plan\n/goal <objective>',
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
            body: 'Open a session.',
            code: 'liora\nliora --continue\nliora --plan\nliora --worktree [name]',
          },
          {
            heading: 'Slash',
            body: '/login · /model · /jobs · /job · /agents · /plan · /ask · /goal · /status · /help',
          },
          {
            heading: 'Ask mode',
            body: 'Read-only. Switch back to Build to delegate work.',
          },
        ],
      },
    },
  },
};
