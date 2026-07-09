# UltraSwarm M1: Pre-Engage Routing Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-engage routing gate that decides whether a task needs a full swarm (`ENGAGE`), a lightweight swarm (`ADAPTIVE`), or no swarm at all (`DEFER`), driven by plan signals and controlling expert count, so simple tasks stop launching 24-expert swarms.

**Architecture:** Extend the `UltraSwarmDecision` enum from binary (`ENGAGE|DEFER`) to ternary (`ENGAGE|ADAPTIVE|DEFER`). Add a `routeFromPlanSignals` helper that derives a routing result (decision + intensity + estimated experts + rationale) from the plan text. Thread the routing result through `UltraSwarmEngageGateData` so the UltraSwarm tool's default expert count respects `routing.intensity`. Emit a new `ultrawork.routing.decided` protocol event consumed by the TUI to render a routing badge. Keep the existing tool `intensity` (`balanced|premium|max`) as an explicit override; the new `routing.intensity` (`light|standard|heavy`) is the default source of truth.

**Tech Stack:** TypeScript, zod (schema validation), vitest (testing), pi-tui (TUI components), `@superliora/protocol` (event schemas).

**Spec:** `docs/specs/2026-07-09-ultraswarm-quality-cost-steering-design.md` (Section 1, Milestone 1).

---

## File Structure

**Create:**
- `packages/agent-core/src/agent/plan/ultra-swarm-routing.ts` — `SwarmRoutingIntensity`, `SwarmRoutingResult`, `routeFromPlanSignals`, `intensityToDefaultExpertCount`. Pure functions, no Agent dependency. Single responsibility: derive routing from plan text.
- `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` — tests for `ultraSwarmDecision` (now ternary) and `routeFromPlanSignals`.

**Modify:**
- `packages/agent-core/src/agent/plan/ultra-swarm-decision.ts` — add `ADAPTIVE` to enum + regex.
- `packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts` — add `routing` to `UltraSwarmEngageGateData`.
- `packages/agent-core/src/agent/permission/policies/ultra-swarm-engage-gate-deny.ts` — no change needed (gate-gated by `isActive`, not decision value; ADAPTIVE still engages gate). Verification task only.
- `packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts` — `defaultMaxExperts` consults routing when tool `intensity` is omitted.
- `packages/agent-core/src/agent/injection/plan-mode.ts` — prompt instructions mention `ADAPTIVE` + `Swarm intensity`.
- `packages/agent-core/src/agent/plan/index.ts` — plan template includes intensity line.
- `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts` — `hasSwarmDecisionLine` accepts `ADAPTIVE`.
- `packages/agent-core/src/ultrawork/mirror-reconcile.ts` — regex accepts `ADAPTIVE`.
- `packages/agent-core/test/agent/permission.test.ts` — add ADAPTIVE-through-gate test case.
- `packages/protocol/src/events.ts` — add `UltraworkRoutingDecidedEvent` (4 locations).
- `apps/liora/src/tui/controllers/session-event-handler.ts` — handle `ultrawork.routing.decided`.
- `apps/liora/src/tui/components/messages/agent-swarm-progress.ts` — render routing badge in `renderMissionContent`.

---

## Task 1: Add `ADAPTIVE` to `UltraSwarmDecision` and parsing regex

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-swarm-decision.ts:3,6,9`
- Test: `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ultraSwarmDecision, ultraSwarmEngageNextAction } from '../../src/agent/plan/ultra-swarm-decision';

describe('ultraSwarmDecision', () => {
  describe('ternary decision parsing', () => {
    it('parses ENGAGE from "Swarm decision: ENGAGE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ENGAGE - multi-lane work')).toBe('ENGAGE');
    });

    it('parses DEFER from "Swarm decision: DEFER"', () => {
      expect(ultraSwarmDecision('Swarm decision: DEFER - single-owner task')).toBe('DEFER');
    });

    it('parses ADAPTIVE from "Swarm decision: ADAPTIVE"', () => {
      expect(ultraSwarmDecision('Swarm decision: ADAPTIVE - moderate complexity')).toBe('ADAPTIVE');
    });

    it('parses ADAPTIVE from a "- Decision: ADAPTIVE" field line', () => {
      expect(ultraSwarmDecision('- Decision: ADAPTIVE')).toBe('ADAPTIVE');
    });

    it('returns undefined when no decision line is present', () => {
      expect(ultraSwarmDecision('some plan without a swarm decision')).toBeUndefined();
    });

    it('is case-insensitive for ADAPTIVE', () => {
      expect(ultraSwarmDecision('Swarm decision: adaptive')).toBe('ADAPTIVE');
    });
  });

  describe('ultraSwarmEngageNextAction', () => {
    it('returns undefined for DEFER', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: DEFER')).toBeUndefined();
    });

    it('returns undefined for ADAPTIVE (next-action guidance is ENGAGE-only)', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ADAPTIVE')).toBeUndefined();
    });

    it('returns guidance string for ENGAGE', () => {
      expect(ultraSwarmEngageNextAction('Swarm decision: ENGAGE')).toContain('UltraSwarm ENGAGE is binding');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — `ultraSwarmDecision('Swarm decision: ADAPTIVE')` returns `undefined` (regex only matches ENGAGE|DEFER).

- [ ] **Step 3: Update the enum and regexes**

In `packages/agent-core/src/agent/plan/ultra-swarm-decision.ts`, change line 3 and the two regexes:

```ts
export type UltraSwarmDecision = 'ENGAGE' | 'ADAPTIVE' | 'DEFER';

export function ultraSwarmDecision(plan: string): UltraSwarmDecision | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as UltraSwarmDecision;
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as UltraSwarmDecision;
  return undefined;
}
```

Leave `ultraSwarmEngageNextAction` unchanged — its guard `if (ultraSwarmDecision(plan) !== 'ENGAGE') return undefined;` already returns `undefined` for ADAPTIVE, which the test expects.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Run existing tests that touch the decision regex to ensure no regressions**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/tools/builtin-current.test.ts test/agent/permission.test.ts`
Expected: PASS — existing ENGAGE/DEFER tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-swarm-decision.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): add ADAPTIVE to UltraSwarmDecision ternary routing"
```

---

## Task 2: Create `routeFromPlanSignals` and intensity mapping module

**Files:**
- Create: `packages/agent-core/src/agent/plan/ultra-swarm-routing.ts`
- Test: `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
import {
  routeFromPlanSignals,
  intensityToDefaultExpertCount,
  type SwarmRoutingIntensity,
} from '../../src/agent/plan/ultra-swarm-routing';

describe('intensityToDefaultExpertCount', () => {
  it('returns 4 for light', () => {
    expect(intensityToDefaultExpertCount('light')).toBe(4);
  });
  it('returns 12 for standard', () => {
    expect(intensityToDefaultExpertCount('standard')).toBe(12);
  });
  it('returns 24 for heavy', () => {
    expect(intensityToDefaultExpertCount('heavy')).toBe(24);
  });
});

describe('routeFromPlanSignals', () => {
  it('routes ENGAGE + heavy when plan declares both', () => {
    const plan = 'Swarm decision: ENGAGE\nSwarm intensity: heavy';
    const result = routeFromPlanSignals(plan);
    expect(result.decision).toBe('ENGAGE');
    expect(result.intensity).toBe('heavy');
    expect(result.estimatedExperts).toBe(24);
  });

  it('routes ADAPTIVE + standard by default for ADAPTIVE without explicit intensity', () => {
    const plan = 'Swarm decision: ADAPTIVE - moderate';
    const result = routeFromPlanSignals(plan);
    expect(result.decision).toBe('ADAPTIVE');
    expect(result.intensity).toBe('standard');
    expect(result.estimatedExperts).toBe(12);
  });

  it('routes DEFER with light intensity and 0 experts', () => {
    const plan = 'Swarm decision: DEFER - single-owner task';
    const result = routeFromPlanSignals(plan);
    expect(result.decision).toBe('DEFER');
    expect(result.intensity).toBe('light');
    expect(result.estimatedExperts).toBe(0);
  });

  it('defaults ENGAGE to heavy when intensity line is absent', () => {
    const plan = 'Swarm decision: ENGAGE - multi-lane';
    const result = routeFromPlanSignals(plan);
    expect(result.intensity).toBe('heavy');
  });

  it('respects explicit Swarm intensity even for ADAPTIVE', () => {
    const plan = 'Swarm decision: ADAPTIVE\nSwarm intensity: light';
    const result = routeFromPlanSignals(plan);
    expect(result.intensity).toBe('light');
    expect(result.estimatedExperts).toBe(4);
  });

  it('returns undefined when plan has no decision line', () => {
    expect(routeFromPlanSignals('no decision here')).toBeUndefined();
  });

  it('always provides a non-empty rationale', () => {
    const result = routeFromPlanSignals('Swarm decision: ADAPTIVE');
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — module `../../src/agent/plan/ultra-swarm-routing` does not exist.

- [ ] **Step 3: Create the routing module**

Create `packages/agent-core/src/agent/plan/ultra-swarm-routing.ts`:

```ts
import { ultraSwarmDecision } from './ultra-swarm-decision';

export type SwarmRoutingIntensity = 'light' | 'standard' | 'heavy';

export interface SwarmRoutingResult {
  readonly decision: 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
  readonly intensity: SwarmRoutingIntensity;
  readonly estimatedExperts: number;
  readonly rationale: string;
}

const INTENSITY_REGEX = /\bswarm intensity\s*:\s*(light|standard|heavy)\b/i;

const INTENSITY_EXPERT_COUNT: Record<SwarmRoutingIntensity, number> = {
  light: 4,
  standard: 12,
  heavy: 24,
};

export function intensityToDefaultExpertCount(intensity: SwarmRoutingIntensity): number {
  return INTENSITY_EXPERT_COUNT[intensity];
}

const DEFAULT_INTENSITY_BY_DECISION = {
  ENGAGE: 'heavy' as const,
  ADAPTIVE: 'standard' as const,
  DEFER: 'light' as const,
};

const RATIONALE_BY_DECISION = {
  ENGAGE: 'Multi-lane or review-heavy work warrants a full specialist swarm.',
  ADAPTIVE: 'Moderate complexity: a scaled-down swarm with focused specialists.',
  DEFER: 'Single-owner or deterministic task; a single agent suffices.',
};

export function routeFromPlanSignals(plan: string): SwarmRoutingResult | undefined {
  const decision = ultraSwarmDecision(plan);
  if (decision === undefined) return undefined;

  const explicitIntensityMatch = INTENSITY_REGEX.exec(plan);
  const intensity =
    explicitIntensityMatch?.[1] !== undefined
      ? (explicitIntensityMatch[1].toLowerCase() as SwarmRoutingIntensity)
      : DEFAULT_INTENSITY_BY_DECISION[decision];

  const estimatedExperts = decision === 'DEFER' ? 0 : intensityToDefaultExpertCount(intensity);
  const rationale = RATIONALE_BY_DECISION[decision];

  return { decision, intensity, estimatedExperts, rationale };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-swarm-routing.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): add routeFromPlanSignals routing module with intensity mapping"
```

---

## Task 3: Add `routing` to `UltraSwarmEngageGateData`

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts:3-6`
- Test: `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
import { UltraSwarmEngageGate, type UltraSwarmEngageGateData } from '../../src/agent/plan/ultra-swarm-engage-gate';
import type { Agent } from '../../src/agent';

function createMockAgent(): { agent: Agent; logs: unknown[] } {
  const logs: unknown[] = [];
  const agent = { records: { logRecord: (record: unknown) => logs.push(record) } } as unknown as Agent;
  return { agent, logs };
}

describe('UltraSwarmEngageGate routing field', () => {
  it('engages with a routing result and exposes it via data()', () => {
    const { agent, logs } = createMockAgent();
    const gate = new UltraSwarmEngageGate(agent);
    const input: UltraSwarmEngageGateData = {
      planPath: '/tmp/plan.md',
      reason: 'multi-lane',
      routing: {
        decision: 'ADAPTIVE',
        intensity: 'standard',
        estimatedExperts: 12,
        rationale: 'Moderate complexity',
      },
    };
    gate.engage(input);
    expect(gate.isActive).toBe(true);
    expect(gate.data()?.routing?.decision).toBe('ADAPTIVE');
    expect(gate.data()?.routing?.estimatedExperts).toBe(12);
    expect(logs).toContainEqual(expect.objectContaining({ type: 'ultra_swarm_engage_gate.set' }));
  });

  it('engages without routing (backward compatible)', () => {
    const { agent } = createMockAgent();
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({ planPath: '/tmp/plan.md' });
    expect(gate.data()?.routing).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — `UltraSwarmEngageGateData` has no `routing` property; `gate.data()?.routing` is a type error.

- [ ] **Step 3: Add the `routing` field to the data interface**

In `packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts`, update the import and interface (lines 1-6):

```ts
import type { Agent } from '..';
import type { SwarmRoutingResult } from './ultra-swarm-routing';

export interface UltraSwarmEngageGateData {
  readonly planPath?: string;
  readonly reason?: string;
  readonly routing?: SwarmRoutingResult;
}
```

The `engage()` method already spreads `...input` into `logRecord` and calls `restoreEngage(input)`, so no body changes are needed — the optional `routing` field flows through automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): thread routing result through UltraSwarmEngageGateData"
```

---

## Task 4: Verify deny policy admits ADAPTIVE through the engage gate

**Files:**
- Test: `packages/agent-core/test/agent/permission.test.ts` (extend the `:862` describe block)

The deny policy (`ultra-swarm-engage-gate-deny.ts`) gates on `isActive`, not on the decision value. ADAPTIVE still calls `engage()` → gate becomes active → UltraSwarm allowed, other tools denied. This task verifies that assumption holds.

- [ ] **Step 1: Write the failing test**

In `packages/agent-core/test/agent/permission.test.ts`, inside the `Simple permission policy direct behavior` describe block (near line 935, after the existing `'allows CreateGoal and GetGoal through an active ENGAGE gate'` test), add:

```ts
it('allows UltraSwarm through an active gate regardless of decision value (ADAPTIVE)', () => {
  const agent = {
    ultraSwarmEngageGate: { isActive: true },
  } as unknown as Agent;
  const policy = new UltraSwarmEngageGateDenyPermissionPolicy(agent);

  expect(
    policy.evaluate(hookContext({ id: 'call_swarm', toolName: 'UltraSwarm' })),
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it passes (no implementation change expected)**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/permission.test.ts`
Expected: PASS immediately — the policy already returns `undefined` (allow) for `toolName === 'UltraSwarm'`. This is a regression guard confirming ADAPTIVE needs no deny-policy change.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/test/agent/permission.test.ts
git commit -m "test(ultra-swarm): guard ADAPTIVE-through-gate deny policy behavior"
```

---

## Task 5: Update plan prompt, template, and validators to accept `ADAPTIVE` + intensity

**Files:**
- Modify: `packages/agent-core/src/agent/injection/plan-mode.ts:275-277`
- Modify: `packages/agent-core/src/agent/plan/index.ts:267`
- Modify: `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts:448-449,518,520`
- Modify: `packages/agent-core/src/ultrawork/mirror-reconcile.ts:16`

- [ ] **Step 1: Read the exact current strings to replace**

Run these to see current content:
- `rg -n "Swarm decision: ENGAGE\|DEFER" packages/agent-core/src/agent/injection/plan-mode.ts`
- `rg -n "Swarm decision" packages/agent-core/src/agent/plan/index.ts`
- `rg -n "swarm decision" packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`
- `rg -n "Swarm decision" packages/agent-core/src/ultrawork/mirror-reconcile.ts`

- [ ] **Step 2: Update the plan-mode injection instructions**

In `packages/agent-core/src/agent/injection/plan-mode.ts`, find the Write Phase instruction containing `Swarm decision: ENGAGE|DEFER` (around line 276) and replace it with:

```ts
Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: `Swarm decision: ENGAGE|ADAPTIVE|DEFER - <reason>; Swarm intensity: light|standard|heavy; value: <specialist value or none>; owner: <verification owner>`
Prefer ENGAGE for multi-lane or review-heavy work. Use ADAPTIVE for moderate single-domain tasks (fewer specialists). DEFER needs `Swarm DEFER waiver:` for deterministic single-owner tasks.
```

- [ ] **Step 3: Update the plan template**

In `packages/agent-core/src/agent/plan/index.ts` (around line 267), find the template string containing `Swarm decision:` and add an intensity line after it. The template's Swarm Decision section should become:

```ts
const template = `# Ultra Plan\n\n## Seed Spec\n...\n\n## Swarm Decision\nSwarm decision: \n- Decision: \n- Swarm intensity: \n- Reason: \n- Specialist value: \n- Candidate experts: \n- Verification owner: \n- Swarm DEFER waiver: \n...`;
```

(Add `- Swarm intensity: ` as a new bullet. Preserve the rest of the template exactly — only insert this one line after `- Decision: `.)

- [ ] **Step 4: Update `hasSwarmDecisionLine` in exit-plan-mode.ts**

In `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`, update the regex at line ~448 to accept ADAPTIVE:

Find: `/\bswarm decision\s*:\s*(?:ENGAGE|DEFER)\b/i`
Replace with: `/\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\b/i`

Do the same for any other regex variants of this pattern in the same file (lines ~518, ~520) — replace `ENGAGE|DEFER` with `ENGAGE|ADAPTIVE|DEFER` everywhere it appears as the decision alternation. Run `rg -n "ENGAGE\|DEFER" packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts` to find all occurrences and confirm none are left.

- [ ] **Step 5: Update mirror-reconcile.ts regex**

In `packages/agent-core/src/ultrawork/mirror-reconcile.ts` line ~16, find:

`/Swarm decision:\s*(ENGAGE|DEFER)/i`

Replace with:

`/Swarm decision:\s*(ENGAGE|ADAPTIVE|DEFER)/i`

- [ ] **Step 6: Run the full agent-core test suite to verify no regressions**

Run: `pnpm --filter @superliora/agent-core exec vitest run`
Expected: PASS — all existing tests green (the regex broadening is additive; no previously-matched string stops matching).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/agent/injection/plan-mode.ts packages/agent-core/src/agent/plan/index.ts packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts packages/agent-core/src/ultrawork/mirror-reconcile.ts
git commit -m "feat(ultra-swarm): accept ADAPTIVE decision and Swarm intensity across plan pipeline"
```

---

## Task 6: Connect `defaultMaxExperts` to routing intensity

**Files:**
- Modify: `packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts:1199-1202`

The UltraSwarm tool's `defaultMaxExperts(intensity)` currently returns 24 for everything except `max`. We extend it to consult the engage gate's `routing.estimatedExperts` when the caller does not pass an explicit tool `intensity`.

- [ ] **Step 1: Read the caller of `defaultMaxExperts`**

Run: `rg -n "defaultMaxExperts" packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts`
Inspect the call site to see how the agent and gate are accessible at that point.

- [ ] **Step 2: Add a test for routing-aware default**

Append to `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
import { resolveMaxExperts } from '../../src/tools/builtin/collaboration/ultra-swarm';

describe('resolveMaxExperts', () => {
  it('returns MAX when tool intensity is max', () => {
    expect(resolveMaxExperts('max', undefined, undefined)).toBe(128);
  });

  it('returns routing.estimatedExperts when tool intensity is omitted and routing exists', () => {
    expect(resolveMaxExperts(undefined, { estimatedExperts: 4 }, undefined)).toBe(4);
    expect(resolveMaxExperts(undefined, { estimatedExperts: 12 }, undefined)).toBe(12);
  });

  it('falls back to 24 when neither tool intensity nor routing is present', () => {
    expect(resolveMaxExperts(undefined, undefined, undefined)).toBe(24);
  });

  it('respects explicit max_experts override over routing', () => {
    expect(resolveMaxExperts(undefined, { estimatedExperts: 24 }, 8)).toBe(8);
  });

  it('treats balanced/premium as explicit (ignores routing)', () => {
    expect(resolveMaxExperts('balanced', { estimatedExperts: 4 }, undefined)).toBe(24);
    expect(resolveMaxExperts('premium', { estimatedExperts: 4 }, undefined)).toBe(24);
  });
});
```

Note: `MAX_ULTRA_SWARM_SUBAGENTS` is 128 (`ultra-swarm.ts:70`). `resolveMaxExperts` is a new pure helper extracted from `defaultMaxExperts`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — `resolveMaxExperts` is not exported.

- [ ] **Step 4: Add `resolveMaxExperts` and refactor `defaultMaxExperts`**

In `packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts`, replace the `defaultMaxExperts` function (lines 1199-1202) with:

```ts
export function resolveMaxExperts(
  toolIntensity: UltraSwarmToolInput['intensity'] | undefined,
  routing: { readonly estimatedExperts: number } | undefined,
  explicitMax: number | undefined,
): number {
  if (explicitMax !== undefined) return Math.min(explicitMax, MAX_ULTRA_SWARM_SUBAGENTS);
  if (toolIntensity === 'max') return MAX_ULTRA_SWARM_SUBAGENTS;
  if (toolIntensity === undefined && routing !== undefined) {
    return Math.max(1, Math.min(routing.estimatedExperts, MAX_ULTRA_SWARM_SUBAGENTS));
  }
  return 24;
}
```

Then find the existing call site of `defaultMaxExperts(args.intensity)` (search `rg -n "defaultMaxExperts(" packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts`) and replace it with:

```ts
const maxExperts = resolveMaxExperts(
  args.intensity,
  this.agent.ultraSwarmEngageGate?.data()?.routing,
  args.max_experts,
);
```

Remove the old `defaultMaxExperts` function (it is fully superseded). If other tests reference `defaultMaxExperts`, update them to call `resolveMaxExperts` — run `rg -n "defaultMaxExperts" packages/agent-core/test/` to check.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS — all `resolveMaxExperts` tests green.

- [ ] **Step 6: Run the UltraSwarm tool tests to verify the call-site refactor**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/tools/builtin-current.test.ts`
Expected: PASS — existing UltraSwarm tests still green (they either pass `intensity` explicitly or have no gate routing, both of which fall back to 24).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): resolveMaxExperts respects routing intensity for staffing"
```

---

## Task 7: Add DEFER override escape hatch

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-swarm-routing.ts`
- Test: `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` (extend)

The spec (Section 1.4) requires that when routing decides `DEFER`, a user can still force a swarm via a `--swarm` flag or prompt keyword. This is the escape hatch so DEFER is never a dead end.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
describe('routeFromPlanSignals DEFER override', () => {
  it('upgrades DEFER to ADAPTIVE when "--swarm" flag is present', () => {
    const plan = 'Swarm decision: DEFER - single-owner\n--swarm';
    const result = routeFromPlanSignals(plan);
    expect(result.decision).toBe('ADAPTIVE');
    expect(result.intensity).toBe('standard');
    expect(result.estimatedExperts).toBe(12);
  });

  it('upgrades DEFER when "force swarm" keyword is present (case-insensitive)', () => {
    const plan = 'Swarm decision: DEFER\nForce Swarm: yes';
    const result = routeFromPlanSignals(plan);
    expect(result.decision).toBe('ADAPTIVE');
  });

  it('does not change ENGAGE/ADAPTIVE when flag is present (no downgrade)', () => {
    expect(routeFromPlanSignals('Swarm decision: ENGAGE\n--swarm')?.decision).toBe('ENGAGE');
    expect(routeFromPlanSignals('Swarm decision: ADAPTIVE\n--swarm')?.decision).toBe('ADAPTIVE');
  });

  it('override does not trigger when no DEFER decision exists', () => {
    expect(routeFromPlanSignals('no decision\n--swarm')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — DEFER is not upgraded.

- [ ] **Step 3: Add the override logic**

In `packages/agent-core/src/agent/plan/ultra-swarm-routing.ts`, update `routeFromPlanSignals` to check for the override flag before returning. Add a constant and modify the function:

```ts
const SWARM_OVERRIDE_REGEX = /--swarm|force swarm\s*:\s*yes\b/i;

export function routeFromPlanSignals(plan: string): SwarmRoutingResult | undefined {
  const decision = ultraSwarmDecision(plan);
  if (decision === undefined) return undefined;

  const explicitIntensityMatch = INTENSITY_REGEX.exec(plan);
  const intensity =
    explicitIntensityMatch?.[1] !== undefined
      ? (explicitIntensityMatch[1].toLowerCase() as SwarmRoutingIntensity)
      : DEFAULT_INTENSITY_BY_DECISION[decision];

  // Escape hatch: a DEFER can be upgraded to a scaled-down ADAPTIVE swarm
  // when the user explicitly forces it via --swarm / "Force Swarm: yes".
  const effectiveDecision = decision === 'DEFER' && SWARM_OVERRIDE_REGEX.test(plan)
    ? 'ADAPTIVE'
    : decision;

  const effectiveIntensity = effectiveDecision === 'ADAPTIVE' && decision === 'DEFER'
    ? 'standard'
    : intensity;

  const estimatedExperts = effectiveDecision === 'DEFER'
    ? 0
    : intensityToDefaultExpertCount(effectiveIntensity);
  const rationale = RATIONALE_BY_DECISION[effectiveDecision];

  return {
    decision: effectiveDecision,
    intensity: effectiveIntensity,
    estimatedExperts,
    rationale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-swarm-routing.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): add DEFER override escape hatch via --swarm flag"
```

---

## Task 8: Add `ultrawork.routing.decided` protocol event

**Files:**
- Modify: `packages/protocol/src/events.ts` (4 locations: interface, union, schema, discriminatedUnion)

- [ ] **Step 1: Read the existing ultrawork event block to mirror exactly**

Read `packages/protocol/src/events.ts` lines 412-481 (interfaces), 780-837 (union), 1211-1280 (schemas), 1573-1609 (discriminatedUnion array). Use `UltraworkTeamStaffedEvent` as the template.

- [ ] **Step 2: Add the interface**

In `packages/protocol/src/events.ts`, after the `UltraworkTeamStaffedEvent` interface (around line 444), add:

```ts
export interface UltraworkRoutingDecidedEvent {
  readonly type: 'ultrawork.routing.decided';
  readonly runId: string;
  readonly toolCallId?: string;
  readonly decision: 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
  readonly intensity: 'light' | 'standard' | 'heavy';
  readonly estimatedExperts: number;
  readonly rationale: string;
}
```

- [ ] **Step 3: Add to the `AgentEvent` union**

In the `AgentEvent` union (around line 792-802, where other `Ultrawork*Event` entries are), add `| UltraworkRoutingDecidedEvent` next to `UltraworkTeamStaffedEvent`.

- [ ] **Step 4: Add the zod schema**

After `ultraworkTeamStaffedEventSchema` (around line 1243), add:

```ts
export const ultraworkRoutingDecidedEventSchema = z.object({
  type: z.literal('ultrawork.routing.decided'),
  runId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  decision: z.enum(['ENGAGE', 'ADAPTIVE', 'DEFER']),
  intensity: z.enum(['light', 'standard', 'heavy']),
  estimatedExperts: z.number().int().min(0),
  rationale: z.string().min(1),
}) satisfies z.ZodType<UltraworkRoutingDecidedEvent>;
```

- [ ] **Step 5: Register in the discriminatedUnion**

In the `agentEventSchema = z.discriminatedUnion('type', [...])` array (around line 1584-1594), add `ultraworkRoutingDecidedEventSchema,` next to `ultraworkTeamStaffedEventSchema,`.

- [ ] **Step 6: Build protocol package to verify the schema compiles**

Run: `pnpm --filter @superliora/protocol run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/events.ts
git commit -m "feat(protocol): add ultrawork.routing.decided event"
```

---

## Task 9: Emit `ultrawork.routing.decided` when the engage gate fires

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts` (engage method)
- Test: `packages/agent-core/test/agent/ultra-swarm-decision.test.ts` (extend)

- [ ] **Step 1: Read how the gate accesses the agent's event emitter**

Run: `rg -n "emitEvent|agent\.emit" packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts packages/agent-core/src/agent/index.ts | head -20`
Confirm `this.agent.emitEvent(...)` is the emit API (used elsewhere in the agent).

- [ ] **Step 2: Write the failing test**

Append to `packages/agent-core/test/agent/ultra-swarm-decision.test.ts`:

```ts
describe('UltraSwarmEngageGate emits routing event', () => {
  it('emits ultrawork.routing.decided when engaging with routing', () => {
    const logs: unknown[] = [];
    const events: unknown[] = [];
    const agent = {
      records: { logRecord: (record: unknown) => logs.push(record) },
      emitEvent: (event: unknown) => events.push(event),
      homedir: undefined,
      type: 'main',
    } as unknown as Agent;
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({
      planPath: '/tmp/plan.md',
      routing: {
        decision: 'ADAPTIVE',
        intensity: 'standard',
        estimatedExperts: 12,
        rationale: 'moderate',
      },
    });
    const routingEvent = events.find(
      (e) => (e as { type: string }).type === 'ultrawork.routing.decided',
    );
    expect(routingEvent).toBeDefined();
    expect((routingEvent as { decision: string }).decision).toBe('ADAPTIVE');
  });

  it('does not emit when engaging without routing (backward compatible)', () => {
    const logs: unknown[] = [];
    const events: unknown[] = [];
    const agent = {
      records: { logRecord: (record: unknown) => logs.push(record) },
      emitEvent: (event: unknown) => events.push(event),
      homedir: undefined,
      type: 'main',
    } as unknown as Agent;
    const gate = new UltraSwarmEngageGate(agent);
    gate.engage({ planPath: '/tmp/plan.md' });
    const routingEvent = events.find(
      (e) => (e as { type: string }).type === 'ultrawork.routing.decided',
    );
    expect(routingEvent).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: FAIL — no event emitted.

- [ ] **Step 4: Add the emit to `engage()`**

In `packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts`, update the `engage` method to emit when routing is present:

```ts
engage(input: UltraSwarmEngageGateData): void {
  this.agent.records.logRecord({
    type: 'ultra_swarm_engage_gate.set',
    ...input,
  });
  this.restoreEngage(input);
  if (input.routing !== undefined) {
    this.agent.emitEvent({
      type: 'ultrawork.routing.decided',
      runId: '',
      decision: input.routing.decision,
      intensity: input.routing.intensity,
      estimatedExperts: input.routing.estimatedExperts,
      rationale: input.routing.rationale,
    });
  }
}
```

Note: `runId` and `toolCallId` are left to the caller layer if needed; the gate emits with an empty `runId` since it does not own run identity. If `AgentEvent` requires `runId` to be non-empty in practice, instead omit the emit when no run context is available and have the UltraSwarm tool emit the event with the real `runId` after gate engagement. Verify by reading how other events without a runId are emitted — if none exist, move the emit to the UltraSwarm tool's `execute` method where `runId` is known.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-swarm-decision.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts packages/agent-core/test/agent/ultra-swarm-decision.test.ts
git commit -m "feat(ultra-swarm): emit ultrawork.routing.decided on engage gate activation"
```

---

## Task 10: Render routing badge in the TUI swarm progress header

**Files:**
- Modify: `apps/liora/src/tui/components/messages/agent-swarm-progress.ts:713-723`
- Modify: `apps/liora/src/tui/controllers/session-event-handler.ts:314-337`

- [ ] **Step 1: Add a field to store routing on the swarm progress component**

In `packages/agent-core`... no — the component is in `apps/liora`. In `apps/liora/src/tui/components/messages/agent-swarm-progress.ts`, find the class fields near the top of `AgentSwarmProgressComponent` (search `rg -n "private description" apps/liora/src/tui/components/messages/agent-swarm-progress.ts`). Add a new field:

```ts
private routingBadge: string | undefined;
```

Add a public setter method near the other apply* methods (search `rg -n "applySwarmCollaborationMessage" apps/liora/src/tui/components/messages/agent-swarm-progress.ts` for the pattern):

```ts
applyRoutingDecision(routing: {
  readonly decision: string;
  readonly intensity: string;
  readonly estimatedExperts: number;
}): void {
  this.routingBadge = `${routing.decision} · ${routing.intensity}`;
  this.invalidate();
}
```

- [ ] **Step 2: Render the badge in `renderMissionContent`**

In `apps/liora/src/tui/components/messages/agent-swarm-progress.ts`, find `renderMissionContent` (around line 713-723). After `const headlineParts = [title];` (around line 719), insert the badge before the description push:

```ts
private renderMissionContent(width: number, summary: AgentSwarmSummary | undefined): string[] {
  const title = renderAnimatedGradientText(this.title, `agent-swarm:title:${this.title}`);
  const description = this.description.length > 0
    ? chalk.hex(this.colors.text)(this.description)
    : '';
  const stats = summary === undefined ? '' : this.renderMissionStats(summary);
  const headlineParts = [title];
  if (this.routingBadge !== undefined) {
    headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${chalk.hex(this.colors.primary)(this.routingBadge)}`);
  }
  if (description.length > 0) headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${description}`);
  if (stats.length > 0) headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${stats}`);
  return [truncateToWidth(headlineParts.join(' '), width)];
}
```

- [ ] **Step 3: Route the event in `session-event-handler.ts`**

In `apps/liora/src/tui/controllers/session-event-handler.ts`, the `handleUltraworkEvent` method (around line 314-337) handles ultrawork events. But `ultrawork.routing.decided` may not be part of `UltraworkTheatreEvent` union yet. First check: run `rg -n "ultrawork.routing.decided" apps/liora/src/tui/`. If the event is not routed at all, add handling.

In `session-event-handler.ts`, inside `handleUltraworkEvent` (or in `handleEvent` if routing.decided is not a theatre event), add:

```ts
if (event.type === 'ultrawork.routing.decided') {
  for (const progress of this.subAgentEventHandler.agentSwarmProgress.values()) {
    progress.applyRoutingDecision({
      decision: event.decision,
      intensity: event.intensity,
      estimatedExperts: event.estimatedExperts,
    });
  }
}
```

Check whether `ultrawork.routing.decided` must be added to the `UltraworkTheatreEvent` union (`apps/liora/src/tui/components/messages/ultrawork-theatre.ts:35-51`) for it to reach `handleUltraworkEvent`. If `isUltraworkTheatreEvent` is the only entry to `handleUltraworkEvent` and the new event type is not in that union, add `'ultrawork.routing.decided'` to the `Extract` union and `ULTRAWORK_THEATRE_EVENT_TYPES` set, OR handle it directly in `handleEvent` before the theatre guard. Prefer handling in `handleEvent` directly since routing is not a theatre-rendered event:

```ts
// In handleEvent, before the isUltraworkTheatreEvent guard:
if (event.type === 'ultrawork.routing.decided') {
  this.subAgentEventHandler.agentSwarmProgress.forEach((progress) => {
    progress.applyRoutingDecision({
      decision: event.decision,
      intensity: event.intensity,
      estimatedExperts: event.estimatedExperts,
    });
  });
  requestTUILayoutRender(this.host.state);
  return;
}
```

- [ ] **Step 4: Verify the TUI type-checks and builds**

Run: `pnpm -C apps/liora run build`
Expected: build succeeds. If `event.decision`/`event.intensity` are not typed, the protocol package build from Task 7 must be consumed first — run `pnpm run build` at repo root if needed.

- [ ] **Step 5: Run TUI tests**

Run: `pnpm --filter liora exec vitest run test/tui/`
Expected: PASS — no regressions in existing TUI tests.

- [ ] **Step 6: Commit**

```bash
git add apps/liora/src/tui/components/messages/agent-swarm-progress.ts apps/liora/src/tui/controllers/session-event-handler.ts
git commit -m "feat(tui): render routing decision badge in UltraSwarm progress header"
```

---

## Task 11: Full build, import check, and smoke verification

**Files:** none (verification only)

This task enforces the Install & Release Verification requirements from `AGENTS.md` (changes touch `packages/agent-core`, `packages/protocol`, and the `apps/liora` bundle graph).

- [ ] **Step 1: Full monorepo build**

Run: `pnpm run build`
Expected: succeeds, including `@superliora/sdk` declaration emit.

- [ ] **Step 2: Import check**

Run: `pnpm run check:imports`
Expected: no mistyped workspace package names.

- [ ] **Step 3: CLI bundle build + guard**

Run: `pnpm -C apps/liora run build`
Expected: succeeds, `check-cli-bundle.mjs` passes (no runtime `@superliora/*` imports in `dist/main.mjs`).

- [ ] **Step 4: CLI smoke test**

Run: `pnpm -C apps/liora run smoke`
Expected: `liora --version` and `liora --help` run successfully.

- [ ] **Step 5: Run the full agent-core test suite one final time**

Run: `pnpm --filter @superliora/agent-core exec vitest run`
Expected: all green.

- [ ] **Step 6: If all green, the milestone is complete — proceed to changeset**

Do not commit in this task (nothing to commit — verification only). If any check fails, fix the specific issue and re-run.

---

## Task 12: Generate changeset

**Files:**
- Create: `.changeset/ultraswarm-routing-gate.md`

- [ ] **Step 1: Invoke the gen-changesets skill**

This milestone touches `@superliora/agent-core`, `@superliora/protocol`, and `@superliora/liora`. Follow the gen-changesets skill (`.agents/skills/gen-changesets/SKILL.md`) to determine bump levels. The change is additive (new `ADAPTIVE` decision, new event, new routing field) with no breaking removal — default to `minor` unless the skill's rules indicate otherwise. Never write `major` without explicit user confirmation.

- [ ] **Step 2: Write the changeset**

Create `.changeset/ultraswarm-routing-gate.md` with entries for `@superliora/agent-core`, `@superliora/protocol`, and `@superliora/liora`, summarizing: ternary routing decision (ENGAGE/ADAPTIVE/DEFER), intensity-driven expert count, `ultrawork.routing.decided` event, and TUI routing badge. Use neutral, non-slop English prose per the no-ai-slop skill.

- [ ] **Step 3: Commit the changeset**

```bash
git add .changeset/ultraswarm-routing-gate.md
git commit -m "chore: add changeset for ultraswarm routing gate"
```
