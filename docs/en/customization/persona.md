# Persona presets

Persona controls how the **main agent** talks: tone, personality, and optional custom instructions. It stacks on top of the active agent profile; it does not change tools or sub-agent personas.

## Quick start

1. Open the Command Hub (`Ctrl-K` / `Ctrl-Space` / `?`) or Settings → Persona.
2. Choose **Presets…** and pick a named pack (Efficient, Mentor, Reviewer, Caveman, ADHD, …).
3. The session reloads so the new block applies immediately.

Slash shortcuts:

```text
/persona list
/persona set efficient
/persona clear
```

## What a preset does

Selecting a preset is **atomic**: it sets the preset id and clears custom tone / personality / instructions overrides. Some presets also enable related skills in `~/.superliora/skills-state.json` (listed skills only — other toggles stay as they were). Clearing persona removes `[persona]` from `config.toml` but does not undo skill toggles.

**Caveman** and **ADHD** ship with matching built-in skills (vendored from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) and [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), both MIT). The bundle re-enables them if you disabled them; the preset still applies its prompt lines with the skills off. Invoke the full rule sets any time with `/caveman` and `/i-have-adhd`.

Legacy `concise` in config is treated as `efficient`.

## Default persona

With no `[persona]` in `config.toml`, the built-in **Liora** preset applies — concise, plain-spoken, and teaches while helping. Pick another preset to switch, or set `preset = "none"` to disable personas entirely.

## Advanced overrides

Settings → Persona still lets you edit display name, tone, personality, and free-form instructions after a preset. Those override the matching preset lines in the system prompt.

## Settings presets elsewhere

Many Settings panes now start with **Presets…** (appearance packs, compaction, skills packs, media, search, telemetry, mission, editor/notifications, harness profile, …). Account panes such as Usage stay action/status hubs without named packs.

## Related

- [Agents and sub-agents](./agents.md) — profiles and tool waist (separate from persona)
- [Agent Skills](./skills.md) — skill enable/disable and slash activation
