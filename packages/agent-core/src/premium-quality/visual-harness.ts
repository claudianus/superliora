import {
  PREMIUM_VISUAL_SKILL_ROUTING,
  PREMIUM_VISUAL_SKIP_SKILL_WHEN,
} from './contract';
import { PREMIUM_QUALITY_HYPE_VISUAL_FLOOD } from './quality-hype';
import { PREMIUM_VISUAL_REFERENCE_CATALOG } from './references';

/** Hard visual supremacy mandate — injected on every full Premium Quality refresh. */
export const PREMIUM_VISUAL_SUPREMACY_MANDATE = [
  '## ULTRA SUPER PREMIUM VISUAL SUPREMACY (PRIMARY — KING-GOD-GENERAL WORLD-#1 while Premium Quality is ON)',
  'Visual quality is the supreme, hyper-obsessive, jaw-dropping top priority for any user-visible surface — especially web, mobile web, dashboards, and games.',
  'Premium mode means ultra-modern, hyper-trending, god-tier, world-class, Awwwards-worthy, portfolio-shredding, museum-grade, screenshot-proof, devastatingly beautiful visuals — NOT "works in the browser".',
  'A functional MVP with flat shapes, default fonts, or placeholder geometry is an unforgivable FAILURE under Premium Quality unless the user explicitly asked for a wireframe/prototype.',
  'Treat every visible deliverable as if a legendary principal designer will screenshot it, laugh, and reject your generic AI slop on sight — then fix it until it looks illegally premium.',
  '',
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
].join('\n');

/** Art direction gate — must happen before visual implementation. */
export const PREMIUM_VISUAL_ART_DIRECTION_GATE = [
  '### Art direction before code (mandatory)',
  'Before the first visual implementation pass, write a short Art Direction Brief (plan, todo, or comment block):',
  '- Vibe: 3 adjectives (e.g. "playful factory", "glass candy lab", "editorial arcade").',
  '- Palette: 1 neutral base family + 1 accent (saturation < 80%). Ban AI purple/blue neon gradients.',
  '- Typography: display + body + mono/data fonts with Google Fonts or self-hosted files — never browser defaults or Inter-by-default.',
  '- Layout: asymmetric or split hero when appropriate; max-width container; `min-h-[100dvh]` not `100vh`.',
  '- Motion: hover/active/loading/empty/error states; transform/opacity only; spring or 200–300ms easing.',
  '- Assets: icons (Phosphor/Radix/custom SVG), textures/grain, illustrations, sprites, og:image, favicon — no emoji-as-UI.',
  '- Evidence target: which screens get BrowserScreenshot or Playwright capture before "done".',
].join('\n');

/** Cheat-key prompt patterns distilled from proven anti-slop / design-taste skills. */
export const PREMIUM_VISUAL_CHEAT_KEYS = [
  '### Visual cheat keys (apply by default)',
  'Typography: `tracking-tighter leading-none` display; body `max-w-[65ch] leading-relaxed`; ban naked Inter for premium vibes — use Geist, Outfit, Cabinet Grotesk, Satoshi.',
  'Color: off-black/off-white bases; tint shadows to background hue; one accent; ban #000 on large fields and purple AI-gradient hero.',
  'Layout: CSS Grid over flex percentage math; break 3-equal-card rows; add optical spacing and depth — not everything centered.',
  'Surfaces: cards only when elevation means hierarchy; liquid-glass = blur + `border-white/10` + subtle inner highlight; subtle noise/grain on large backgrounds.',
  'Interaction: skeleton loaders matching layout; tactile `:active` scale/translate; visible focus rings; smooth scroll.',
  'Content: real copy, believable names/data, sentence-case headers, no Lorem, no "Elevate/Seamless/Unleash" marketing slop.',
  'Game/canvas: themed HUD, cohesive sprite/icon language, particle/feedback on actions, framed viewport — not random circles on flat pink.',
].join('\n');

/** Banned placeholder patterns that must never ship as "done". */
export const PREMIUM_VISUAL_BANNED_SHIP_STATES = [
  '### Banned ship states (auto-fail under Premium Quality)',
  '- Flat single-color background + primitive shapes as final art (circles/squares as "candy", "coins", "avatars").',
  '- System font or zero typographic hierarchy.',
  '- Missing hover/active/loading/empty states on interactive UI.',
  '- Stock 3-column feature cards, centered generic hero, purple gradient CTA, Lucide-only icon soup with no brand.',
  '- `height: 100vh` full-screen sections, emoji in UI, dead `#` buttons, lorem ipsum, identical avatars.',
  '- Claiming visual completion without opening a real screenshot of the rendered surface.',
].join('\n');

/** Verification loop — proof before done. */
export const PREMIUM_VISUAL_VERIFICATION_LOOP = [
  '### Visual verification loop (mandatory before done)',
  '1. Implement or upgrade one visual slice.',
  '2. Run dev server or open deployed URL when applicable.',
  '3. Capture real-surface evidence: BrowserScreenshot, BrowserUse, Playwright, or develop-web-game screenshot loop.',
  '4. Open and inspect the screenshot — if it still looks like a placeholder, iterate (typography, palette, assets, motion, layout).',
  '5. Run a 10-point visual rubric (below). Any FAIL → another pass. Do not report done with known visual FAILs.',
  '6. Record evidence path or observation in plan/todo/evidence — not only chat.',
  'Missing optional npm packages do NOT prove browser verification is impossible; use harness BrowserUse (Lightpanda → CloakBrowser) paths first.',
].join('\n');

/** 10-point rubric for self-audit. */
export const PREMIUM_VISUAL_RUBRIC = [
  '### Premium Visual rubric (score each 1–5; ship only when all ≥ 4 — ULTRA GOD-TIER BAR)',
  '1. First impression — insanely premium, iconic brand energy, zero template cowardice.',
  '2. Typography — devastating hierarchy, luxurious pairing, flawless tracking, perfect measure.',
  '3. Color/material — sumptuous cohesive palette, luscious depth, zero AI-gradient embarrassment.',
  '4. Layout — exquisite rhythm, generous god-tier whitespace, responsive framing, zero generic 3-card slop.',
  '5. Components — hyper-polished states complete (hover/active/loading/empty/error).',
  '6. Assets — gorgeous real icons/imagery/sprites; zero primitive placeholder garbage.',
  '7. Motion/feedback — cinematic, juicy, performant (transform/opacity).',
  '8. Content — specific, human, premium-trustworthy; zero filler slop.',
  '9. Accessibility — flawless contrast, focus, labels, touch targets.',
  '10. Evidence — screenshot inspected and jaw-dropping; defects fixed or explicitly deferred with user consent.',
].join('\n');

/** 500% upgrade iteration playbook. */
export const PREMIUM_VISUAL_UPGRADE_PLAYBOOK = [
  '### 500% visual upgrade playbook (iterate until rubric passes)',
  'Pass A — Structure: grid, spacing, type scale, container, semantic HTML.',
  'Pass B — Brand: fonts, palette, shadows, borders, background texture/imagery.',
  'Pass C — Components: buttons, cards, inputs, nav, HUD with full states.',
  'Pass D — Assets: icons, illustrations, sprites, favicon, og:image (generate via workspace-imagen or curated SVG when needed).',
  'Pass E — Motion: micro-interactions, entrance stagger, game feedback particles.',
  'Pass F — Proof: screenshot audit, fix every visible defect, re-capture.',
  'Do one pass per meaningful step; prefer focused visual deltas over monolithic rewrites.',
].join('\n');

/** Full visual harness block composed for injection. */
export const PREMIUM_VISUAL_HARNESS = [
  PREMIUM_VISUAL_SUPREMACY_MANDATE,
  '',
  PREMIUM_VISUAL_ART_DIRECTION_GATE,
  '',
  PREMIUM_VISUAL_CHEAT_KEYS,
  '',
  PREMIUM_VISUAL_BANNED_SHIP_STATES,
  '',
  PREMIUM_VISUAL_VERIFICATION_LOOP,
  '',
  PREMIUM_VISUAL_RUBRIC,
  '',
  PREMIUM_VISUAL_UPGRADE_PLAYBOOK,
  '',
  PREMIUM_VISUAL_REFERENCE_CATALOG,
  '',
  PREMIUM_VISUAL_SKIP_SKILL_WHEN,
  '',
  PREMIUM_VISUAL_SKILL_ROUTING,
].join('\n');
