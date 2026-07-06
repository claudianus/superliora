Launch multiple subagents from one `prompt_template` with `{{item}}`, `resume_agent_ids`, or both.

Use when the same task shape applies to many inputs. For few different tasks, use separate `Agent` calls.

Enforced before launch: at least 2 `items` unless resuming; `prompt_template` required with `{{item}}` when `items` present; filled prompts must be distinct.

Up to 128 subagents, queued. Each item maps to one parent orchestration TodoList card (`[swarm] {item}`). Each subagent must maintain a live TodoList for its scope — create the board within the first 2 tool calls and update after major progress.

Each subagent may use WebSearch and FetchURL as much as needed unless forbidden — return source URLs for findings that affect implementation. If called, AgentSwarm must be the only tool in the response.
