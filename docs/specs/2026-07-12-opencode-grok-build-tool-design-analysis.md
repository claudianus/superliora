# OpenCode · Grok Build 도구 설계 철학 분석 및 SuperLiora 적용 방안

작성일: 2026-07-12

## 요약

OpenCode와 Grok Build는 모두 터미널 중심의 AI 코딩 에이전트지만, 도구를 바라보는 철학이 다르다. OpenCode는 **Effect-TS 기반의 작은 Location-scoped 함수 조합**을 중시하며, 하나의 툴은 입력 스키마·출력 스키마·실행 Effect·모델 출력 변환으로 이루어진다. Grok Build는 **계획(Plan) → 탐색(Search) → 빌드(Build)라는 3단계 워크플로우와 병렬 서브에이전트**를 도구 사용의 중심에 두며, Plan Mode와 Arena Mode로 사람의 검토 지점을 명시적으로 설계한다.

SuperLiora는 두 철학 사이에 있다. OpenCode처럼 **도구를 클래스 단위로 캡슐화**하고 있으며, Grok Build처럼 **Plan Mode(EnterPlanMode/ExitPlanMode/NextPhase), TodoList, Goal, UltraSwarm** 같은 상위 워크플로우 도구를 별도 레이어로 갖추고 있다. 본 보고서는 두 제품의 설계를 비교하고, SuperLiora가 받을 수 있는 구체적인 개선안을 제시한다.

---

## 1. OpenCode의 도구 설계 철학

### 1.1 아키텍처: Effect-TS 기반 Location-scoped DI

OpenCode V2는 모든 부작용을 Effect-TS Effect로 표현한다. 도구 하나는 `packages/core/src/tool/tool.ts`에 정의된 `Tool.make`로 만들어진다.

```ts
// packages/core/src/tool/tool.ts
export interface Config<Input, Output, Structured> {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly structured?: Structured
  readonly execute: (
    input: Schema.Schema.Type<Input>,
    context: Context,
  ) => Effect.Effect<Schema.Schema.Type<Output>, ToolFailure>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}
```

핵심 특징은 다음과 같다.

- **도구 = 입력 스키마 + 출력 스키마 + 실행 Effect + 모델 출력 변환**. 입력/출력 모두 Effect Schema로 기술되며, JSON Schema 변환도 자동화된다.
- **Location-scoped**. 각 도구는 `makeLocationNode`로 자신이 의존하는 서비스(`PermissionV2`, `FileMutation`, `LocationMutation` 등)를 선언한다. 여러 Location이 공존할 때 도구의 유효 범위가 명확하다.
- **서비스 등록은 Context.Service**. `Tools.Service.register({ name: tool })` 형태로 Location 안에서 도구를 등록한다. Application-scoped 도구는 별도 `ApplicationTools.Service`가 관리한다.

이 설계는 부작용 트래킱, 테스트, 권한 검사, 출력 바울드 처리를 Effect의 파이프라인 안에서 자연스럽게 연결한다.

### 1.2 내장 도구 세트

OpenCode의 shipped built-in은 `packages/core/src/tool/builtins.ts`에 명시되어 있다.

- `read` — 파일/디렉터리 읽기
- `glob` — 파일 패턴 검색
- `grep` — 코드 검색
- `bash` — 셸 명령
- `edit` — 정확한 문자열 치환
- `write` — 파일 쓰기/덮어쓰기
- `apply_patch` — Add/Update/Delete를 담은 패치 적용
- `websearch` — Exa/Parallel 기반 웹 검색
- `webfetch` — URL 콘텐츠 가져오기
- `question` — 사용자에게 질문
- `skill` — 스킬 로드
- `todowrite` — 할 일 기록

도구 개수가 적다. OpenCode는 "에이전트가 할 수 있는 행동의 종류를 제한하고, 각 도구를 예측 가능하게 유지"하는 쪽을 택했다. 예를 들어 `edit`은 **exact match만** 허용하며, fuzzy 매칭은 TODO로 남겨두었다(`packages/core/src/tool/edit.ts:84`).

### 1.3 도구 등록 메커니즘

등록은 두 계층으로 나뉜다.

1. **Location-scoped built-in**: `Tools.Service.register(...)`로 현재 Location에만 유효한 도구를 등록한다.
2. **Application-scoped**: `ApplicationTools.Service.register(...)`로 프로세스 전체에서 공유되는 도구(MCP, 플러그인 등)를 등록한다.

`ToolRegistry`는 등록된 도구를 materialize할 때 permission ruleset으로 필터링한다(`packages/core/src/tool/registry.ts:106`). 완전히 deny된 도구는 definitions에서 제외된다.

### 1.4 프롬프트 설계 철학

OpenCode의 시스템 프롬프트(`packages/opencode/src/session/prompt/default.txt`)는 다음을 강조한다.

- **간결함**: 4줄 이상 쓰지 말라. 불필요한 전제/후기 문장 금지.
- **툴로 행동**: 모든 작업은 도구로 수행. Bash/코드 주석으로 사용자와 대화하지 말 것.
- **코드 컨벤션 존중**: 기존 파일/컴포넌트를 먼저 보고 그 스타일을 따를 것.
- **불필요한 주석 금지**: "DO NOT ADD ***ANY*** COMMENTS unless asked"
- **병렬 툴 호출 권장**: 독립적인 정보 요청은 한 번에 묶아서 호출.
- **코드 참조 형식**: `file_path:line_number`로 구체적 위치를 언급.

Plan Mode용 프롬프트(`packages/opencode/src/session/prompt/plan.txt`)는 더 단순하다. 핵심은 "READ-ONLY phase" — Plan Mode에서는 어떤 파일도 수정하지 말고, 탐색/분석/질문만으로 계획을 세우라는 절대 금지 조항이다.

### 1.5 파일 편집 철학

OpenCode는 파일 변경에 매우 보수적이다.

- `edit`: exact match만 허용. `oldString`이 고유하지 않으면 실패. CRLF/BOM을 보존.
- `write`: 덮어쓰기 전 반드시 `Read`로 파일을 읽도록 강제(프롬프트 + 구현 모두).
- `apply_patch`: Add/Update/Delete 연산을 하나의 패치로 묶어 순차 적용. 일부 실패하면 앞선 연산은 그대로 남고 실패 지점을 보고.

권한 체크도 도구 실행 전에 `PermissionV2.assert`로 명시적으로 수행한다. 외부 디렉터리 접근은 별도 `external_directory` 승인이 필요하다.

---

## 2. Grok Build의 agent tool use philosophy

Grok Build는 2026년 5월 xAI가 공개한 터미널 기반 코딩 에이전트 CLI다. 소스는 비공개이므로 공식 문서와 리뷰를 기반으로 분석했다.

### 2.1 Plan-first execution

Grok Build의 가장 큰 설계 선택은 "먼저 계획을 세우고, 사람이 승인한 후 실행"하는 것이다.

- **Plan Mode**: 복잡한 작업에서 먼저 단계별 계획을 제시. 사용자는 전체 승인, 개별 코멘트, 재작성 가능.
- **Clean diff**: 승인된 계획은 최종적으로 깔끔한 diff로 변환되어 사람이 한 번 더 검토.

이는 기존 에이전트의 전형적인 실패 모드("23번째 단계에서 갑자기 잘못된 파일 수정")를 방지하려는 설계다.

### 2.2 Parallel sub-agents

Grok Build는 최대 8개의 서브에이전트를 병렬로 실행한다.

- 각 서브에이전트는 별도 Git worktree와 브랜치에서 작업.
- 하나의 작업(인증 플로우 재작성, 테스트 업데이트, 스키마 마이그레이션)을 동시에 분할 처리.
- 오케스트레이터 에이전트가 결과를 통합.

이 방식은 5만 줄 이상의 코드베이스나 대규모 마이그레이션에서 유리하다. 작은 작업에서는 오히려 조정 비용이 발생할 수 있다.

### 2.3 Arena Mode

Grok Build는 동일한 작업에 대해 여러 접근법을 동시에 생성하고, 자동 평가 레이어가 이를 점수화·랭킹한다. 개발자는 직접 여러 솔루션을 비교하지 않고 랭킹된 목록을 받는다.

### 2.4 Local-first / MCP / ACP

- **Local-first**: 세션 중 소스 코드를 xAI 서버로 전송하지 않는다.
- **MCP 호환**: Claude Code용 MCP 서버를 그대로 사용할 수 있다.
- **ACP 지원**: Agent Client Protocol로 서드파티 애플리케이션에서 Grok Build를 호출할 수 있다.

### 2.5 Headless / TUI duality

Grok Build는 풀스크린 마우스 인터랙티브 TUI와 `grok build -p` 같은 headless 스크립팅 모드를 동시에 제공한다. CI-style 자동화도 동일한 CLI로 처리한다.

---

## 3. SuperLiora의 현재 도구 설계

### 3.1 아키텍처

SuperLiora는 OpenCode와 비슷하게 **클래스 기반 도구 캡슐화**를 사용한다. 핵심 인터페이스는 `packages/agent-core/src/agent/tool/types.ts`에 정의되어 있다.

```ts
export type BuiltinTool<Input = unknown> = ExecutableTool<Input>;

export interface ExecutableTool<Input = unknown> extends Tool {
  resolveExecution(input: Input): ToolExecution | Promise<ToolExecution>;
}
```

`ToolExecution`은 `accesses`, `approvalRule`, `matchesRule`, `execute` 등으로 구성되며, 도구 호출 전 권한/규칙 매칭이 먼저 이루어진다(`packages/agent-core/src/loop/types.ts:129`).

### 3.2 내장 도구 세트

`packages/agent-core/src/tools/builtin/index.ts`에 선언된 도구들은 기능별로 디렉터리가 나뉘어 있다.

- **file**: Read, Write, Edit, Glob, Grep, ReadMedia
- **shell**: Bash
- **web**: WebSearch, FetchURL, Context7Resolve, Context7Docs
- **context**: LioraContext, LioraRead, LioraSearch, LioraSymbol, LioraTree, LioraExpand, LioraIndex, LioraCallgraph
- **planning**: EnterPlanMode, ExitPlanMode, NextPhase, RecordInterviewFinding
- **state**: TodoList, CurrentTime, Memory
- **goal**: CreateGoal, GetGoal, UpdateGoal, SetGoalBudget
- **collaboration**: Agent, AgentSwarm, UltraSwarm, SwarmChannel, AskUser, SearchExpert, SearchSkill, SkillTool
- **gui**: BrowserUse, ComputerUse
- **review**: CodeReview
- **background**: TaskList, TaskOutput, TaskStop
- **cron**: CronCreate, CronDelete, CronList

SuperLiora는 OpenCode보다 도구 종류가 훨씬 많다. 특히 **컨텍스트 탐색(LioraContext 등), 계획(Plan Mode), 협업(Agent/Swarm), GUI 사용(Browser/Computer), 크론 스케줄링**까지 별도 도구로 분리했다.

### 3.3 도구 등록 및 권한

`ToolManager`(`packages/agent-core/src/agent/tool/index.ts`)에서 에이전트 생성 시 내장 도구를 인스턴스화한다.

```ts
// packages/agent-core/src/agent/tool/index.ts:549
return [
  new b.ReadTool(kaos, workspace),
  new b.WriteTool(kaos, workspace),
  new b.EditTool(kaos, workspace),
  ...
]
```

권한은 다음과 같은 방식으로 처리된다.

- `approvalRule`: 도구 호출 시 사용자 승인을 받아야 하는 규칙 문자열.
- `matchesRule`: 프로필의 권한 규칙과 매칭되는지 판단.
- `readOnly`: 읽기 전용 도구로 표시해 Plan Mode 같은 제한 단계에서 허용.
- MCP 도구는 `McpConnectionManager`에서 동적으로 등록.

### 3.4 프롬프트/명령 체계

SuperLiora는 OpenCode와 달리 단일 시스템 프롬프트보다는 **도구별 `.md` 설명 템플릿**과 **스킬(Skill)** 체계를 중심으로 모델을 제어한다.

- `ReadTool`의 `read.md`, `EditTool`의 `edit.md` 등 각 도구는 마크다운 설명을 갖는다.
- `Skill`은 특정 작업(커밋, changeset 생성, TUI 작성 등)을 위한 추가 지침을 동적으로 로드.
- `AGENTS.md`로 프로젝트별 규칙을 주입.

SuperLiora의 Plan Mode는 OpenCode보다 더 정형화되어 있다. `EnterPlanMode`, `ExitPlanMode`, `NextPhase`라는 별도 도구로 **Ultra Plan** 워크플로우(Research → Interview → Design → Review → Write → Exit)를 강제한다.

---

## 4. 비교 분석

| 영역 | OpenCode | Grok Build | SuperLiora |
|---|---|---|---|
| **도구 패러다임** | Effect-TS Schema 기반 작은 함수 | 모델 중심 Plan/Search/Build 워크플로우 | 클래스 기반 실행 + 권한/표시 분리 |
| **도구 개수** | 적음(핵심 12개) | 미공개, 추정 적음 | 많음(40개 이상) |
| **파일 수정 철학** | exact match, 보수적 | Plan 승인 후 diff 기반 | exact match + Plan Mode + background/cron |
| **병렬 처리** | 개별 툴 호출 병렬만 지원 | 8개 서브에이전트 병렬 | AgentSwarm/UltraSwarm으로 협업 에이전트 |
| **계획 모드** | Plan Mode는 READ-ONLY 제한 | Plan Mode가 핵심 워크플로우 | Ultra Plan(6단계)이 별도 도구로 존재 |
| **외부 확장** | ApplicationTools, MCP | MCP, ACP, plugins, skills | MCP + Skill + Expert catalog |
| **로컬 우선** | 기본적으로 로컬 | Local-first을 강조 | 기본적으로 로컬(Kaos 추상화) |
| **헤드리스/자동화** | CLI 중심 | `-p` 헤드리스 모드 | Cron, Background task, Goal, TUI |

### 핵심 차이점

1. **OpenCode는 "도구를 작게" 유지한다**. OpenCode는 도구의 수를 의도적으로 줄이고, 각 도구의 동작을 예측 가능하게 만든다. SuperLiora는 기능별로 도구를 세분화해 더 풍부한 워크플로우를 지원하지만, 모델이 선택할 도구가 많아진다.

2. **Grok Build는 "워크플로우를 강제"한다**. Plan Mode가 단순한 옵션이 아니라 핵심 사용 흐름이다. SuperLiora도 Plan Mode가 있지만, 아직 OpenCode처럼 READ-ONLY 절대 금지 조항을 강하게 내걸지는 않는다.

3. **SuperLiora는 LioraContext 도구군이 독립적이다**. OpenCode는 `read`/`glob`/`grep`으로 파일 시스템을 탐색하지만, SuperLiora는 `LioraContext`, `LioraSearch`, `LioraRead` 같은 **요약/검색/읽기** 도구를 별도로 두어 컨텍스트 비용을 관리한다.

4. **Grok Build의 Arena Mode는 SuperLiora에 없는 개념**이다. 여러 접근법을 경쟁시키는 메타도구는 UltraSwarm을 확장하면 구현 가능하다.

---

## 5. SuperLiora 적용 방안

### 5.1 단기 적용(바로 할 수 있는 것)

#### A. Plan Mode의 READ-ONLY 강화

OpenCode의 `plan.txt`처럼 Plan Mode(특히 Ultra Plan의 research/interview/design 단계)에서 **파일 수정 도구(Edit/Write/Bash 등)를 하드 블록**하는 규칙을 추가한다.

- `EnterPlanMode` 호출 시 `readOnly=false`인 도구를 일시적으로 비활성화.
- Plan Mode 중 `Edit`/`Write`/`Bash` 호출은 즉시 거부하고 "Plan Mode에서는 읽기/검색만 가능"이라고 모델에 알린다.

#### B. 도구 설명 템플릿 표준화

OpenCode는 각 도구에 `.txt` 프롬프트를 붙인다. SuperLiora는 이미 `.md` 템플릿을 사용하지만, 다음을 추가하면 좋다.

- `Read` 전에 `Edit`/`Write`를 하려면 `Read`로 파일을 읽어야 한다는 규칙을 `edit.md`/`write.md`에 강조.
- `Bash`는 파일 조작이 아니라 명령 실행용이라는 구분을 `bash.md`에 명시(OpenCode `shell.txt`와 동일한 원칙).

#### C. Edit/Write의 exact-match 강화

OpenCode의 `edit`은 exact match 실패 시 명확한 메시지를 반환한다. SuperLiora의 `EditTool`도 이미 exact match를 사용하지만, 메시지에 `file_path:line_number` 형식의 참조를 포함해 모델이 다시 읽도록 유도할 수 있다.

### 5.2 중기 적용(구조적 개선)

#### A. 도구 등록 레이어 분리

OpenCode의 `Tools.Service`(Location-scoped)와 `ApplicationTools.Service`(process-scoped)처럼, SuperLiora도 내장 도구 등록을 두 단계로 나누자.

- **Core tools**: 모든 에이전트가 가지는 공통 도구(Read/Write/Edit/Bash/WebSearch).
- **Session-scoped tools**: 특정 세션/프로필에서만 활성화되는 도구(GUI, Cron, Background, Swarm).

이렇게 하면 MCP/Skill 도구가 내장 도구와 충돌할 때 우선순위를 명확히 정할 수 있다.

#### B. apply_patch 스타일의 일괄 파일 작업 도구

OpenCode의 `apply_patch`처럼 **Add/Update/Delete를 하나의 패치로 묶는 도구**를 추가한다.

- 현재 SuperLiora는 `Write`/`Edit`/`Bash rm` 등을 따로 호출해야 한다.
- 하나의 `ApplyPatch` 도구로 묶으면 권한 승인도 한 번에 받을 수 있고, 모델의 토큰 사용도 줄어든다.

#### C. Plan Mode용 탐색 에이전트 분리

Grok Build의 Plan Mode와 OpenCode의 plan 프롬프트는 "탐색만 하고 수정은 하지 않는 에이전트"를 내재한다. SuperLiora는 이를 명시적으로 분리할 수 있다.

- `ExploreAgent`: read-only 도구만 사용하는 서브에이전트.
- `ImplementAgent`: Plan 승인 후에만 활성화.

### 5.3 장기 적용(방향성)

#### A. 병렬 서브에이전트 워크벤치

Grok Build의 8개 worktree 병렬 처리를 SuperLiora의 `UltraSwarm`으로 실험한다.

- Git worktree 단위로 서브에이전트를 실행.
- 각 서브에이전트는 동일한 Plan의 하위 작업을 담당.
- 결과 병합은 별도 "reconciler" 에이전트가 담당.

이는 대규모 리팩토링에 유리하지만, 작은 작업에서는 비용이 크다. 따라서 **자동으로 병렬화 여부를 판단하는 휴리스틱**(파일 개수, 작업 추정 토큰, git 브랜치 가능 여부)이 필요하다.

#### B. Arena Mode 실험

UltraSwarm을 확장해 동일한 작업에 대해 여러 접근법을 생성하고, 별도 평가 에이전트가 코드 품질/테스트 통과/복잡도를 기준으로 랭킹하도록 한다.

- 초기에는 `CodeReview` 도구나 별도 평가 스킬로 충분.
- 장기적으로는 테스트 결과를 자동으로 반영하는 평가 파이프라인 구축.

#### C. 도구 스키마를 Effect-TS로 마이그레이션 검토

SuperLiora는 현재 `zod` + `toInputJsonSchema` + `ajv` 검증을 사용한다. OpenCode는 `effect/Schema`를 사용해 스키마, 검증, JSON Schema 변환, 인코딩/디코딩을 통합한다.

- SuperLiora는 이미 `@effect/` 의존성이 일부 있다. 단기에는 비용이 크지만, 중장기적으로 스키마 일관성과 오류 메시지 품질을 높이는 방향이다.

---

## 6. 결론

OpenCode는 **작고 예측 가능한 도구 조합**으로 에이전트의 행동을 제어한다. Grok Build는 **Plan-first, 병렬 서브에이전트, Arena Mode**로 사람의 검토 지점과 확장성을 설계한다. SuperLiora는 이미 두 철학의 요소를 모두 갖추고 있다. 클래스 기반 도구 캡슐화는 OpenCode와 맥을 같이하고, Plan Mode/Swarm/Background/Cron은 Grok Build의 워크플로우 지향성과 닿아 있다.

가장 먼저 적용할 가치가 있는 것은 **Plan Mode의 READ-ONLY 강화**와 **도구 설명 템플릿 표준화**다. 이는 코드 변경 없이 규칙과 프롬프트만으로도 모델의 행동을 예측 가능하게 만든다. 중기적으로는 `apply_patch` 스타일의 일괄 파일 작업 도구와 도구 등록 레이어 분리가 구조적 복잡도를 줄일 수 있다. 장기적으로는 UltraSwarm 기반 병렬 서브에이전트와 Arena Mode 실험이 SuperLiora의 차별화 지점이 될 수 있다.

---

## 참고

- OpenCode 공식 리포지토리: https://github.com/anomalyco/opencode
- OpenCode 도구 정의: `/tmp/opencode-official/packages/core/src/tool/tool.ts`
- OpenCode 내장 도구 목록: `/tmp/opencode-official/packages/core/src/tool/builtins.ts`
- OpenCode 시스템 프롬프트: `/tmp/opencode-official/packages/opencode/src/session/prompt/default.txt`
- SuperLiora 도구 매니저: `packages/agent-core/src/agent/tool/index.ts`
- SuperLiora 루프 실행 타입: `packages/agent-core/src/loop/types.ts`
- Grok Build 관련 복수 웹 출처: buildfastwithai.com, devops.com, zenvanriel.com, fonearena.com, aintelligencehub.com (2026-05 ~ 2026-06)
