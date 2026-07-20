---
'@superliora/liora': patch
---

Harden the Ultrawork harness: open-ended improvement-loop prompts ("keep improving forever", "무한정 고쳐") no longer silently auto-activate Ultrawork; the ENGAGE gate now lets read-only inspection Bash (ls, cat, git status/log/diff, and pipes of allowlisted commands) through instead of forcing an approval round trip; ExitPlanMode accepts Korean Ultra Plan headings, field labels, and WorkGraph table labels (워크그래프, 단계, 의존성, 필요 증거, …) alongside English; and UltraworkGraph normalizes stage synonyms (implement/implementation/review → swarm) at the tool boundary and in plan-table parsing, so canonical stages reach the graph unchanged.
