/**
 * Embedded premium visual reference catalog — researched 2026 sources.
 * Agents use these directly; no user request required under Premium Quality.
 */

/** Curated inspiration galleries — WebSearch/FetchURL before building when taste is uncertain. */
export const PREMIUM_VISUAL_INSPIRATION_SITES = [
  '### Design inspiration (benchmark before you build)',
  'Study 2–3 references, extract layout/motion/type patterns — do not clone pixel-for-pixel.',
  '- https://godly.website/ — hand-picked premium web (scroll/interaction videos; AI/Web3/portfolio).',
  '- https://www.awwwards.com/ — Site of the Day winners; interaction + craft bar.',
  '- https://www.landingfolio.com/ — landing sections, hero patterns, component ideas.',
  '- https://land-book.com/ — SaaS/marketing landing gallery + templates.',
  '- https://bentogrids.com/ — bento grid layouts (2026 default for feature density).',
  '- https://www.saasframe.io/ — SaaS hero, product demo, CTA patterns with examples.',
  '- https://siteinspire.com/ — editorial/minimal gallery.',
  '- https://dark.design/ — dark-mode craft references.',
  '- Live benchmarks (study, do not copy assets): Linear, Stripe, Framer, Notion marketing pages.',
].join('\n');

/** 2026 layout templates — pick one per page, adapt to subject. */
export const PREMIUM_VISUAL_LAYOUT_TEMPLATES_2026 = [
  '### Layout templates (2026 — pick one, customize to subject)',
  '1. **Bento hero** — asymmetric grid hero: 1 large visual tile + 2–4 stat/feature tiles; CSS Grid `grid-cols-12`, varied spans.',
  '2. **Split narrative** — 55/45 or 60/40: left copy stack (eyebrow → headline → proof → CTA), right product mock/video/canvas.',
  '3. **Oversized type anchor** — display headline as primary visual (72–120px tracking-tight); minimal imagery; strong single CTA.',
  '4. **Product-in-hero** — embedded interactive demo, video loop, or live widget above fold (SaaSFrame/Linear pattern).',
  '5. **Editorial stack** — serif/sans pairing, hairline rules, offset columns, magazine rhythm (not centered 3-cards).',
  '6. **Dark craft** — near-black base (#0a0a0b–#121214), one saturated accent, subtle grain overlay, glass nav.',
  '7. **Game frame** — centered viewport with bezel/shadow, glass HUD bars, themed particles — never full-bleed flat color + primitives.',
  'Banned default: centered hero + 3 equal feature cards + purple gradient CTA.',
].join('\n');

/** Embeddable photo / illustration URL patterns — reliable, no broken hotlinks. */
export const PREMIUM_VISUAL_PHOTO_CATALOG = [
  '### Photo & imagery catalog (embed directly — prefer seed for consistency)',
  '**Hero / section backgrounds** (Unsplash-sourced via Picsum — stable seeds):',
  '- Full hero: `https://picsum.photos/seed/{project-slug}-hero/1920/1080.webp`',
  '- Wide banner: `https://picsum.photos/seed/{project-slug}-banner/1600/900.webp`',
  '- Card thumb: `https://picsum.photos/seed/{project-slug}-card-{n}/800/600.webp`',
  '- Avatar grid: `https://picsum.photos/seed/{project-slug}-person-{n}/400/400.webp`',
  '**Treatment modifiers** (append to Picsum URL):',
  '- Cinematic BG: `?grayscale&blur=2` under a color overlay at 40–60% opacity.',
  '- Soft texture: `?blur=1` for depth behind glass panels.',
  '**Deterministic SVG avatars** (testimonials, users, NPCs):',
  '- `https://api.dicebear.com/10.x/notionists/svg?seed={unique-id}` — character style.',
  '- `https://api.dicebear.com/10.x/lorelei/svg?seed={unique-id}` — softer portraits.',
  '- `https://api.dicebear.com/10.x/shapes/svg?seed={unique-id}` — abstract brand marks.',
  '- `https://api.dicebear.com/10.x/initials/svg?seed={name}` — initials badges.',
  '**Rules:** one seed namespace per project; never reuse the same seed for different people; add real `alt` text.',
  '**When Picsum is too generic:** SearchSkill → workspace-imagen for subject-specific hero/icons/sprites.',
].join('\n');

/** Premium Google Font stacks — paste into HTML or @import. */
export const PREMIUM_VISUAL_FONT_STACKS = [
  '### Typography stacks (Google Fonts — load before styling)',
  '**Product / SaaS:** Outfit + JetBrains Mono',
  '  `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">`',
  '**Editorial / creative:** Newsreader + Outfit',
  '  `<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">`',
  '**Technical / devtool:** Space Grotesk + IBM Plex Mono (use once per project — avoid cross-project convergence).',
  '  `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`',
  '**Playful / game:** Fredoka + Nunito',
  '  `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">`',
  'Ban: naked Inter/Roboto/Arial/system-ui as the only stack. Pair display + body + mono for data/HUD.',
].join('\n');

/** Copy-paste component libraries for premium motion/UI. */
export const PREMIUM_VISUAL_COMPONENT_LIBRARIES = [
  '### Component libraries (copy-paste — verify package.json deps first)',
  '- https://ui.aceternity.com/ — bento grids, glare cards, hero motion, particles (landing pages).',
  '- https://magicui.design/ — beams, marquees, animated gradients, marketing sections (MIT free tier).',
  '- https://reactbits.dev/ — 110+ customizable animated components via shadcn CLI.',
  '- https://www.shadcn-ui.com/ — accessible app UI primitives; pair with motion libs for marketing.',
  '- https://tailark.com/ — high-conversion marketing blocks (4 cohesive themes).',
  'Install pattern: check Tailwind version + Framer Motion in package.json; copy component source; theme with project tokens.',
].join('\n');

/** Inline texture — zero HTTP requests. */
export const PREMIUM_VISUAL_TEXTURE_SNIPPETS = [
  '### Texture snippets (inline — add depth without image files)',
  '**Film grain overlay** (fixed pseudo-element, pointer-events:none, opacity 0.04–0.08):',
  '```css',
  '.grain::after {',
  '  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 9999; opacity: 0.05;',
  '  background-image: url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E");',
  '}',
  '```',
  '**Mesh ambient** (hero backgrounds): radial gradients at 2–3 corners + grain overlay; never flat single hex fill on large areas.',
].join('\n');

/** Lovable/v0-style vibe keywords — promptable parameters. */
export const PREMIUM_VISUAL_TREND_KEYWORDS = [
  '### 2026 vibe keywords (use in Art Direction Brief + component briefs)',
  'Pair 2–3 per project: `cinematic` `editorial` `playful` `premium` `utilitarian` `glass` `bento` `dark-craft` `arcade` `warm-monochrome`.',
  'Motion: `orchestrated entrance` `scroll-reveal` `magnetic hover` `spring physics` `reduced-motion fallback`.',
  'Proof: `product-in-hero` `social proof strip` `metric anchors` `interactive demo` `sticky conversion header`.',
].join('\n');

/** Anthropic-style self-critique prompt — researched anti-slop gate. */
export const PREMIUM_VISUAL_SELF_CRITIQUE_PROMPT = [
  '### Pre-ship self-critique (mandatory internal pass)',
  'Before claiming visual done, answer in writing:',
  '1. List 3 ways this still looks like generic AI slop.',
  '2. Name the one signature element a user would remember.',
  '3. Does the hero thesis come from the subject world — not a template (big number + gradient)?',
  '4. Chanel rule: remove one decorative element that does not serve the brief.',
  '5. Screenshot inspected — what specific defect remains? Fix or defer with user consent.',
].join('\n');

/** Compact pointer block for Premium injection (token-efficient). Full catalog stays available as PREMIUM_VISUAL_REFERENCE_CATALOG. */
export const PREMIUM_VISUAL_REFERENCE_COMPACT = [
  '### Visual refs (compact — expand via SearchSkill / design skills when needed)',
  '- Inspiration: godly.website, awwwards.com, bentogrids.com, dark.design; study 2–3 refs, do not clone.',
  '- Layouts: bento hero, split narrative, oversized type, product-in-hero, dark craft, game frame. Ban centered 3-card + purple gradient.',
  '- Imagery: `https://picsum.photos/seed/{project}-hero/1920/1080.webp`; dicebear `https://api.dicebear.com/10.x/notionists/svg?seed={id}`.',
  '- Fonts: Outfit+JetBrains Mono (product), Newsreader+Outfit (editorial), Space Grotesk+IBM Plex Mono (devtool), Fredoka+Nunito (playful).',
  '- Components: aceternity, magicui, reactbits, shadcn; verify deps before copy-paste.',
  '- Self-critique: name 3 remaining AI-slop tells, one signature element, and the last screenshot defect before claiming done.',
].join('\n');

/** Full embedded reference block for injection. */
export const PREMIUM_VISUAL_REFERENCE_CATALOG = [
  PREMIUM_VISUAL_INSPIRATION_SITES,
  '',
  PREMIUM_VISUAL_LAYOUT_TEMPLATES_2026,
  '',
  PREMIUM_VISUAL_PHOTO_CATALOG,
  '',
  PREMIUM_VISUAL_FONT_STACKS,
  '',
  PREMIUM_VISUAL_COMPONENT_LIBRARIES,
  '',
  PREMIUM_VISUAL_TEXTURE_SNIPPETS,
  '',
  PREMIUM_VISUAL_TREND_KEYWORDS,
  '',
  PREMIUM_VISUAL_SELF_CRITIQUE_PROMPT,
].join('\n');
