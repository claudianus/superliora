---
name: agent-job
description: >
  SuperLiora Agent + Job* orchestration — spawn workers with the Agent tool and
  JobCreate/JobSteer/JobInbox, not catalog swarm/subagent frameworks. Use when
  splitting work across workers or running Conductor-style missions.
  Skill("agent-job").
whenToUse: >
  subagent, multi-agent, swarm, JobCreate, spawn workers — before catalog
  swarm-orchestrator / subagent-driven-development skills.
---

# SuperLiora agent-job (builtin)

Hard rule: use **Agent** and **Job\*** tools. Ignore catalog CrewAI/AutoGen/
"spawn Claude Code Task" / swarm-orchestrator playbooks for ordinary harness work.

## Happy path

1. Prefer JobCreate (+ brief/AC) when the mission needs durable workers.
2. Use Agent for focused one-shot subagents with clear success criteria.
3. Steer via JobSteer / JobInbox; verify done-claims against evidence.
4. Do not invent a parallel orchestration runtime in the workspace.
5. `greenfield_chain=true` splits contracts: skeleton = scaffold/type/lint/unit/build (no VerifySurface / 60fps / full-loop AC); fill = product AC + visual when `surface_kind=web`; delete-pass = placeholders/dead code, not a rebuild. Fill stays queued until skeleton is mechanically done.

## Do not

- `npm i` multi-agent frameworks just to split a coding task.
- Follow catalog skills that bypass Job*/Agent with shell-managed worker pools.
