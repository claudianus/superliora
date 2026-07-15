Maintain the Ultrawork WorkGraph — AC/work ledger backing TodoList during Ultrawork.

**Use:** after UltraPlan artifacts exist; when AC/lanes become executable; when node status/owner/evidence changes; before UltraSwarm with `work_node_ids`.

**API:** no args = read; `run_id` + `nodes` (+ optional `graph_id`, `root_goal`) = replace. `sync_todos` (default true) mirrors TodoList as `[nodeId] title`.

**Rules:** stable short ids (`ac_1`, `verify_2`); independently checkable nodes; `done` only with evidence; ledger not prose storage.
