# SuperLiora

**Conductor harness** — 채팅은 컨트롤 플레인이고, 구현은 격리 Job(worktree)에서 돌아갑니다.

[라이브 사이트](https://claudianus.github.io/superliora/) · [English](./README.md) · [문서](https://claudianus.github.io/superliora/docs/getting-started.html)

## 기능

- **Conductor** — 끝난 모습을 적으면 격리 git worktree Job이 실행합니다
- **Job Deck · Inbox** — `Alt+J`로 진행을 보고, `Alt+I`에서 질문에 답한 뒤, 통과분만 로컬에 Land
- **Smart Auto** — 모델 폴백, 로그인 풀, Never-Halt 재시도(HTTP 5xx, 504만이 아님)로 계정·모델이 흔들려도 턴이 이어집니다
- **Command Hub** — `Ctrl+K`(macOS는 Cmd, 또는 `Ctrl+Space` / `?`)에서 설정, 모드, 세션, 업그레이드를 찾습니다
- **Host setup** — `/host-setup`과 모든 OS의 바탕 화면 바로가기. Windows는 여유 있는 드라이브(약 100 GB)를 고를 수 있습니다. 홈 고정은 모든 OS에서 `SUPERLIORA_HOME` 또는 `--home`
- **언어** — 한국어 / English. `SUPERLIORA_LOCALE=ko|en`, Settings → Language, 또는 `/locale`

## 설치

**Node.js 24.15.0**이 필요합니다. 호스트에 없으면 한 줄 설치가 데이터 홈에 받습니다.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
# 홈 고정: SUPERLIORA_HOME=... 후 위 한 줄, 또는 받아서 install.sh --home ...

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
# C: 여유가 부족하면 Windows가 D:\SuperLiora 처럼 여유 드라이브를 고릅니다.
# 파이프된 irm | iex는 플래그를 무시합니다. 먼저 $env:SUPERLIORA_HOME을 두거나, 받아서 .\install.ps1 --home D:\SuperLiora

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

설치 후 바탕 화면의 SuperLiora를 더블클릭하면 TUI가 열립니다.

GitHub Release가 나오면 `liora upgrade`(또는 TUI의 `/upgrade`)로 설치를 갱신합니다. 추적은 공개 Release이고, `main` 최신을 쓰려면 `--main`입니다.

## 사용

```bash
liora                 # Conductor 인터랙티브 세션
liora --continue      # 현재 디렉터리 최근 세션 이어하기
liora --plan          # Plan Desk로 시작
```

TUI에서 `/login` · `/model`로 프로바이더를 연결합니다. 카탈로그 로그인에는 Groq, Mistral, Together, xAI API 키, Cerebras, Perplexity, Vercel AI Gateway가 있습니다. `/quota`(또는 Command Hub → Quota)로 실시간 남은 크레딧을 봅니다(푸터 칩은 활성 프로바이더). 터미널이 얇으면 `/host-setup`을 쓴 뒤 원하는 결과를 적으세요. Conductor가 Job을 만듭니다. `/jobs` 또는 `Alt+J`(Job Deck)로 보고, Inbox(`Alt+I`)에서 질문에 답하세요. Command Hub는 `Ctrl+K`(macOS는 Cmd)입니다.

## CLI

선택 정리:

```bash
liora upgrade         # 최신 GitHub Release로 갱신
liora doctor          # 설정 점검. --storage는 로컬 용량
liora gc              # 쉬는 로컬 저장소를 회수 (/job gc와는 다름)
```

## 문서 · 개발

- 사이트·가이드: https://claudianus.github.io/superliora/
- 기여: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
