# UltraPlan 읽기 권한 개혁 — allow-list → mutation-based deny-list 전환

**날짜**: 2026-07-09
**범위**: `packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts` 및 관련 도구 속성 선언
**레퍼런스**: [Q00/ouroboros](https://github.com/Q00/ouroboros) — 역할→샌드박스(mutation-class) 단일 매핑 패턴

## 문제

UltraPlan 도중 읽기 도구(Read, Grep, Glob, MCP 문서 조회 등)가 막혀 에이전트가 프로젝트 현황 파악과 코드 탐색을 못 하는 오탐이 발생한다. 근본 원인 두 가지:

1. **write/exit 단계의 deny-all** (`plan-mode-guard-deny.ts:219-244`, `245-257`): research/interview/design/review 단계에서는 Read가 허용되지만, write 단계 진입 후에는 계획 파일 Read만 예외로 두고 나머지 Read/Grep/Glob을 전부 차단한다. 에이전트가 계획을 쓰다 빠뜨린 코드를 다시 확인하려 하면 막히는데, 단방향 위상 머신이라 design/review로 돌아갈 수도 없어 교착 상태가 된다.

2. **allow-list 구조적 한계** (`READ_ONLY_TOOL_NAMES:17-40`): 각 단계가 "이 도구들만 허용, 나머지 전부 deny" 패턴이다. 정적 이름 집합에 없는 읽기 도구는 전부 차단된다.
   - MCP 기반 문서 조회 도구(`mcp__*context7*` 등)가 집합에 없어 research 단계에서도 차단된다. 내장 `Context7Docs`는 허용되는데 MCP 버전은 안 되는 불일치.
   - 새 builtin 읽기 도구가 추가되면 집합에 수동 등록해야 한다. 빠지면 오탐.

**근본 원인**: 도구에 `readOnly` 같은 속성이 없다. 읽기 전용 판별은 오직 하드코딩된 이름 집합에 의존하며, MCP 도구는 `accesses`도 `matchesRule`도 없이 래핑되어(`agent/tool/index.ts:281-301`) permission 정책이 속성을 전혀 알 수 없다. 그래서 안전하게 차단하는 쪽으로 동작한다.

## 목표

- UltraPlan 모든 단계에서 읽기 전용 도구가 막히지 않게 한다.
- 오탐 구조를 제거한다 — 읽기 도구 판별을 이름 집합이 아닌 도구 속성 기반으로.
- 쓰기/mutation 차단 정확도는 유지한다. Plan mode의 안전 보장(계획 파일 외 쓰기 금지)을 약화하지 않는다.

## 비목표

- 인터뷰 품질 개선 (별도 후속 스펙).
- MCP 서버가 자체 readOnly 힌트를 제공하는 인프라 구축 (향후 별도 작업).
- 일반(비-Ultra) plan mode 동작 변경 — 이미 Read/Grep/Glob을 통과시키므로 문제 없음.

## 핵심 원칙: allow-list → mutation-based deny-list 전환

Ouroboros의 mutation-class 패턴을 차용해 패러다임을 뒤집는다. 각 단계는 "어떤 mutation 도구를 차단할까"로만 정의하고, **읽기 전용 도구는 단계 불문 무조건 통과**.

```
현재: if (isReadOnlyTool(name)) return;  // 집합에 있어야 통과
      ... 나머지는 기본 deny-all

제안: if (isWriteOrSideEffectingTool(ctx)) → 단계별 차단 로직 평가
      읽기 전용 도구는 어떤 단계든 return(통과)
```

write/exit에서도 읽기가 통과하는 게 핵심 변화. "계획 집중" 강제력은 기존 프롬프트(`injection/plan-mode.ts:269-283`)로 유지한다.

단계별 정책은 mutation 도구에 대해서만 규칙을 갖는다:

| 단계 | 읽기 도구 | Write/Edit | Bash | 제어 도구 |
|------|----------|-----------|------|----------|
| research | **통과** | 계획파일 외 차단 | 좁은 읽기만 | AskUser/Exit 차단 |
| interview | **통과** | 차단 | 읽기만 | AskUser 허용, Exit 차단 |
| design | **통과** | 차단 | 읽기만 | Exit 차단 |
| review | **통과** | 차단 | 읽기만 | Exit 차단 |
| write | **통과** | 계획파일만 허용 | 차단 | NextPhase/Exit 허용 |
| exit | **통과** | 계획파일만 허용 | 차단 | Exit 허용 |

## 읽기/mutation 판별 메커니즘: B+C 하이브리드

범용 `isReadOnlyTool(context)` 헬퍼를 새로 만들어 세 소스를 순차 검사한다. 첫 번째로 true가 나오면 읽기 전용.

### 1. 명시적 `readOnly` 속성 (B)
`RunnableToolExecution`(`loop/types.ts:129-148`)에 선택 속성을 추가한다.

```typescript
export interface RunnableToolExecution {
  // ...기존 필드...
  /**
   * True when the tool never mutates files, runstate, or external state.
   * Permission policies use this to allow read-only tools in restricted
   * phases (e.g. UltraPlan) without maintaining a hardcoded name set.
   * Defaults to false (safe) when unset.
   */
  readonly readOnly?: boolean;
  // ...
}
```

builtin 읽기 도구들(`Read`, `Grep`, `Glob`, `WebSearch`, `FetchURL`, `LioraContext` 등)이 이 속성을 채운다. 점진적 채우기가 가능하다 — 채우지 않은 도구는 다음 소스로 폴백한다.

### 2. `accesses` 부분 추론 (C, 제한적)
`readOnly`가 unset이면 `context.execution.accesses`를 본다 — 단 **안전한 방향으로만** 추론한다.
- `accesses`에 `write`/`readwrite`가 있거나 `kind: 'all'`이 있으면 → **mutation 확정** (차단)
- `accesses`가 비어 있거나 `none()` → **판별 불가** (읽기 전용 아님). `none()`이 사이드 이펙트 부재를 의미하지 않기 때문. `Agent`(`accesses: none()`이지만 서브에이전트를 띄움), `BrowserObserve`(`none()`이지만 브라우저를 조작) 등이 이 케이스.
- 모든 access가 `read`/`search` operation이고 **정적 집합에 있는 이름**이면 → 읽기 전용. 정적 집합에 없는 이름은 mutation로 취급(안전).

핵심 설계 결정: **`none()`만으로는 절대 읽기 전용으로 판별하지 않는다.** `none()`은 "이 도구가 파일 충돌을 일으키지 않는다"는 뜻이지 "부작용이 없다"는 뜻이 아니다. 파일 기반 동시성 직렬화(`tool-access.ts`)와 permission 판별은 다른 질문이다.

### 3. 기존 정적 집합 (핵심 판별 수단)
`READ_ONLY_TOOL_NAMES` 집합이 읽기 전용 판별의 핵심으로 유지된다. builtin 도구들이 `readOnly: true`를 점진적으로 채우면서 중복이 되지만, 두 소스 모두 일관되게 true를 반환하므로 안전하다. MCP 도구는 정적 집합 대신 `READ_ONLY_MCP_PATTERNS`으로 판별한다.

### mutation 판별
mutation = `readOnly`가 명시적으로 `false`이거나, `accesses`에 `write`/`readwrite`/`kind:'all'`이 있거나, 도구 이름이 알려진 mutation 집합(`Write`, `Edit`, `Bash`, `TaskStop`, `CronCreate`, `CronDelete`)에 있는 경우.

`Bash`는 `ALWAYS_SIDE_EFFECTING_TOOLS`(`tool-call.ts:58-62`)에 이미 등록되어 있으므로 항상 mutation으로 취급한다. 이는 변하지 않는다 — Bash는 임의 명령을 실행할 수 있어 이름만으로 읽기/쓰기를 판별할 수 없기 때문. 단계별로 별도의 좁은 읽기 전용 명령 검증(`isNarrowReadOnlyBash`, `isReadOnlyReviewBash`)을 유지한다.

## MCP 도구 처리: 알려진 읽기 서버 화이트리스트

MCP 도구는 기본적으로 안전=false(차단)로 둔다 — 쓰기 MCP(`mcp__github__create_issue`)와 읽기 MCP(`mcp__context7__query-docs`)를 이름만으로 구분할 표준 방법이 없기 때문.

잘 알려진 읽기 MCP 패턴을 패턴 매칭으로 허용한다:

```typescript
const READ_ONLY_MCP_PATTERNS: readonly RegExp[] = [
  /^mcp__[^_]*context7[^_]*__/i,    // Context7 문서 조회
  /^mcp__[^_]*docs?[^_]*__/i,       // 문서 MCP
  /^mcp__[^_]*search[^_]*__/i,      // 검색 MCP
  /^mcp__[^_]*fetch[^_]*__/i,       // URL fetch MCP
];
```

이 패턴에 매칭되면 `isReadOnlyTool(context)`가 true를 반환한다. 나머지 MCP는 plan mode에서 차단된다(안전 쪽). 향후 MCP 서버가 readOnly 힌트를 제공하는 인프라로 발전 가능하지만, 이번 작업 범위 밖이다.

## 구현 변경 지점

### 1. `loop/types.ts:129-148` — `readOnly` 속성 추가
`RunnableToolExecution` 인터페이스에 `readonly readOnly?: boolean` 추가.

### 2. 신규 헬퍼: `permission/policies/tool-read-only.ts`
범용 `isReadOnlyTool(context): boolean` 함수. 세 소스(명시적 readOnly → accesses 추론 → 정적 집합 + MCP 패턴)를 순차 검사. `READ_ONLY_TOOL_NAMES` 집합과 `READ_ONLY_MCP_PATTERNS`을 이 파일로 이동한다.

신규 파일인 이유: 현재 `plan-mode-guard-deny.ts`에 묶여 있는 읽기 판별 로직을 독립시켜, 다른 정책에서도 재사용하고 단위 테스트를 쉽게 하기 위해서.

### 3. `plan-mode-guard-deny.ts` — 단계별 케이스 재구조화
`evaluateUltraPhase`의 각 단계 케이스를 재작성한다:

- 모든 단계의 맨 앞에 `if (isReadOnlyTool(context)) return;`을 둔다. 이 한 줄로 읽기 도구가 전 단계에서 통과된다.
- write/exit 단계의 deny-all(`:239-243`, `:253-256`)에서 읽기 도구를 차단하던 로직 제거. 읽기는 이미 위에서 통과하므로 도달하지 않는다.
- mutation 도구(Write/Edit/Bash/TaskStop/Cron)에 대한 단계별 차단은 그대로 유지.
- `isReadOnlyTool(toolName: string)` 구식 호출을 `isReadOnlyTool(context)`로 교체. 도구 이름만 받던 함수 시그니처를 `PermissionPolicyContext`를 받도록 변경.

### 4. builtin 읽기 도구에 `readOnly: true` 선언
현재 `READ_ONLY_TOOL_NAMES`에 있는 도구들의 `resolveExecution` 반환값에 `readOnly: true`를 추가한다:
- `Read`, `ReadMediaFile` (`file/read.ts`)
- `Grep` (`file/grep.ts`), `Glob` (`file/glob.ts`)
- `LioraContext`, `LioraRead`, `LioraSearch`, `LioraTree`, `LioraSymbol`, `LioraCallgraph`, `LioraExpand`, `LioraIndex`
- `WebSearch` (`web/web-search.ts`), `FetchURL`
- `Context7Resolve`, `Context7Docs`
- `SearchSkill`, `Skill`, `SearchExpert`
- `TodoList`, `TaskList`, `TaskOutput`

채우지 않은 도구는 폴백(accesses 추론 / 정적 집합)으로 처리되므로, 누락이 곧 회귀로 이어지지는 않는다.

### 5. `injection/plan-mode.ts:269-283` — write/exit 프롬프트 업데이트
write/exit 단계 안내문에서 "계획 파일만 읽을 수 있다"는 제한을 제거하고, "읽기는 자유롭게 할 수 있지만 계획 파일 작성에 집중하라"로 수정. 정책과 프롬프트의 불일치를 없앤다.

write 단계 허용 도구 목록에 Read/Grep/Glob 등을 명시하고, "빠른 사실 확인용으로 읽되 산만해지지 말라"는 톤 유지.

## 데이터 흐름

```
도구 호출 → PlanModeGuardDenyPermissionPolicy.evaluate(context)
  → planMode.isActive? 아니면 통과
  → isUltraMode?
    → evaluateUltraPhase(context, phase)
      → isReadOnlyTool(context)?  ← 신규 범용 헬퍼
          a. execution.readOnly === true? → 통과
          b. accesses가 write/readwrite/kind:'all' → mutation 확정 (이 단계서 끝)
          c. READ_ONLY_TOOL_NAMES에 있고 accesses에 mutation 없음 → 통과
          d. READ_ONLY_MCP_PATTERNS 매칭 → 통과
          아니면 → mutation으로 분류, 단계별 차단 로직 평가
      → Write/Edit: 계획파일 외 차단 (write/exit은 계획파일 허용)
      → Bash: 단계별 좁은 읽기 전용 검증
      → 제어 도구: 단계별 허용/차단
```

## 에지 케이스

- **`accesses: none()`이지만 사이드 이펙트가 있는 도구**: `Agent`(`none()`이지만 서브에이전트 런치), `BrowserObserve`(`none()`이지만 브라우저 조작) 등. `isReadOnlyTool`은 `none()`을 "판별 불가 → 정적 집합 확인"으로 취급한다. 정적 집합에 없으면 mutation으로 차단된다. 즉 `none()`만으로는 절대 읽기 전용 판정이 나지 않는다.
- **`accesses`가 undefined인 MCP/user 도구**: `tool-call.ts:390`에서 `all()`로 간주되지만, 이는 동시성 직렬화용. `isReadOnlyTool`은 `accesses === undefined`를 "판별 불가 → 정적 집합 + MCP 패턴 확인"으로 취급한다. `all()`을 읽기 전용으로 해석하지 않는다.
- **도구가 `readOnly: true`를 거짓 선언**: 책임은 도구 작성자에게. mutation 도구가 `readOnly: true`를 선언하면 plan mode에서 통과되지만, 이는 선언 오류이며 코드 리뷰에서 잡아야 한다. 타입 시스템으로 강제하지 않는다(과잉).
- **write 단계에서 읽기 후 산만해지는 에이전트**: 정책으로 강제하지 않고 프롬프트로 가이드. 설계 의도 — 읽기는 안전하며, 강제 차단보다 프롬프트 가이드가 실제 동작에서 더 효과적.
- **`Bash`는 항상 mutation**: 읽기 전용 Bash 명령(`ls`, `cat`)은 별도 검증(`isNarrowReadOnlyBash` 등)을 통과해야 하며, `isReadOnlyTool`이 Bash를 통과시키지 않는다. 이는 변하지 않는다.

## 테스트

기존 테스트 파일에 추가 (`test/agent/permission.test.ts`, `test/tools/plan-mode-hard-block.test.ts`, `test/agent/injection/plan-mode.test.ts`).

1. **단위 테스트 — `isReadOnlyTool` 헬퍼** (`tool-read-only.ts` 신규 테스트 또는 `permission.test.ts`에 추가):
   - 명시적 `readOnly: true` 도구 → true
   - `readOnly: false` + `accesses`에 write → false
   - `accesses: none()` + 정적 집합에 없음 → **false** (사이드 이펙트 가능)
   - `accesses: none()` + 정적 집합에 있음(`WebSearch`) → true
   - `accesses`에 read/search만 + 정적 집합에 있음(`Read`) → true
   - `accesses`에 read/search만 + 정적 집합에 없음 → false (안전)
   - `accesses` undefined + 정적 집합에 있음 → true
   - `accesses` undefined + 정적 집합에 없음 → false
   - `Agent` 도구(`accesses: none()`) + 정적 집합에 없음 → **false** (핵심: 사이드 이펙트 도구 차단)
   - MCP `mcp__context7__query-docs` → true (패턴 매칭)
   - MCP `mcp__github__create_issue` → false (패턴 불일치)

2. **write/exit 단계 읽기 통과** (`plan-mode-hard-block.test.ts`에 추가):
   - write 단계에서 `Read(코드 파일)` → 통과 (이전: deny)
   - write 단계에서 `Grep` → 통과 (이전: deny)
   - write 단계에서 `Write(코드 파일)` → 여전히 deny
   - exit 단계에서 `Read(코드 파일)` → 통과

3. **MCP 읽기 도구 통과** (`permission.test.ts`에 추가):
   - research 단계에서 `mcp__plugin_context7_context7__query-docs` → 통과 (이전: deny)
   - research 단계에서 `mcp__github__create_issue` → deny

4. **기존 테스트 회귀 확인**:
   - `plan-mode-hard-block.test.ts`의 기존 Write/Edit/TaskStop/Cron 차단 케이스가 그대로 통과하는지.
   - `injection/plan-mode.test.ts`의 write/exit 프롬프트 텍스트 단언을 업데이트된 문구에 맞춘다. "테스트가 사용자 수정으로 실패하면 테스트를 먼저 수정" 원칙(AGENTS.md)에 따라, 구 제한 문구 단언을 새 안내문으로 교체.

## 빌드 순서

1. `loop/types.ts`에 `readOnly?: boolean` 속성 추가 (타입만, 구현 영향 없음)
2. `tool-read-only.ts` 신규 파일 — `isReadOnlyTool(context)` + 집합/패턴 이동
3. `plan-mode-guard-deny.ts` 재구조화 — 각 단계 앞 `isReadOnlyTool(context)` 검사, write/exit deny-all 읽기 차단 제거
4. builtin 도구에 `readOnly: true` 선언 (점진적, 핵심 도구부터)
5. `injection/plan-mode.ts` write/exit 프롬프트 업데이트
6. 테스트 추가 및 기존 테스트 업데이트
7. `pnpm run build` + `pnpm -C packages/agent-core test` 검증

## 리스크

- **회귀**: allow-list → deny-list 전환은 구조적 변경. 기존 정적 집합을 폴백으로 유지해 회귀를 최소화한다. 집합을 즉시 제거하지 않는다.
- **보안**: 읽기 자유화는 mutation 차단 정확도에 의존. `Bash`를 항상 mutation으로 취급하고, `accesses`에 write가 있으면 차단하는 로직이 정확해야 한다. MCP 쓰기 도구가 읽기 패턴에 우연히 매칭될 위험은 패턴을 보수적으로 설계(`docs`, `search`, `fetch`, `context7` 한정)로 완화.
- **프롬프트-정책 불일치**: write/exit 프롬프트를 정책 변경에 맞춰 업데이트하지 않으면 에이전트가 혼란. 5단계에서 함께 처리.
