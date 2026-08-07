일반 작업·칸반은 `CreateGoal`·`TodoList` 우선. 공개명은 `TaskGraph`; `UltraworkGraph`는 고급 호환 별칭.

Maintain the Mission WorkGraph — AC/work ledger backing TodoList during Mission runs.

**Use:** after Plan artifacts exist; when AC/lanes become executable or node status changes; before Fleet with `work_node_ids`.

**API:** no args = read; `run_id` + `nodes` = replace. `sync_todos` (default true) mirrors TodoList as `[nodeId] title`.

**Rules:** stable short ids (`ac_1`, `verify_2`); independently checkable nodes; `done` only with evidence.
