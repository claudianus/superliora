Post a short coordination message to the UltraSwarm team bus. Use for status updates, questions, blockers, standup notes, and @mentions of peer experts. Messages are visible to the parent agent and other staffed experts via SwarmChannel list.

Use channels:
- `standup` for brief progress snapshots
- `lane` for lane-specific coordination
- `direct` for one expert (set `to_expert_id`)
- `blocker` for urgent blockers affecting the run
- `council` for review-oriented notes

Keep messages under 500 characters. Mention peers with `@expert_id` or `@Expert Name`.

Use `artifact` to publish typed handoff artifacts (`decision`, `risk`, `patch_plan`) and emit an `artifact_ref` bus message peers can list.
