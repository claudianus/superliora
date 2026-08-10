# Matt Pocock skills — Conductor pin set

Harness integration prefers **Job contracts / Plan Desk / review chain** over catalog dumps.
These catalog entries are the pinned reference set (MIT, `mattpocock/skills`). Sync content
deliberately when upstream meaningfully improves the discipline; do not bulk-mirror.

| Discipline | Catalog id (approx) | Conductor binding |
|---|---|---|
| Grilling / design tree | `agentic-grilling`, `agentic-grill-with-docs` | Plan Desk ultra brief (inline SSOT) |
| TDD seams | `agentic-tdd` | `test_seams` / `tdd_mode` + worker TDD DoD |
| Diagnosing Phase 1 | `agentic-diagnosing-bugs` | debug expertRole + `repro_command` |
| Dual-axis review | (prompt-native; see `code-review` upstream) | review chain Standards∥Spec Jobs |
| Domain glossary | `agentic-domain-modeling` | CONTEXT.md hint on workers |
| Tracer tickets | `agentic-to-issues` | `blocked_by_job_ids` DAG |
| Merge conflicts | `agentic-resolving-merge-conflicts` | land-conflict resolve Job |
| Prototype | `agentic-prototype` | explore Job when title/prompt says prototype |
| Writing for agents | (upstream `writing-for-agents`) | SkillCreate quality gate |

Upstream: https://github.com/mattpocock/skills  
Pin note: integrate via harness fields first; refresh catalog bodies only for the rows above.

## Not Conductor Job ledger

`luokai-conductor-*` skills (`conductor/tracks.md` track manager) are a **separate**
tracks/file workflow. Do not confuse them with SuperLiora Conductor Jobs (`JobCreate`,
Plan Desk, MergeJob). Prefer Job ledger for orchestration.
