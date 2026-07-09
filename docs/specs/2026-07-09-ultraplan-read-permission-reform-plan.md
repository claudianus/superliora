# UltraPlan 읽기 권한 개혁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UltraPlan 모든 단계에서 읽기 전용 도구를 차단하지 않게 만들어, 에이전트가 프로젝트 탐색과 코드 확인을 자유롭게 할 수 있도록 한다.

**Architecture:** plan-mode-guard의 패러다임을 allow-list("이 도구들만 허용")에서 mutation-based deny-list("mutation 도구만 단계별 차단")로 전환한다. 읽기 판별은 `readOnly` 속성 + 정적 집합 + MCP 패턴의 하이브리드로 동작한다. `accesses: none()`은 결코 읽기 전용을 의미하지 않는다 — 사이드 이펙트가 있는 `Agent`, `BrowserObserve` 등이 `none()`을 선언하기 때문.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (`packages/agent-core`)

**Spec:** `docs/specs/2026-07-09-ultraplan-read-permission-reform-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/agent-core/src/loop/types.ts:129-142` | Modify | `RunnableToolExecution`에 `readOnly?: boolean` 속성 추가 |
| `packages/agent-core/src/agent/permission/policies/tool-read-only.ts` | Create | 범용 `isReadOnlyTool(context)` 헬퍼 + 정적 집합 + MCP 패턴 |
| `packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts` | Modify | 각 단계 앞 읽기 검사 추가, write/exit deny-all 읽기 차단 제거 |
| `packages/agent-core/src/tools/builtin/file/read.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/file/read-media.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/file/grep.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/file/glob.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/web/web-search.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/web/fetch-url.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/web/context7-resolve.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/web/context7-docs.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/context/*.ts` (7 files) | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/collaboration/search-skill.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/collaboration/skill-tool.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/collaboration/search-expert.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/tools/builtin/state/todo-list.ts` | Modify | `readOnly: true` 선언 |
| `packages/agent-core/src/agent/injection/plan-mode.ts:269-283` | Modify | write/exit 프롬프트에서 읽기 제한 제거 |
| `packages/agent-core/src/tools/builtin/planning/next-phase.ts:120` | Modify | write 진입 메시지에서 읽기 제한 제거 |
| `packages/agent-core/test/tools/plan-mode-hard-block.test.ts` | Modify | write/exit 읽기 허용 테스트 추가, 기존 차단 테스트 수정 |
| `packages/agent-core/test/agent/permission/tool-read-only.test.ts` | Create | `isReadOnlyTool` 단위 테스트 |

---

## Task 1: `readOnly` 속성을 `RunnableToolExecution`에 추가

**Files:**
- Modify: `packages/agent-core/src/loop/types.ts:129-142`

- [ ] **Step 1: `readOnly` 속성 추가**

`RunnableToolExecution` 인터페이스에 `accesses` 필드 바로 뒤에 `readOnly?: boolean`을 추가한다.

기존 (`types.ts:129-142`):
```typescript
export interface RunnableToolExecution {
  readonly isError?: false | undefined;
  readonly accesses?: ToolAccesses | undefined;
  readonly display?: ToolInputDisplay | undefined;
  readonly description?: string;
  /**
   * Stops scheduling later tool calls in the same provider batch. Use this only
   * for tools whose successful action changes turn lifecycle state.
   */
  readonly stopBatchAfterThis?: boolean | undefined;
  readonly approvalRule: string;
  readonly matchesRule?: ((ruleArgs: string) => boolean) | undefined;
  readonly execute: (ctx: ExecutableToolContext) => Promise<ExecutableToolResult>;
}
```

새 코드:
```typescript
export interface RunnableToolExecution {
  readonly isError?: false | undefined;
  readonly accesses?: ToolAccesses | undefined;
  /**
   * True when the tool never mutates files, runstate, or external state.
   * Permission policies use this to allow read-only tools in restricted
   * phases (e.g. UltraPlan) without relying solely on a hardcoded name set.
   * Defaults to false (safe) when unset.
   */
  readonly readOnly?: boolean | undefined;
  readonly display?: ToolInputDisplay | undefined;
  readonly description?: string;
  /**
   * Stops scheduling later tool calls in the same provider batch. Use this only
   * for tools whose successful action changes turn lifecycle state.
   */
  readonly stopBatchAfterThis?: boolean | undefined;
  readonly approvalRule: string;
  readonly matchesRule?: ((ruleArgs: string) => boolean) | undefined;
  readonly execute: (ctx: ExecutableToolContext) => Promise<ExecutableToolResult>;
}
```

- [ ] **Step 2: 빌드 통과 확인**

Run: `pnpm -C packages/agent-core run build`
Expected: 타입 에러 없음. 새 선택 속성은 기존 도구에 영향을 주지 않는다.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/loop/types.ts
git commit -m "feat(permission): add readOnly attribute to RunnableToolExecution"
```

---

## Task 2: `isReadOnlyTool` 헬퍼 생성

**Files:**
- Create: `packages/agent-core/src/agent/permission/policies/tool-read-only.ts`
- Test: `packages/agent-core/test/agent/permission/tool-read-only.test.ts`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`packages/agent-core/test/agent/permission/tool-read-only.test.ts` 생성:

```typescript
import { describe, expect, it } from 'vitest';

import { isReadOnlyTool, READ_ONLY_MCP_PATTERNS } from '../../../src/agent/permission/policies/tool-read-only';
import type { PermissionPolicyContext } from '../../../src/agent/permission/types';
import type { ToolExecutionHookContext } from '../../../src/loop';
import type { ToolCall } from '@superliora/kosong';

const signal = new AbortController().signal;

function ctx(
  toolName: string,
  options: {
    readOnly?: boolean;
    accesses?: PermissionPolicyContext['execution']['accesses'];
  } = {},
): PermissionPolicyContext {
  const hook: ToolExecutionHookContext = {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {} as ToolExecutionHookContext['llm'],
    args: {},
    toolCall: {
      type: 'function',
      id: `call_${toolName}`,
      name: toolName,
      arguments: '{}',
    } satisfies ToolCall,
    toolCalls: [],
  };
  return {
    ...hook,
    execution: {
      accesses: options.accesses,
      readOnly: options.readOnly,
      approvalRule: toolName,
      execute: async () => ({ output: '' }),
    },
  };
}

describe('isReadOnlyTool', () => {
  it('returns true when readOnly flag is explicitly set', () => {
    expect(isReadOnlyTool(ctx('CustomTool', { readOnly: true }))).toBe(true);
  });

  it('returns false when readOnly is false', () => {
    expect(isReadOnlyTool(ctx('CustomTool', { readOnly: false }))).toBe(false);
  });

  it('returns false when accesses has a write operation', () => {
    expect(
      isReadOnlyTool(
        ctx('SomeTool', {
          accesses: [{ kind: 'file', operation: 'write', path: '/x.ts' }],
        }),
      ),
    ).toBe(false);
  });

  it('returns false when accesses has kind all', () => {
    expect(
      isReadOnlyTool(ctx('SomeTool', { accesses: [{ kind: 'all' }] })),
    ).toBe(false);
  });

  it('does NOT treat none() alone as read-only (side effects possible)', () => {
    // Agent tool declares accesses: none() but has side effects.
    expect(isReadOnlyTool(ctx('Agent', { accesses: [] }))).toBe(false);
  });

  it('treats none() + static set membership as read-only', () => {
    // WebSearch declares none() but is in the static read-only set.
    expect(isReadOnlyTool(ctx('WebSearch', { accesses: [] }))).toBe(true);
  });

  it('treats read operation + static set membership as read-only', () => {
    expect(
      isReadOnlyTool(
        ctx('Read', {
          accesses: [{ kind: 'file', operation: 'read', path: '/x.ts' }],
        }),
      ),
    ).toBe(true);
  });

  it('treats read operation WITHOUT static set membership as NOT read-only', () => {
    expect(
      isReadOnlyTool(
        ctx('UnknownReadTool', {
          accesses: [{ kind: 'file', operation: 'read', path: '/x.ts' }],
        }),
      ),
    ).toBe(false);
  });

  it('returns true for known read-only MCP pattern (context7)', () => {
    expect(isReadOnlyTool(ctx('mcp__plugin_context7_context7__query-docs'))).toBe(true);
  });

  it('returns false for unknown MCP tool (potential write)', () => {
    expect(isReadOnlyTool(ctx('mcp__github__create_issue'))).toBe(false);
  });

  it('returns false for accesses undefined + not in static set', () => {
    expect(isReadOnlyTool(ctx('SomeUnknownTool', { accesses: undefined }))).toBe(false);
  });
});

describe('READ_ONLY_MCP_PATTERNS', () => {
  it.each([
    'mcp__plugin_context7_context7__query-docs',
    'mcp__docs_server__get_docs',
    'mcp__search_mcp__search',
    'mcp__fetch_tool__fetch',
  ])('matches known read-only MCP tool: %s', (toolName) => {
    expect(READ_ONLY_MCP_PATTERNS.some((p) => p.test(toolName))).toBe(true);
  });

  it.each([
    'mcp__github__create_issue',
    'mcp__slack__post_message',
    'mcp__database__execute',
  ])('does NOT match write MCP tool: %s', (toolName) => {
    expect(READ_ONLY_MCP_PATTERNS.some((p) => p.test(toolName))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인 (모듈 없음)**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/permission/tool-read-only.test.ts`
Expected: FAIL — `isReadOnlyTool` 모듈을 찾을 수 없음.

- [ ] **Step 3: `tool-read-only.ts` 헬퍼 구현**

`packages/agent-core/src/agent/permission/policies/tool-read-only.ts` 생성:

```typescript
import type { ToolFileAccess } from '../../../loop/tool-access';
import type { PermissionPolicyContext } from '../types';

/**
 * Built-in tool names that are inherently read-only — they never mutate files,
 * runstate, or scheduled work. This set is the authoritative source for
 * name-based read-only classification; tools should also declare `readOnly:
 * true` on their execution, but this set covers tools that have not been
 * migrated yet and provides a safe default for MCP/user tools.
 */
export const READ_ONLY_TOOL_NAMES = new Set<string>([
  'Read',
  'ReadMediaFile',
  'Grep',
  'Glob',
  'LioraContext',
  'LioraRead',
  'LioraSearch',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraIndex',
  'WebSearch',
  'FetchURL',
  'Context7Resolve',
  'Context7Docs',
  'SearchSkill',
  'Skill',
  'SearchExpert',
  'TodoList',
  'TaskList',
  'TaskOutput',
]);

/**
 * MCP server name patterns (the segment between `mcp__` and the tool name)
 * that are known to be read-only documentation/search/fetch servers. MCP
 * tools matching these patterns are allowed in read-only plan phases. All
 * other MCP tools are treated as potentially mutating (safe default).
 */
export const READ_ONLY_MCP_PATTERNS: readonly RegExp[] = [
  /^mcp__[^_]*context7[^_]*__/i,
  /^mcp__[^_]*docs?[^_]*__/i,
  /^mcp__[^_]*search[^_]*__/i,
  /^mcp__[^_]*fetch[^_]*__/i,
];

/**
 * Determine whether a tool is read-only for permission-gating purposes.
 *
 * Order of checks (first decisive result wins):
 * 1. Explicit `readOnly` flag on the execution — trusted author declaration.
 * 2. `accesses` with a write/readwrite operation or `kind: 'all'` → definitely
 *    mutating, return false.
 * 3. Name in the static `READ_ONLY_TOOL_NAMES` set (and accesses has no
 *    mutation) → read-only.
 * 4. Name matches a `READ_ONLY_MCP_PATTERNS` entry → read-only.
 * 5. Otherwise → not read-only (safe default).
 *
 * CRITICAL: `accesses: none()` (empty array) does NOT imply read-only. Tools
 * like `Agent` and `BrowserObserve` declare `none()` because they have no file-
 * concurrency conflicts, but they still have side effects (launching subagents,
 * controlling a browser). Only the explicit flag or static set membership
 * classifies a tool as read-only.
 */
export function isReadOnlyTool(context: PermissionPolicyContext): boolean {
  const execution = context.execution;
  const toolName = context.toolCall.name;

  // 1. Explicit declaration wins.
  if (execution.readOnly === true) return true;
  if (execution.readOnly === false) return false;

  // 2. accesses proves mutation → definitely not read-only.
  if (hasMutatingAccesses(execution.accesses)) return false;

  // 3. Static name set (core classification for builtins without the flag yet).
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return true;

  // 4. Known read-only MCP pattern.
  if (isReadOnlyMcpTool(toolName)) return true;

  // 5. Unknown / potentially side-effecting.
  return false;
}

function hasMutatingAccesses(
  accesses: PermissionPolicyContext['execution']['accesses'],
): boolean {
  if (accesses === undefined) return false;
  return accesses.some((access) => {
    if (access.kind === 'all') return true;
    return access.operation === 'write' || access.operation === 'readwrite';
  });
}

function isReadOnlyMcpTool(toolName: string): boolean {
  return READ_ONLY_MCP_PATTERNS.some((pattern) => pattern.test(toolName));
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/permission/tool-read-only.test.ts`
Expected: PASS — 모든 케이스 통과.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent/permission/policies/tool-read-only.ts \
        packages/agent-core/test/agent/permission/tool-read-only.test.ts
git commit -m "feat(permission): add isReadOnlyTool helper with hybrid read-only detection"
```

---

## Task 3: plan-mode-guard-deny를 deny-list 패러다임으로 재구조화

**Files:**
- Modify: `packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts`

이 태스크가 핵심이다. 각 Ultra 단계의 맨 앞에 `isReadOnlyTool(context)` 검사를 추가해 읽기 도구를 전 단계에서 통과시키고, write/exit 단계의 deny-all에서 읽기 차단을 제거한다.

- [ ] **Step 1: import 및 정적 집합 교체**

`plan-mode-guard-deny.ts` 상단에서 기존 `READ_ONLY_TOOL_NAMES` 집합과 `isReadOnlyTool` 함수를 제거하고, 새 헬퍼에서 import한다.

기존 (`plan-mode-guard-deny.ts:1-44`):
```typescript
import type { Agent } from '../..';
import type { ToolFileAccess } from '../../../loop/tool-access';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

/**
 * Tools that are inherently read-only ...
 */
const READ_ONLY_TOOL_NAMES = new Set<string>([
  'Read',
  'ReadMediaFile',
  'Grep',
  'Glob',
  'LioraContext',
  'LioraRead',
  'LioraSearch',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraIndex',
  'WebSearch',
  'FetchURL',
  'Context7Resolve',
  'Context7Docs',
  'SearchSkill',
  'Skill',
  'SearchExpert',
  'TodoList',
  'TaskList',
  'TaskOutput',
]);

function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(toolName);
}
```

새 코드:
```typescript
import type { Agent } from '../..';
import type { ToolFileAccess } from '../../../loop/tool-access';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';
import { isReadOnlyTool } from './tool-read-only';
```

- [ ] **Step 2: `evaluateUltraPhase`에 전역 읽기 통과 게이트 추가**

`evaluateUltraPhase` 메서드의 `switch (phase)` **직전**에 읽기 도구 통과 검사를 추가한다. 이 한 줄로 모든 단계에서 읽기 도구가 통과된다.

기존 (`plan-mode-guard-deny.ts:107-112`):
```typescript
  private evaluateUltraPhase(
    context: PermissionPolicyContext,
    phase: string,
  ): PermissionPolicyResult | undefined {
    const toolName = context.toolCall.name;
    switch (phase) {
```

새 코드:
```typescript
  private evaluateUltraPhase(
    context: PermissionPolicyContext,
    phase: string,
  ): PermissionPolicyResult | undefined {
    const toolName = context.toolCall.name;

    // Read-only tools are allowed in every Ultra phase. This is the core
    // deny-list reform: instead of per-phase allow-lists that block unknown
    // read-only tools (MCP docs, new builtins), we gate only mutating tools.
    // The agent can always read, search, and research regardless of phase.
    if (isReadOnlyTool(context)) return;

    switch (phase) {
```

- [ ] **Step 3: 각 단계에서 구식 `isReadOnlyTool(toolName)` 호출 제거**

`evaluateUltraPhase` 내의 각 단계에서 기존 `if (isReadOnlyTool(toolName) ...)` 검사를 제거한다 — 전역 게이트에서 이미 처리했으므로 중복이다. 단, 다른 도구(`NextPhase` 등)와의 OR 결합은 분리해서 `NextPhase` 검사만 남긴다.

`research` 케이스 (`plan-mode-guard-deny.ts:113-141`), 기존 라인 115:
```typescript
      case 'research': {
        // Read-only tools are always allowed in research phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
```
변경:
```typescript
      case 'research': {
        // Read-only tools already passed the global gate above.
        if (toolName === 'NextPhase') return;
```

`interview` 케이스 (`plan-mode-guard-deny.ts:142-174`), 기존 라인 148:
```typescript
        if (isReadOnlyTool(toolName)) return;
```
이 줄을 삭제한다 (전역 게이트가 처리).

`design` 케이스 (`plan-mode-guard-deny.ts:175-196`), 기존 라인 177:
```typescript
        // Read-only tools are always allowed in design phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
```
변경:
```typescript
        if (toolName === 'NextPhase') return;
```

`review` 케이스 (`plan-mode-guard-deny.ts:197-218`), 기존 라인 199:
```typescript
        // Read-only tools are always allowed in review phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
```
변경:
```typescript
        if (toolName === 'NextPhase') return;
```

- [ ] **Step 4: write 단계 deny 메시지에서 읽기 차단 제거**

`write` 케이스 (`plan-mode-guard-deny.ts:219-244`). 읽기 도구는 전역 게이트에서 통과하므로, 여기서는 도달하지 않는다. 하지만 `Read` (계획 파일 검사)를 명시적으로 허용하던 코드를 정리하고, deny-all 메시지를 수정한다.

기존:
```typescript
      case 'write': {
        const planFilePath = this.agent.planMode.planFilePath;
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'Read' && planFilePath !== null && readsOnlyPlanFile(context, planFilePath)) return;
        if (toolName === 'TodoList') return;
        if (toolName === 'NextPhase' || toolName === 'ExitPlanMode') return;
        if (toolName === 'SearchSkill' || toolName === 'Skill') return;

        if (toolName === 'Bash') {
          return {
            kind: 'deny',
            message: 'Bash is blocked in Write phase. Focus on writing the plan file. Use NextPhase to advance to Exit when the plan is complete.',
          };
        }
        if (toolName === 'TaskStop' || toolName === 'CronCreate' || toolName === 'CronDelete') {
          return {
            kind: 'deny',
            message: `${toolName} is blocked in Write phase. Focus on writing the plan file.`,
          };
        }
        return {
          kind: 'deny',
          message:
            `${toolName} is blocked in Write phase. Only the current plan file may be read or edited, TodoList may be updated for progress tracking, SearchSkill/Skill may be used for the no-AI-slop prose gate, and NextPhase/ExitPlanMode may be used when the plan is complete.`,
        };
      }
```

새 코드:
```typescript
      case 'write': {
        // Read-only tools passed the global gate. Allow plan-file writes and
        // phase-control tools; block everything else (Bash, background, etc.).
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'NextPhase' || toolName === 'ExitPlanMode') return;

        if (toolName === 'Bash') {
          return {
            kind: 'deny',
            message: 'Bash is blocked in Write phase. Focus on writing the plan file. Use NextPhase to advance to Exit when the plan is complete.',
          };
        }
        if (toolName === 'TaskStop' || toolName === 'CronCreate' || toolName === 'CronDelete') {
          return {
            kind: 'deny',
            message: `${toolName} is blocked in Write phase. Focus on writing the plan file.`,
          };
        }
        return {
          kind: 'deny',
          message:
            `${toolName} is blocked in Write phase. You may read files for quick verification, write only to the current plan file, and use NextPhase or ExitPlanMode when complete.`,
        };
      }
```

참고: `TodoList`/`SearchSkill`/`Skill` 명시적 허용과 `Read` 계획 파일 검사(`readsOnlyPlanFile`) 호출은 제거 — 이 도구들은 전역 게이트에서 읽기 전용으로 통과한다. `readsOnlyPlanFile` 함수 자체는 `exit` 케이스에서 더 이상 쓰이지 않으므로 Task 5에서 정리한다(지금은 컴파일 위해 남겨둘 수 있지만, 이 태스크에서 `exit`도 함께 수정하므로 여기서 제거한다).

- [ ] **Step 5: exit 단계도 동일하게 수정**

`exit` 케이스 (`plan-mode-guard-deny.ts:245-257`).

기존:
```typescript
      case 'exit': {
        // ExitPlanMode may report a missing required section. Allow plan-file
        // reads and edits so the agent can repair the plan instead of getting trapped.
        const planFilePath = this.agent.planMode.planFilePath;
        if (toolName === 'Read' && planFilePath !== null && readsOnlyPlanFile(context, planFilePath)) return;
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'ExitPlanMode') return;
        if (toolName === 'SearchSkill' || toolName === 'Skill') return;
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Exit phase. Only ExitPlanMode, current plan-file reads or edits, and SearchSkill/Skill for the no-AI-slop prose gate are allowed.`,
        };
      }
```

새 코드:
```typescript
      case 'exit': {
        // Read-only tools passed the global gate. Allow plan-file edits (to
        // repair missing sections) and ExitPlanMode; block Bash/background.
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'ExitPlanMode') return;
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Exit phase. You may read files for quick verification, edit only the current plan file to repair missing sections, and call ExitPlanMode for approval.`,
        };
      }
```

- [ ] **Step 6: 사용하지 않는 `readsOnlyPlanFile` 함수 제거**

`readsOnlyPlanFile` (`plan-mode-guard-deny.ts:293-304`)가 더 이상 호출되지 않으므로 제거한다. `ToolFileAccess` import가 `readsOnlyPlanFile`에서만 쓰였다면 함께 제거한다 (컴파일러가 알려줌).

기존 (`plan-mode-guard-deny.ts:293-304`):
```typescript
function readsOnlyPlanFile(
  context: PermissionPolicyContext,
  planFilePath: string,
): boolean {
  const readAccesses =
    context.execution.accesses?.filter(
      (access): access is ToolFileAccess =>
        access.kind === 'file' && access.operation === 'read',
    ) ?? [];
  if (readAccesses.length === 0) return false;
  return readAccesses.every((access) => access.path === planFilePath);
}
```

이 함수 전체를 삭제한다. `ToolFileAccess` import(`plan-mode-guard-deny.ts:2`)가 다른 곳에서 안 쓰이면 같이 삭제 — 컴파일러가 unused import로 경고하므로 빌드에서 확인.

- [ ] **Step 7: 빌드 확인**

Run: `pnpm -C packages/agent-core run build`
Expected: 컴파일 에러 없음. `ToolFileAccess` unused import면 제거.

- [ ] **Step 8: 기존 테스트 실행 — 일부 실패 예상**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/tools/plan-mode-hard-block.test.ts`
Expected: write/exit 단계에서 `Read`/`WebSearch`/`FetchURL`/`TaskOutput`을 차단하던 테스트가 실패. `Agent`/`BrowserObserve` 차단 테스트는 여전히 통과해야 함(이들은 정적 집합에 없고 `accesses: none()`이므로 mutation으로 분류). Task 6에서 테스트를 수정한다.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts
git commit -m "refactor(permission): switch plan-mode-guard to mutation-based deny-list

Read-only tools now pass a global gate before per-phase logic, so they
are allowed in every Ultra phase including write/exit. Each phase only
gates mutating tools (Write/Edit/Bash/background)."
```

---

## Task 4: builtin 읽기 도구에 `readOnly: true` 선언

**Files (각 파일의 `resolveExecution` 반환 객체):**
- Modify: `packages/agent-core/src/tools/builtin/file/read.ts:252`
- Modify: `packages/agent-core/src/tools/builtin/file/read-media.ts:235`
- Modify: `packages/agent-core/src/tools/builtin/file/grep.ts:210`
- Modify: `packages/agent-core/src/tools/builtin/file/glob.ts:142`
- Modify: `packages/agent-core/src/tools/builtin/web/web-search.ts:71`
- Modify: `packages/agent-core/src/tools/builtin/web/fetch-url.ts:75`
- Modify: `packages/agent-core/src/tools/builtin/web/context7-resolve.ts:44`
- Modify: `packages/agent-core/src/tools/builtin/web/context7-docs.ts:47`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-context.ts:83` (반환 객체)
- Modify: `packages/agent-core/src/tools/builtin/context/liora-read.ts:65`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-search.ts:67`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-tree.ts:65`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-symbol.ts:60`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-callgraph.ts:65`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-expand.ts:38`
- Modify: `packages/agent-core/src/tools/builtin/context/liora-index.ts` (approvalRule 라인)
- Modify: `packages/agent-core/src/tools/builtin/collaboration/search-skill.ts:36`
- Modify: `packages/agent-core/src/tools/builtin/collaboration/skill-tool.ts:88`
- Modify: `packages/agent-core/src/tools/builtin/collaboration/search-expert.ts:43`
- Modify: `packages/agent-core/src/tools/builtin/state/todo-list.ts:106`

- [ ] **Step 1: file/web 도구들에 `readOnly: true` 추가**

각 파일의 `resolveExecution` 반환 객체에서 `accesses:` 라인 바로 다음에 `readOnly: true,`를 추가한다.

예시 — `read.ts:252-258`:
```typescript
// 기존:
    return {
      accesses: ToolAccesses.readFile(path),
      display: ...,
      approvalRule: literalRulePattern(this.name, path),
// 새:
    return {
      accesses: ToolAccesses.readFile(path),
      readOnly: true,
      display: ...,
      approvalRule: literalRulePattern(this.name, path),
```

다음 파일들에 동일 패턴 적용 (`accesses:` 라인 다음에 `readOnly: true,` 추가):
- `file/read.ts:253` (`accesses: ToolAccesses.readFile(path),` 다음)
- `file/read-media.ts:236` (`accesses: ToolAccesses.readFile(path),` 다음)
- `file/grep.ts:211` (`accesses: ToolAccesses.searchTree(...)` 다음)
- `file/glob.ts:143` (`accesses: ToolAccesses.searchTree(...)` 다음)
- `web/web-search.ts:72` (`accesses: ToolAccesses.none(),` 다음)
- `web/fetch-url.ts:76` (`accesses: ToolAccesses.none(),` 다음)
- `web/context7-resolve.ts:45` (`accesses: ToolAccesses.none(),` 다음)
- `web/context7-docs.ts:48` (`accesses: ToolAccesses.none(),` 다음)

- [ ] **Step 2: context 도구들에 `readOnly: true` 추가**

context 도구들은 `accesses`가 조건부이거나 `this.name` 기반이다. 반환 객체에서 `approvalRule:` 라인 전에 `readOnly: true,`를 추가한다.

다음 파일들에 적용:
- `context/liora-context.ts` — `resolveExecution` 반환 객체(`approvalRule: this.name,` 전에 추가)
- `context/liora-read.ts`
- `context/liora-search.ts`
- `context/liora-tree.ts`
- `context/liora-symbol.ts`
- `context/liora-callgraph.ts`
- `context/liora-expand.ts`
- `context/liora-index.ts`

각 파일에서 다음 패턴을 찾아 `readOnly: true,`를 `approvalRule` 전에 삽입:
```typescript
// 기존:
      approvalRule: this.name,
// 새:
      readOnly: true,
      approvalRule: this.name,
```

- [ ] **Step 3: collaboration/state 도구들에 `readOnly: true` 추가**

동일 패턴으로 `approvalRule` 전에 `readOnly: true,` 추가:
- `collaboration/search-skill.ts:39` (`approvalRule: this.name,` 전)
- `collaboration/skill-tool.ts:91` (`approvalRule: this.name,` 전)
- `collaboration/search-expert.ts:46` (`approvalRule: this.name,` 전)
- `state/todo-list.ts:108` (`approvalRule: this.name,` 전)

- [ ] **Step 4: 빌드 확인**

Run: `pnpm -C packages/agent-core run build`
Expected: 타입 에러 없음.

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/tools/plan-mode-hard-block.test.ts`
Expected: write/exit 읽기 차단 테스트만 실패 (Task 6에서 수정). 나머지 통과.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/tools/builtin/
git commit -m "feat(tools): declare readOnly: true on read-only builtin tools"
```

---

## Task 5: write/exit 프롬프트에서 읽기 제한 제거

**Files:**
- Modify: `packages/agent-core/src/agent/injection/plan-mode.ts:269-283`
- Modify: `packages/agent-core/src/tools/builtin/planning/next-phase.ts:120`

- [ ] **Step 1: write 단계 프롬프트 수정**

`plan-mode.ts:269-278`, 기존:
```typescript
  write: `## Write Phase
You may ONLY write to the current plan file. All other file edits are BLOCKED. You may read only the current plan file, update TodoList for progress tracking, use SearchSkill/Skill for the no-AI-slop prose gate, and use NextPhase or ExitPlanMode when complete.

Before writing plan prose that users will read, apply the no-AI-slop prose gate (light pass first; SearchSkill → Skill only if needed):
${NO_AI_SLOP_SKILL_ROUTING}

Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: \`Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>\`
Prefer ENGAGE for multi-lane or review-heavy work. DEFER needs \`Swarm DEFER waiver:\` for deterministic single-owner tasks.
ExitPlanMode only after a complete Seed Spec. Write/Edit the plan file (Write if missing).`,
```

새 코드:
```typescript
  write: `## Write Phase
You may ONLY write to the current plan file. All other file edits are BLOCKED. Reading files (Read, Grep, Glob, WebSearch, FetchURL, etc.) is allowed for quick verification while writing — but stay focused on the plan file. Use TodoList for progress tracking, SearchSkill/Skill for the no-AI-slop prose gate, and NextPhase or ExitPlanMode when complete.

Before writing plan prose that users will read, apply the no-AI-slop prose gate (light pass first; SearchSkill → Skill only if needed):
${NO_AI_SLOP_SKILL_ROUTING}

Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: \`Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>\`
Prefer ENGAGE for multi-lane or review-heavy work. DEFER needs \`Swarm DEFER waiver:\` for deterministic single-owner tasks.
ExitPlanMode only after a complete Seed Spec. Write/Edit the plan file (Write if missing).`,
```

- [ ] **Step 2: exit 단계 프롬프트 수정**

`plan-mode.ts:280-283`, 기존:
```typescript
  exit: `## Exit Phase
Plan complete — call ExitPlanMode for approval. Ensure complete Seed Spec, Swarm decision audit line, and any DEFER waiver. Quick anti-slop light pass on user-visible plan text before ExitPlanMode; SearchSkill → Skill only if prose still reads generic.
${NO_AI_SLOP_SKILL_ROUTING}
If ExitPlanMode reports missing sections, Read the current plan file if needed, correct only that plan file, and retry.`,
```

새 코드:
```typescript
  exit: `## Exit Phase
Plan complete — call ExitPlanMode for approval. Ensure complete Seed Spec, Swarm decision audit line, and any DEFER waiver. Quick anti-slop light pass on user-visible plan text before ExitPlanMode; SearchSkill → Skill only if prose still reads generic.
${NO_AI_SLOP_SKILL_ROUTING}
If ExitPlanMode reports missing sections, Read the plan file if needed, correct only that plan file, and retry. Reading other files for quick verification is allowed but stay focused on finalizing the plan.`,
```

- [ ] **Step 3: NextPhase write 진입 메시지 수정**

`next-phase.ts:120`, 기존:
```typescript
      write: 'Write Phase: Write the complete plan to the plan file. Only the current plan file can be read or edited; TodoList progress tracking and NextPhase/ExitPlanMode remain available. Include Seed Spec, AC Tree, WorkGraph, Evaluation Plan, and Execution Plan.',
```

새 코드:
```typescript
      write: 'Write Phase: Write the complete plan to the plan file. Only the current plan file may be edited; reading files for quick verification is allowed. TodoList progress tracking and NextPhase/ExitPlanMode remain available. Include Seed Spec, AC Tree, WorkGraph, Evaluation Plan, and Execution Plan.',
```

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/agent/injection/plan-mode.ts \
        packages/agent-core/src/tools/builtin/planning/next-phase.ts
git commit -m "docs(plan-mode): update write/exit prompts to reflect read freedom"
```

---

## Task 6: 기존 테스트 수정 및 읽기 허용 테스트 추가

**Files:**
- Modify: `packages/agent-core/test/tools/plan-mode-hard-block.test.ts`
- Modify: `packages/agent-core/test/agent/injection/plan-mode.test.ts`

- [ ] **Step 1: write 단계 읽기 차단 테스트를 읽기 허용으로 변경**

`plan-mode-hard-block.test.ts:717-731`의 `it.each`에서 이제 허용되는 읽기 도구들을 제거한다. `Read`, `WebSearch`, `FetchURL`, `TaskOutput`는 write 단계에서 통과해야 한다.

기존 (`plan-mode-hard-block.test.ts:717-731`):
```typescript
  it.each([
    ['Read', { path: '/workspace/src/main.ts' }],
    ['WebSearch', { query: 'new planning evidence' }],
    ['FetchURL', { url: 'https://example.com/docs' }],
    ['Agent', { prompt: 'review the plan', description: 'review plan' }],
    ['BrowserObserve', {}],
    ['TaskOutput', { task_id: 'task_123' }],
  ] as const)('blocks %s in Ultra Plan write phase', async (toolName, args) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('write');

    const deny = expectDeny(evaluatePlanPolicy(agent, toolName, args));

    expect(deny.message ?? '').toContain('Write phase');
  });
```

새 코드:
```typescript
  it.each([
    ['Read', { path: '/workspace/src/main.ts' }],
    ['WebSearch', { query: 'new planning evidence' }],
    ['FetchURL', { url: 'https://example.com/docs' }],
    ['TaskOutput', { task_id: 'task_123' }],
  ] as const)('allows %s in Ultra Plan write phase for quick verification', async (toolName, args) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('write');

    expect(evaluatePlanPolicy(agent, toolName, args)).toBeUndefined();
  });

  it.each([
    ['Agent', { prompt: 'review the plan', description: 'review plan' }],
    ['BrowserObserve', {}],
  ] as const)('blocks %s in Ultra Plan write phase (side effects)', async (toolName, args) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('write');

    const deny = expectDeny(evaluatePlanPolicy(agent, toolName, args));

    expect(deny.message ?? '').toContain('Write phase');
  });
```

- [ ] **Step 2: exit 단계 읽기 차단 테스트 수정**

`plan-mode-hard-block.test.ts:891-914`에서 exit 단계의 `Read` 비-계획파일 차단 테스트를 수정한다. `Read`는 이제 exit 단계에서도 통과한다.

기존 (`plan-mode-hard-block.test.ts:904-905`):
```typescript
    const readDeny = expectDeny(evaluatePlanPolicy(agent, 'Read', { path: '/workspace/src/main.ts' }));
    expect(readDeny.message ?? '').toContain('current plan-file reads');
```

새 코드:
```typescript
    // Reading non-plan files is now allowed in exit phase for quick verification.
    expect(
      evaluatePlanPolicy(agent, 'Read', { path: '/workspace/src/main.ts' }),
    ).toBeUndefined();
```

- [ ] **Step 3: MCP 읽기 도구 허용 테스트 추가**

`plan-mode-hard-block.test.ts`의 describe 블록 끝(TaskStop 테스트 전)에 새 테스트 추가:

```typescript
  it('allows known read-only MCP tools in Ultra Plan research phase', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });

    expect(
      evaluatePlanPolicy(agent, 'mcp__plugin_context7_context7__query-docs', {
        library_id: '/vercel/next.js',
        query: 'middleware',
      }),
    ).toBeUndefined();
  });

  it('allows known read-only MCP tools in Ultra Plan write phase', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('write');

    expect(
      evaluatePlanPolicy(agent, 'mcp__plugin_context7_context7__query-docs', {
        library_id: '/vercel/next.js',
        query: 'middleware',
      }),
    ).toBeUndefined();
  });

  it('blocks unknown MCP tools in Ultra Plan research phase', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });

    const deny = expectDeny(
      evaluatePlanPolicy(agent, 'mcp__github__create_issue', {
        title: 'test',
        body: 'test',
      }),
    );

    expect(deny.message ?? '').toContain('Research phase');
  });
```

- [ ] **Step 4: next-phase write 메시지 단언 업데이트**

`plan-mode-hard-block.test.ts:583-584`에서 NextPhase write 진입 메시지 단언을 업데이트한다.

기존:
```typescript
    expect(result.output).toContain('Only the current plan file can be read or edited');
```

새 코드:
```typescript
    expect(result.output).toContain('Only the current plan file may be edited');
```

- [ ] **Step 5: injection plan-mode 테스트의 write/exit 프롬프트 단언 업데이트**

`test/agent/injection/plan-mode.test.ts`에서 write/exit 프롬프트 텍스트를 단언하는 부분이 있으면 새 문구로 업데이트한다. grep으로 확인:

Run: `rg -n "read only the current plan|current plan-file reads|Only the current plan file can be read" packages/agent-core/test/`

발견된 각 단언을 새 프롬프트 텍스트에 맞게 수정한다. 새 write 프롬프트에는 "Reading files ... is allowed for quick verification"가 있고, "You may ONLY write to the current plan file"는 유지된다.

- [ ] **Step 6: 테스트 실행 — 모두 통과 확인**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/tools/plan-mode-hard-block.test.ts test/agent/injection/plan-mode.test.ts test/agent/permission/tool-read-only.test.ts`
Expected: PASS — 모든 테스트 통과.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/test/tools/plan-mode-hard-block.test.ts \
        packages/agent-core/test/agent/injection/plan-mode.test.ts
git commit -m "test(permission): update write/exit tests for read freedom + MCP allow"
```

---

## Task 7: 전체 빌드 및 테스트 검증

- [ ] **Step 1: agent-core 전체 테스트**

Run: `pnpm --filter @superliora/agent-core test`
Expected: PASS — 기존 테스트 + 새 테스트 모두 통과. permission 관련 테스트 회귀 없음.

- [ ] **Step 2: 전체 빌드**

Run: `pnpm run build`
Expected: 타입 에러, declaration emit 에러 없음.

- [ ] **Step 3: import 체크**

Run: `pnpm run check:imports`
Expected: 통과 — `@superliora/superliora-sdk` 같은 잘못된 패키지명 없음.

- [ ] **Step 4: 최종 Commit (있으면)**

빌드/테스트 수정분이 있으면 커밋. 없으면 스킵.

```bash
git add -A
git commit -m "test(permission): fix remaining regressions from read permission reform"
```

---

## Self-Review (작성자 점검)

**스펙 커버리지:**
- ✅ allow-list → deny-list 전환 → Task 3
- ✅ `readOnly` 속성 추가 (B) → Task 1, 4
- ✅ accesses 부분 추론 (C, 제한적) → Task 2 (`hasMutatingAccesses`)
- ✅ 정적 집합 유지 → Task 2 (`READ_ONLY_TOOL_NAMES`)
- ✅ MCP 화이트리스트 → Task 2 (`READ_ONLY_MCP_PATTERNS`)
- ✅ write/exit 읽기 차단 제거 → Task 3 Steps 4-5
- ✅ 프롬프트 업데이트 → Task 5
- ✅ 단위 테스트 → Task 2, 6
- ✅ 회귀 테스트 → Task 6, 7

**자리표석자 스캔:** TBD/TODO/placeholder 없음. 모든 코드 블록에 실제 구현 포함.

**타입 일관성:** `isReadOnlyTool(context)` 시그니처가 Task 2(정의), Task 3(사용)에서 일치. `readOnly?: boolean` 속성이 Task 1(정의), Task 4(사용)에서 일치. `READ_ONLY_MCP_PATTERNS` export가 Task 2(정의), 테스트(사용)에서 일치.
