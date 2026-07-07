---
name: no-ai-slop-ui
description: Anti-slop UI and visual design rules for SuperLiora harness work. Use when generating frontends, TUI chrome, landing pages, or design specs — avoid generic AI aesthetics (Inter, purple gradients, 3-card grids, centered-everything).
---

# No AI Slop — UI & Visual Design

Generic "AI product" visuals hurt trust. Name **concrete** bans and **positive** replacements.

## Hard bans (name explicitly)

- Default **Inter** / system-ui stack as the only typography story.
- **Purple/indigo gradient** heroes and mesh backgrounds as default branding.
- **Three equal card grids** for feature lists (most reflexive AI layout).
- **Centered-everything** layouts; identical `rounded-2xl` + `shadow-md` on every container.
- Floating screenshot mockups, blob SVG decorations, stock-illustration hero patterns.
- Placeholder-only geometry when the user asked for a finished surface.

## Prefer instead

- **Asymmetric splits** (60/40, 70/30); uneven visual weight.
- **One display + one body** font pairing with deliberate scale steps.
- **Surface-specific palette** tied to product domain — not default blue/purple.
- Real hierarchy: one primary action, restrained secondary actions.
- Motion/feedback only where it aids understanding.

## Prompt pattern (generation)

When briefing UI generation, include:

1. Palette clause — forbidden default colors **and** chosen replacements.
2. Layout clause — forbid 3-card grid; require asymmetric structure.
3. Typography clause — named fonts or explicit non-Inter choice.
4. **Self-audit step** — list any surviving default patterns before shipping.

Vague "don't be generic" fails; **specific** layout/class bans work because they collide with default token retrieval.

## Verification

- Screenshot or rendered-surface check before claiming visual work complete.
- For TUI: follow `write-tui` skill + theme tokens — no chalk named colors.
