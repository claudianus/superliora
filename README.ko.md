# SuperLiora

**AI 코딩 에이전트를 터미널에서 돌리세요.** 원하는 결과를 적으면 SuperLiora가 Bash와 SessionControl로 자율 실행합니다. 일반 요청은 현재 작업 공간에서 바로 실행됩니다. 격리가 필요하면 네이티브 Job이나 명시적 worktree를 선택하세요.

[라이브 사이트](https://claudianus.github.io/superliora/) · [English](./README.md) · [문서](https://claudianus.github.io/superliora/docs/getting-started.html)

## 무엇을 하나요

- **직접 자율 실행** — 모델은 Bash로 프로젝트를 읽고 수정하며, SessionControl로 워커 세션을 생성·목록 조회·메시지 전달·대기·중지·압축합니다
- **실시간 워커 · Job Deck · Inbox** — 실행 중인 작업을 보고, `Alt+J`로 네이티브 Job을, `Alt+I`로 질문을 확인합니다. 변경 사항을 직접 검토한 뒤 land하거나 push하세요
- **서버 · SDK · 에디터** — `liora server run`으로 엔진을 REST + WebSocket으로 띄우고, `@superliora/sdk`로 내 코드에서 쓰고, `liora acp`로 Zed·JetBrains 같은 에디터에 연결합니다
- **지속되는 세션** — 대화·저널·리플레이로 실행 기록을 보존하되 셸 효과를 다시 실행하지 않습니다. 명시적 전체 압축은 최신 실제 사용자 요청을 보존합니다
- **설정 단축키** — `Ctrl+K`(macOS는 Cmd, 또는 `Ctrl+Space` / `?`)로 설정, 세션, 업데이트를 한 검색창에서 찾습니다
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
liora -p "원하는 결과"    # 전체 화면 없이 한 번만 실행
```

앱 안에서 `/login` · `/model`로 프로바이더를 연결하고 모델을 선택합니다. `/quota`(또는 Command Hub → Quota)는 지원되는 프로바이더의 남은 크레딧을 실시간으로 표시합니다. 터미널이 좁으면 `/host-setup`을 쓴 뒤 원하는 결과를 적으세요. 요청은 현재 작업 공간에서 실행되며 워커 세션도 자동 격리되지 않습니다. 명시적 네이티브 Job과 Kanban·worktree 제어는 `/jobs` 또는 `Alt+J`에서, 질문은 Inbox(`Alt+I`)에서 확인하세요. 검토·land·push는 운영자가 결정합니다.

## CLI

```bash
liora upgrade         # 최신 릴리스로 업데이트
liora doctor          # 설정 점검. --storage는 로컬 용량 확인
liora gc              # 쓰지 않는 로컬 저장소 정리 (/job gc와는 다름)
liora provider list   # 설정된 프로바이더·인증 정보 목록
liora worktree gc     # 작업 폴더 정리 (list / rm / gc / hygiene)
liora export          # 버그 리포트용 세션 묶음 만들기
liora server run      # 에이전트 엔진을 REST + WebSocket으로 호스팅
liora acp             # 에디터에 에이전트 연결 (Agent Client Protocol)
```

## 메이저 마이그레이션

최소 하네스는 모델에 **Bash**와 **SessionControl**만 제공합니다. 계획·목표·메모리·스킬·플러그인·MCP·인지 카탈로그·역할 및 페르소나 라우팅은 제거됩니다. 자동 워커·전체 턴·루프 단계 재시도, 엄격한 재전송, 효과 재실행, 강제 검증·리뷰 파이프라인도 제거됩니다. 요청 완료가 테스트 통과를 뜻하지는 않습니다. 운영자가 설정하는 네이티브 프로바이더 경로와 출력 전 fallback 처리는 유지되지만 작업 시작 후 복구를 보장하지는 않습니다.

네이티브 프로바이더·인증 설정, 승인, 세션, 지속되는 aside 분기, 프로세스 취소, Job, Kanban, 명시적 worktree는 유지됩니다. 실패한 네이티브 Job의 정리 소유권은 명시적으로 정리할 때까지 유지되며, 정리 과정에서 효과를 다시 실행하지 않습니다.

제거된 키나 섹션이 있는 기존 설정은 자동 변환하지 않고 거부합니다. 설정 오류가 지목하는 키와 섹션을 직접 삭제하세요. `[research]`와 `[loop_control].max_retries_per_step`이 있다면 삭제 대상입니다. 거부되는 필드는 [제거된 필드 검증](./packages/agent-core/src/config/toml-transform.ts)에 정의되어 있습니다. SuperLiora는 홈 설정을 다시 쓰지 않습니다.

## 문서 · 개발

- 사이트·가이드: https://claudianus.github.io/superliora/
- 기여: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
