Launch multiple subagents from one `prompt_template` with `{{item}}`, `resume_agent_ids`, or both.

Use when the same task shape applies to many inputs. For few different tasks, use separate `Agent` calls.

Enforced before launch: at least 2 `items` unless resuming; `prompt_template` with `{{item}}` required when `items` present; filled prompts must be distinct.

Up to 128 subagents, queued. Each item maps to one parent TodoList card (`[swarm] {item}`). Each subagent keeps a live TodoList for its scope — create within the first 2 tool calls. Each subagent may use Context7Resolve/Context7Docs for library docs and WebSearch/FetchURL unless forbidden — return source URLs for findings that affect implementation. If called, AgentSwarm must be the only tool in that response.
