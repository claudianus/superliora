# Expert Agents & UltraSwarm Plan

## Overview

Integrate 275+ expert personas from the agency-agents repository into the existing SuperLiora skill system using embedding-based search to avoid token/context window explosion, and build an UltraSwarm orchestrator that automatically assembles expert teams.

## Key Design Decisions

1. **Embedding-based skill search**: Instead of injecting all 275 expert personas into the system prompt, we leverage the existing skill system's metadata and embedding search capabilities to dynamically select only the top-k relevant experts for a given task.

2. **Expert personas as builtin skills**: The 275 agency-agents personas are converted into `expert`-type builtin skills at build time, with pre-computed embeddings stored alongside them.

3. **UltraSwarm orchestrator**: A new swarm orchestrator that uses the main agent's LLM to analyze tasks, perform embedding search to select experts, and coordinate their execution via the existing `SubagentBatch` system.

4. **Full product branding**: `/ultraswarm` command in CLI/TUI, expert summon indicators, and a dedicated TUI status surface.

## Implementation Phases

### Phase 1: Expert Persona Skill Conversion (Build-time)
- Parse all 275+ agency-agents markdown files (YAML frontmatter + body)
- Extract metadata: name, description, category, emoji, color, vibe, whenToUse
- Convert each persona into a `SkillDefinition` with `type: 'expert'`
- Pre-compute embeddings for each expert's description + vibe + first 500 chars of body
- Store compiled expert skills + embedding index as a TypeScript module / JSON bundle under `packages/agent-core/src/expert-agents/builtin/`
- Add a build script (`scripts/build-expert-agents.mjs`) that runs during `pnpm build` to regenerate the bundle when the source personas change

### Phase 2: Skill Registry Embedding Search (Runtime)
- Extend `SessionSkillRegistry` with an `embeddingSearch(query: string, topK: number)` method
- The registry loads the pre-computed expert embeddings at initialization
- For a given task description (or user prompt), compute an embedding and return the top-k matching expert skills by cosine similarity
- Only the top-k expert names, descriptions, and `whenToUse` are injected into the model's context, not all 275

### Phase 3: UltraSwarm Orchestrator (Agent-core)
- Create `UltraSwarmOrchestrator` class that extends the existing `AgentSwarmTool` / `SubagentBatch` flow
- Workflow:
  1. Main agent receives a task
  2. It calls `UltraSwarmOrchestrator.analyzeTask(task)` which uses the LLM to decompose the task and identify required expertise domains
  3. For each identified domain, call `embeddingSearch(domain, topK=3)` to find the best expert personas
  4. Build a `SwarmPlan` with expert assignments, dependency graph, and parallel/serial execution strategy
  5. Execute via `SubagentBatch` with each expert's full persona as the `profileName` / system prompt
  6. Collect results, synthesize, and return to the main agent
- Add a new builtin tool `UltraSwarm` (or extend `AgentSwarm`) with input schema for automatic mode

### Phase 4: CLI/TUI Branding
- Add `/ultraswarm` slash command alongside existing `/swarm`
- `UltraSwarmStartPermissionPromptComponent` for approval flow
- `UltraSwarmModeMarkerComponent` with distinct branding (e.g., `UltraSwarm activated 🔥`)
- Expert summon indicators in the transcript (show which experts were summoned and their status)
- Rename existing swarm UI labels to include UltraSwarm branding where appropriate

### Phase 5: TUI/CLI Branding
- Display summoned experts with their names, status, and compact progress in the TUI transcript
- Show the UltraSwarm plan as a terminal-friendly tree or table
- Add a CLI-readable "Auto UltraSwarm" state indicator

## Technical Details

### Embedding Strategy
- Use the same embedding provider/model as the rest of the system (kosong abstraction)
- Store embeddings as a flat Float32Array + index mapping for O(1) lookup
- Cosine similarity computed on-demand; no vector DB needed for 275 items (brute force is trivial)
- If the system already has an embedding service in `packages/kosong`, reuse it; otherwise, generate embeddings at build time using a lightweight local model (e.g., `all-MiniLM-L6-v2` via `transformers.js`) or OpenAI embedding API during build

### Expert Skill Type
```typescript
export type SkillType = 'prompt' | 'inline' | 'flow' | 'reference' | 'expert';
```
- `expert` skills are treated similarly to `flow` skills but with additional metadata: `emoji`, `color`, `category`, `vibe`
- They are NOT user-activatable via `/` commands; they are activated programmatically by the UltraSwarm orchestrator
- However, they can be explicitly summoned by the user: `@UX Architect help me design this component`

### System Prompt Impact
- The system prompt for the main agent will only contain a short instruction: "You have access to 275+ expert agents via the UltraSwarm system. When a task requires specialized expertise, the system will automatically summon the right experts."
- The actual expert details are only injected into the subagent's system prompt, not the main agent's

### Dependency Graph & Execution Strategy
- The UltraSwarm orchestrator builds a DAG of expert tasks
- Parallel tasks (no dependencies) are launched via `SubagentBatch` simultaneously
- Serial tasks wait for their dependencies
- The orchestrator monitors progress and can dynamically spawn additional experts if intermediate results suggest new expertise is needed (reflection loop)

### Testing Strategy
- Unit tests for embedding search accuracy (top-k relevance)
- Unit tests for UltraSwarm orchestrator DAG building
- Integration tests for end-to-end task decomposition and expert summoning
- E2E tests in `packages/server-e2e` for the `/ultraswarm` command

## Files to Modify / Create

### New Files
- `packages/agent-core/src/expert-agents/builtin/expert-agents.json` (generated)
- `packages/agent-core/src/expert-agents/builtin/expert-agents-embeddings.json` (generated)
- `packages/agent-core/src/expert-agents/types.ts`
- `packages/agent-core/src/expert-agents/orchestrator.ts`
- `packages/agent-core/src/expert-agents/search.ts`
- `packages/agent-core/src/expert-agents/tool.ts` (UltraSwarm builtin tool)
- `scripts/build-expert-agents.mjs`
- `apps/liora/src/tui/commands/ultraswarm.ts`
- `apps/liora/src/tui/components/dialogs/ultraswarm-start-permission-prompt.ts`
- `apps/liora/src/tui/components/messages/ultraswarm-markers.ts`

### Modified Files
- `packages/agent-core/src/skill/types.ts` (add `expert` type)
- `packages/agent-core/src/skill/registry.ts` (add embedding search)
- `packages/agent-core/src/skill/scanner.ts` (register builtin expert skills)
- `packages/agent-core/src/tools/builtin/index.ts` (export UltraSwarm tool)
- `packages/agent-core/src/tools/builtin/collaboration/agent-swarm.ts` (extend or reference)
- `packages/agent-core/src/agent/tool/index.ts` (register UltraSwarm tool)
- `packages/agent-core/src/index.ts` (export new modules)
- `apps/liora/src/tui/commands/index.ts` (register /ultraswarm)
- `apps/liora/src/tui/commands/dispatch.ts` (add /ultraswarm dispatch)
- `apps/liora/src/tui/components/index.ts` (export new components)
- `pnpm-workspace.yaml` (if new packages needed)
- `flake.nix` (sync workspace paths)

## Assumptions & Risks
- **Assumption**: The existing `SubagentBatch` and `SessionSubagentHost` can handle dynamic `profileName` selection at runtime. If not, we need to extend `subagent-host.ts` to support arbitrary expert profiles.
- **Assumption**: The build environment has network access to generate embeddings during CI. If not, we commit the pre-generated embeddings to the repo.
- **Risk**: 275 expert personas may increase bundle size. Mitigation: store only metadata + embeddings in the main bundle; full persona text is lazy-loaded or kept in the subagent profile resolution path.
- **Risk**: Embedding quality may not be perfect for all edge cases. Mitigation: allow manual expert override (`@ExpertName`) and fallback to keyword search if embedding similarity is below a threshold.

## Rollout Plan
1. Phase 1 (build-time conversion) is implemented first and can be merged independently.
2. Phase 2 (embedding search) is merged next, gated behind an experimental flag `SUPERLIORA_EXPERIMENTAL_ULTRASWARM`.
3. Phase 3 (orchestrator) follows, with the flag still on.
4. Phases 4 & 5 (TUI/CLI branding) are done in parallel with Phase 3.
5. Once E2E tests pass and dogfooding shows good results, the flag is flipped to default on.
6. Generate changeset with `minor` bump (new feature, backward compatible).
