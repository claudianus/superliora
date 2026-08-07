일반 작업·칸반은 `CreateGoal`·`TodoList` 우선. 구조화된 작업 그래프가 필요할 때 `TaskGraph`.

Maintain the Mission WorkGraph — AC/work ledger backing TodoList during Mission runs.

**Use:** after Plan artifacts exist; when AC/lanes become executable or node status changes; before Fleet with `work_node_ids`.

**API:** no args = read; `run_id` + `nodes` = replace. `sync_todos` (default true) mirrors TodoList as `[nodeId] title`.

**Rules:** stable short ids (`ac_1`, `verify_2`); independently checkable nodes; `done` only with evidence.
