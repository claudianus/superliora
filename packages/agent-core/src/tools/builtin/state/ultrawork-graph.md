Use this tool to maintain the durable Ultrawork WorkGraph: the AC/work ledger that backs the live TodoList board during Ultrawork execution.

**When to use:**
- After UltraPlan has produced Seed Spec, AC Tree, Evaluation Plan, and Execution Plan.
- When an acceptance criterion or coverage lane becomes executable work.
- When a WorkGraph node changes owner, status, evidence, dependency, or verification state.
- Before invoking UltraSwarm with `work_node_ids`.

**How it works:**
- Call with no arguments to read the current WorkGraph.
- Call with `run_id`, optional `graph_id`, optional `root_goal`, and `nodes` to replace the full graph.
- `sync_todos` defaults to true. When enabled, TodoList becomes a live Kanban view of the WorkGraph.
- TodoList cards are derived from nodes and titled `[nodeId] title`.

**Rules:**
- Keep node ids stable and short, such as `ac_1`, `research_1`, or `verify_2`.
- Every node must be independently checkable and tied to an AC, lane, owner, or required evidence when possible.
- Do not mark a node `done` until its evidence and verification status justify it.
- Do not use WorkGraph as prose storage; use it as the execution ledger.
