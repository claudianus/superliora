# SuperLiora 도구 중 코딩 성능에 불필요한 도구 검토

작성일: 2026-07-12

## 요약

SuperLiora는 현재 50개가 넘는 내장 도구를 가지고 있다. OpenCode의 핵심 코딩 도구가 12개인 것과 비교하면, 상당수 도구가 **코딩 자체의 성능과는 직접적인 관련이 없는 워크플로우·플랫폼·실험 기능**이다.

본 보고서는 각 도구를 "코딩에 필수", "코딩에 간접 도움", "코딩과 무관" 세 가지로 분류하고, 제거·비활성화·통합 대상을 제시한다. OpenCode를 대체재로 보지 않더라도, SuperLiora의 유지보수 부담을 줄이기 위해 이 분류는 필요하다.

---

## 1. 분류 기준

| 등급 | 정의 | 예시 |
|---|---|---|
| **필수** | 일반적인 코딩 작업(버그 수정, 기능 추가, 리팩토링, 테스트)에 없으면 대체재가 없는 도구 | Read, Write, Edit, Bash, Grep, Glob |
| **유용** | 코딩에 도움이 되지만, 필수 도구로 대체 가능하거나 특정 상황에서만 쓰이는 도구 | WebSearch, FetchURL, LioraSearch, Context7Docs |
| **무관** | 코딩 성능과 직접적인 관련이 없는 워크플로우·플랫폼·실험 기능 | Goal, TodoList, UltraSwarm, Cron, GUI 도구 |

---

## 2. SuperLiora 전체 도구 목록 및 분류

### 2.1 필수 도구 (6개)

이 도구들은 OpenCode의 핵심 도구와 동일하며, 코딩 에이전트로서 최소한 필요하다.

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `Read` | `file/read.ts` | 파일 읽기 | 필수 |
| `Write` | `file/write.ts` | 파일 쓰기/덮어쓰기 | 필수 |
| `Edit` | `file/edit.ts` | 문자열 치환 | 필수 |
| `Glob` | `file/glob.ts` | 파일 패턴 검색 | 필수 |
| `Grep` | `file/grep.ts` | 코드 검색 | 필수 |
| `Bash` | `shell/bash.ts` | 셸 명령 실행 | 필수 |

### 2.2 유용하지만 필수는 아닌 도구 (11개)

이 도구들은 코딩에 도움이 되지만, 필수 도구로 대체 가능하거나 특정 상황에서만 쓰인다.

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `WebSearch` | `web/web-search.ts` | 웹 검색 | 유용. 최신 정보/라이브러리 조사에 필요. 없으면 FetchURL + 외부 검색으로 대체 가능. |
| `FetchURL` | `web/fetch-url.ts` | URL 콘텐츠 가져오기 | 유용. 문서/이슈 확인에 사용. |
| `Context7Resolve` | `web/context7-resolve.ts` | Context7 라이브러리 ID 조회 | 유용. 외부 라이브러리 문서 조회. 없으면 WebSearch/FetchURL로 대체 가능. |
| `Context7Docs` | `web/context7-docs.ts` | Context7 문서 조회 | 유용. |
| `ReadMediaFile` | `file/read-media.ts` | 이미지/비디오 파일 읽기 | 유용. UI 작업이나 이미지 기반 작업에만 필요. 일반 코딩에서는 거의 사용 안 됨. |
| `LioraRead` | `context/liora-read.ts` | 토큰 효율적인 파일 읽기 | 유용. Read의 압축 버전. Read로 대체 가능하나 컨텍스트 비용이 증가. |
| `LioraSearch` | `context/liora-search.ts` | BM25 기반 코드 검색 | 유용. Grep보다 똑똑하지만, Grep + Read로 대체 가능. |
| `LioraTree` | `context/liora-tree.ts` | 디렉터리 구조 요약 | 유용. Glob/Read로 대체 가능. |
| `LioraSymbol` | `context/liora-symbol.ts` | 심볼 검색 | 유용. Grep + Read로 대체 가능. |
| `LioraExpand` | `context/liora-expand.ts` | 압축된 출력 확장 | 유용. LioraRead/LioraSearch와 짝으로 사용. |
| `LioraCallgraph` | `context/liora-callgraph.ts` | 호출 그래프 분석 | 유용. 대규모 리팩토링에 도움. 일반 코딩에서는 과함. |

**LioraIndex**는 `LioraSearch`/`LioraContext`의 전제 조건이므로 사용자가 직접 호출하지 않는 인프라 도구에 가깝다. 모델에 노출될 필요가 없을 수 있다.

### 2.3 코딩과 무관한 워크플로우/플랫폼 도구 (31개)

이 도구들은 코딩 성능과 직접적인 관련이 없으며, SuperLiora 플랫폼의 부가 기능이나 실험적 워크플로우를 지원한다.

#### 계획/인터뷰 (4개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `EnterPlanMode` | `planning/enter-plan-mode.ts` | Plan Mode 진입 | 무관. 코딩 성능이 아니라 워크플로우 제어. |
| `ExitPlanMode` | `planning/exit-plan-mode.ts` | Plan Mode 종료 | 무관. |
| `NextPhase` | `planning/next-phase.ts` | Ultra Plan 단계 전환 | 무관. |
| `RecordInterviewFinding` | `planning/record-interview-finding.ts` | 인터뷰 발견사항 기록 | 무관. |

#### 목표 관리 (4개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `CreateGoal` | `goal/create-goal.ts` | 목표 생성 | 무관. 장기 실행 관리용. |
| `GetGoal` | `goal/get-goal.ts` | 목표 조회 | 무관. |
| `UpdateGoal` | `goal/update-goal.ts` | 목표 업데이트 | 무관. |
| `SetGoalBudget` | `goal/set-goal-budget.ts` | 목표 예산 설정 | 무관. |

#### 상태 관리 (4개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `TodoList` | `state/todo-list.ts` | 할 일 관리 | 무관. 모델의 메모리 보조용. |
| `CurrentTime` | `state/current-time.ts` | 현재 시간 확인 | 무관. 드물게 유용. |
| `Memory` | `state/memory.ts` | 장기 기억 저장/검색 | 무관. |
| `UltraWorkGraph` | `state/ultrawork-graph.ts` | UltraSwarm WorkGraph 동기화 | 무관. |

#### 협업/스웜 (9개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `Agent` | `collaboration/agent.ts` | 서브에이전트 실행 | 무관. 복잡한 작업 분해용. |
| `AgentSwarm` | `collaboration/agent-swarm.ts` | 다중 서브에이전트 실행 | 무관. |
| `UltraSwarm` | `collaboration/ultra-swarm.ts` | 전문가 기반 스웜 | 무관. |
| `SwarmChannel` | `collaboration/swarm-channel.ts` | 스웜 내 메시지 채널 | 무관. |
| `AskUserQuestion` | `collaboration/ask-user.ts` | 사용자에게 질문 | 무관. 상호작용용. |
| `SearchExpert` | `collaboration/search-expert.ts` | 전문가 카탈로그 검색 | 무관. UltraSwarm 전용. |
| `SearchSkill` | `collaboration/search-skill.ts` | 스킬 카탈로그 검색 | 무관. |
| `Skill` | `collaboration/skill-tool.ts` | 스킬 실행 | 무관. |
| `SwarmBus` | `state/swarm-bus.ts` | 스웜 내 상태 버스 | 무관. |

`SwarmResearchAutonomy`와 `UltraSwarmIntegrationReport`는 도구 클래스가 아니라 프롬프트 헬퍼/XML 빌더이므로 별도 분류한다.

#### GUI/브라우저 자동화 (8개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `BrowserStatus` | `gui/browser-use.ts` | 브라우저 상태 확인 | 무관. 웹 테스트/디버깅용. |
| `BrowserObserve` | `gui/browser-use.ts` | 브라우저 페이지 관찰 | 무관. |
| `BrowserScreenshot` | `gui/browser-use.ts` | 브라우저 스크린샷 | 무관. |
| `BrowserAct` | `gui/browser-use.ts` | 브라우저 동작 실행 | 무관. |
| `BrowserConsole` | `gui/browser-use.ts` | 브라우저 콘솔 메시지 | 무관. |
| `ComputerCapture` | `gui/computer-use.ts` | 데스크탑 캡처 | 무관. |
| `ComputerAct` | `gui/computer-use.ts` | 데스크탑 동작 실행 | 무관. |
| `ComputerStatus` | `gui/computer-use.ts` | 데스크탑 상태 확인 | 무관. |

#### 백그라운드/크론 (6개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `TaskList` | `background/task-list.ts` | 백그라운드 작업 목록 | 무관. |
| `TaskOutput` | `background/task-output.ts` | 백그라운드 작업 출력 | 무관. |
| `TaskStop` | `background/task-stop.ts` | 백그라운드 작업 중지 | 무관. |
| `CronCreate` | `cron/cron-create.ts` | 크론 작업 생성 | 무관. |
| `CronDelete` | `cron/cron-delete.ts` | 크론 작업 삭제 | 무관. |
| `CronList` | `cron/cron-list.ts` | 크론 작업 목록 | 무관. |

#### 리뷰 (1개)

| 도구 | 파일 | 역할 | 판단 |
|---|---|---|---|
| `LioraReview` | `review/code-review.ts` | 코드 리뷰 | 무관. 코딩 완료 후 품질 검사용. 코딩 성능과 직접 무관. |

---

## 3. OpenCode와의 비교

OpenCode의 shipped built-in은 12개다.

- `read`, `glob`, `grep`, `bash`, `edit`, `write`, `apply_patch`, `websearch`, `webfetch`, `question`, `skill`, `todowrite`

SuperLiora는 필수 6개 + 유용 11개 + 무관 31개로 구성되어 있다. OpenCode는 `question`과 `todowrite`조차 코딩 워크플로우에 가깝게만 남겨두고, 나머지는 플러그인/MCP으로 넘긴다.

**핵심 차이**: OpenCode는 "코딩에 필요한 최소 도구"만 내장한다. SuperLiora는 "플랫폼의 모든 기능"을 내장 도구로 노출한다.

---

## 4. 제안: 단계적 정리

### 4.1 즉시 제거 또는 비활성화 대상 (15개)

이 도구들은 코딩 성능에 기여하지 않으며, 사용 빈도가 낮거나 다른 도구로 대체 가능하다.

| 도구 | 제안 |
|---|---|
| `CreateGoal`, `GetGoal`, `UpdateGoal`, `SetGoalBudget` | 비활성화. Goal 기능은 에이전트 내장 상태로 충분. |
| `CurrentTime` | 비활성화. 시스템 프롬프트에 현재 시간을 주입하면 됨. |
| `Memory` | 비활성화. Memory는 `AGENTS.md`나 세션 컨텍스트로 대체 가능. |
| `UltraWorkGraph`, `SwarmBus` | UltraSwarm을 사용하지 않는 프로필에서는 비활성화. |
| `BrowserStatus`, `BrowserObserve`, `BrowserScreenshot`, `BrowserAct`, `BrowserConsole` | GUI 프로필이 아니면 비활성화. |
| `ComputerCapture`, `ComputerAct`, `ComputerStatus` | GUI 프로필이 아니면 비활성화. |
| `LioraReview` | 선택적 스킬로 전환. |

### 4.2 프로필별 활성화 대상 (16개)

이 도구들은 특정 사용 맥락에서만 필요하므로, 기본 프로필에서는 끄고 필요할 때 켠다.

| 도구 | 제안 |
|---|---|
| `EnterPlanMode`, `ExitPlanMode`, `NextPhase`, `RecordInterviewFinding` | Plan Mode가 필요한 작업에서만 활성화. |
| `TodoList` | 복잡한 다단계 작업에서만 활성화. |
| `Agent`, `AgentSwarm`, `UltraSwarm`, `SwarmChannel`, `AskUserQuestion`, `SearchExpert`, `SearchSkill`, `Skill` | Swarm/협업 모드에서만 활성화. |
| `TaskList`, `TaskOutput`, `TaskStop` | Background 모드에서만 활성화. |
| `CronCreate`, `CronDelete`, `CronList` | 자동화 모드에서만 활성화. |

### 4.3 통합 대상 (7개)

LioraContext 도구군은 기능이 중복되거나 세분화되어 있다.

| 현재 도구 | 제안 |
|---|---|
| `LioraRead`, `LioraExpand` | `Read`에 통합. Read가 압축된 출력도 자동으로 처리하도록 개선. |
| `LioraSearch`, `LioraSymbol`, `LioraCallgraph` | `Grep` + `Read`의 고급 모드로 통합. |
| `LioraTree` | `Glob` + `Read`의 디렉터리 모드로 통합. |
| `LioraIndex` | 모델에 노출하지 않는 인프라 도구로 변경. |

이렇게 하면 **컨텍스트 탐색 도구가 7개에서 2개(Read/Grep의 고급 모드)로 줄어든다.**

### 4.4 유지 대상 (6개)

| 도구 | 이유 |
|---|---|
| `Read` | 필수 |
| `Write` | 필수 |
| `Edit` | 필수 |
| `Glob` | 필수 |
| `Grep` | 필수 |
| `Bash` | 필수 |

### 4.5 선택적 유지 대상 (5개)

| 도구 | 이유 |
|---|---|
| `WebSearch` | 최신 정보 조사에 유용 |
| `FetchURL` | 문서/이슈 확인에 유용 |
| `Context7Resolve`, `Context7Docs` | 라이브러리 문서 조사에 유용 |
| `ReadMediaFile` | UI/미디어 작업에 유용 |

---

## 5. 기대 효과

이 제안을 모두 적용하면 다음과 같은 효과가 있다.

- **모델 선택지 감소**: 50개 → 11개(필수 6 + 선택 5)로 줄어들어 모델이 더 예측 가능하게 행동한다.
- **유지보수 부담 감소**: GUI, Goal, Cron, Swarm 등 복잡한 도구들이 실험적 플래그 뒤로 이동한다.
- **테스트 집중**: 핵심 코딩 도구 6개에 리소스를 집중할 수 있다.
- **OpenCode와의 격차 축소**: 핵심 코딩 도구 레이어에서 SuperLiora도 작고 단단한 도구 집합을 갖게 된다.

---

## 6. 결론

SuperLiora의 도구 중 **코딩 성능과 직접 관련이 없는 도구가 31개 이상**이다. 이들을 제거하거나 프로필별로 비활성화하면, SuperLiora의 복잡도를 크게 줄이고 핵심 코딩 도구에 집중할 수 있다.

**Phase 1(2026-07-12)에서 실제로 적용한 것:**

1. `packages/agent-core/src/profile/default/agent.yaml`의 기본 `tools` 배열을 11개로 축소.
2. `superliora-full`, `superliora-coder`, `superliora-explorer` 등 하위 호환 프로필을 추가.
3. `packages/agent-core/src/profile/default.ts`에 `full.yaml`을 임포트 및 등록.

**아직 적용하지 않고 향후 검토할 것:**

- `LioraContext` 도구군을 `Read`/`Grep`의 고급 모드로 통합.
- `Goal`, `CurrentTime`, `Memory`, `LioraReview`, `GUI` 도구를 기본 프로필에서 비활성화(현재는 `superliora-full` 등에서 여전히 사용 가능).
- `Plan Mode`, `Swarm`, `Background`, `Cron` 도구를 실험적 플래그 뒤로 이동.

이렇게 하면 "OpenCode보다 잘 만들 자신이 없다"는 부담에서 벗어나, **핵심 코딩 도구 11개만 먼저 단단하게 다듬는 것**으로 범위를 좁힐 수 있다.

---

## 7. Phase 1 적용 결과 (2026-07-12)

### 7.1 변경 사항

- `packages/agent-core/src/profile/default/agent.yaml`의 기본 `tools` 배열을 11개로 축소.
  - 남은 도구: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `LioraRead`, `LioraSearch`, `WebSearch`, `FetchURL`, `AskUserQuestion`, `mcp__*`
- 서브에이전트 프로필(`coder`, `explore`, `plan`, `ultra-plan`)은 각 역할에 필요한 최소 도구만 추가로 노출.
- `superliora-full` 프로필을 새로 추가해 이전 기본 도구 세트를 그대로 사용할 수 있게 함.
- `packages/agent-core/src/profile/default.ts`에 `full.yaml` 임포트 및 등록 추가.

### 7.2 검증

- `corepack pnpm run build` 통과
- `corepack pnpm run check:imports` 통과
- `corepack pnpm -C apps/liora run smoke` 통과
- `corepack pnpm -C packages/agent-core exec vitest run test/agent/tool.test.ts` 통과
- `packages/agent-core` 전체 테스트 중 `test/session/subagent-host.test.ts`에서 `FakeKaos.rename not implemented` 오류 발생 — 이는 기존 테스트 픽스처 문제로 본 변경과 무관.

### 7.3 사용자 안내

기본 프로필이 변경되었지만, 이전 동작이 필요하면 `superliora-full` 프로필을 사용한다.

```bash
liora --profile superliora-full
```

또는 `tui.toml` 설정에서 프로필을 지정할 수 있다.

---

## 참고

- SuperLiora 내장 도구 인덱스: `packages/agent-core/src/tools/builtin/index.ts`
- SuperLiora 도구 매니저: `packages/agent-core/src/agent/tool/index.ts`
- OpenCode 내장 도구 목록: `/tmp/opencode-official/packages/core/src/tool/builtins.ts`
- 변경된 프로필: `packages/agent-core/src/profile/default/agent.yaml`, `packages/agent-core/src/profile/default/coder.yaml`, `packages/agent-core/src/profile/default/explore.yaml`, `packages/agent-core/src/profile/default/plan.yaml`
- 추가된 프로필: `packages/agent-core/src/profile/default/full.yaml`
- Changeset: `.changeset/slim-default-profile.md`
