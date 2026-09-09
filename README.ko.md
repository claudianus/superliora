# SuperLiora

**AI 코딩 에이전트를 터미널에서 돌리세요.** 원하는 결과를 적으면, SuperLiora가 프로젝트를 복사한 별도 공간에서 작업을 대신 처리합니다. 지금 작업 중인 파일은 건드리지 않습니다.

[라이브 사이트](https://claudianus.github.io/superliora/) · [English](./README.md) · [문서](https://claudianus.github.io/superliora/docs/getting-started.html)

## 무엇을 하나요

- **일일이 지시하지 않아도 됩니다** — 원하는 것을 말하듯 적으면, SuperLiora가 작업(Job)으로 만들어 대신 실행합니다
- **Job Deck · Inbox** — `Alt+J`로 진행 상황을 보고, `Alt+I`에서 질문에 답한 뒤, 테스트를 통과한 것만 로컬에 합칩니다
- **서버 · SDK · 에디터** — `liora server run`으로 엔진을 REST + WebSocket으로 띄우고, `@superliora/sdk`로 내 코드에서 쓰고, `liora acp`로 Zed·JetBrains 같은 에디터에 연결합니다
- **오류가 나도 멈추지 않습니다** — 모델이나 계정에 문제가 생기면 자동으로 재시도하고 다른 것으로 바꿉니다(타임아웃뿐 아니라 모든 서버 오류에). 작업이 중간에 죽지 않습니다
- **단축키는 하나만** — `Ctrl+K`(macOS는 Cmd, 또는 `Ctrl+Space` / `?`)로 설정, 모드, 세션, 업데이트를 한 검색창에서 찾습니다
- **간편한 터미널 설정** — `/host-setup`과 모든 OS의 바탕 화면 바로가기. Windows는 C: 드라이브 공간이 부족하면 여유 있는 드라이브(약 100 GB)를 고릅니다. 설치 위치는 모든 OS에서 `SUPERLIORA_HOME` 또는 `--home`으로 정합니다
- **한국어 / English** — `SUPERLIORA_LOCALE=ko|en`, Settings → Language, 또는 `/locale`로 전환합니다

## 설치

**Node.js 24.15.0**이 필요합니다. 컴퓨터에 없으면 한 줄 설치가 SuperLiora 전용 폴더에 받아 둡니다.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
# 설치 위치 정하기: SUPERLIORA_HOME=... 을 설정한 뒤 위 한 줄, 또는 받아서 install.sh --home ...

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
# C: 드라이브 공간이 부족하면 Windows가 D:\SuperLiora 같은 여유 드라이브를 고릅니다.
# 파이프한 irm | iex는 플래그를 무시합니다. 먼저 $env:SUPERLIORA_HOME을 설정하거나, 받아서 .\install.ps1 --home D:\SuperLiora

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

설치 후 바탕 화면의 SuperLiora를 더블클릭하면 실행됩니다.

새 버전이 나오면 `liora upgrade`(또는 앱 안에서 `/upgrade`)로 업데이트합니다. 공개된 릴리스를 따라가며, 작업 중인 최신 코드를 쓰려면 `--main`을 붙입니다.

## 사용

```bash
liora                 # 대화형 세션 열기
liora --continue      # 이 폴더의 최근 세션 이어하기
liora --plan          # Plan 모드로 큰 변경을 먼저 정리하고 시작
liora -p "원하는 결과"    # 전체 화면 없이 한 번만 실행
```

앱 안에서 `/login` · `/model`로 프로바이더를 연결합니다. 로그인 옵션에는 Groq, Mistral, Together, xAI API 키, Cerebras, Perplexity, Vercel AI Gateway가 있습니다. `/quota`(또는 Command Hub → Quota)로 남은 크레딧을 실시간으로 봅니다(화면 아래에 지금 쓰는 프로바이더가 표시됩니다). 터미널이 좁으면 `/host-setup`을 쓴 뒤 원하는 결과를 적으세요. SuperLiora가 작업을 만듭니다. `/jobs` 또는 `Alt+J`(Job Deck)로 보고, Inbox(`Alt+I`)에서 질문에 답하세요. Command Hub는 `Ctrl+K`(macOS는 Cmd)입니다.

## CLI

```bash
liora upgrade         # 최신 릴리스로 업데이트
liora doctor          # 설정 점검. --storage는 로컬 용량 확인
liora gc              # 쓰지 않는 로컬 저장소 정리 (/job gc와는 다름)
liora provider list   # 프로바이더·키·라우팅 목록
liora worktree gc     # 작업 폴더 정리 (list / rm / gc / hygiene)
liora export          # 버그 리포트용 세션 묶음 만들기
liora server run      # 에이전트 엔진을 REST + WebSocket으로 호스팅
liora acp             # 에디터에 에이전트 연결 (Agent Client Protocol)
```

## 문서 · 개발

- 사이트·가이드: https://claudianus.github.io/superliora/
- 기여: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
