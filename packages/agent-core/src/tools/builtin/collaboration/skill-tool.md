Invoke one registered skill by exact name. Use `SearchSkill` first when you need discovery, then call this tool with the exact candidate name. Direct user slash activation may also load a skill.

Loaded skills are reference material, not mandatory scripts. Apply only parts that clearly help quality for this task; skip the rest. Do not re-invoke a skill to repeat work already done: if a `<kimi-skill-loaded>` block for it with the same `args` is already present, reuse it. Call again only when you need the skill with different arguments.
