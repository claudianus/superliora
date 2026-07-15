import {
  PREMIUM_VISUAL_SKILL_ROUTING,
  PREMIUM_VISUAL_SKIP_SKILL_WHEN,
} from './contract';
import { PREMIUM_QUALITY_HYPE_VISUAL_FLOOD } from './quality-hype';
import { PREMIUM_VISUAL_REFERENCE_COMPACT } from './references';

/** Hard visual mandate — injected on every full Premium Quality refresh. */
export const PREMIUM_VISUAL_SUPREMACY_MANDATE = [
  '## PREMIUM VISUAL (PRIMARY while Premium Quality is ON)',
  'Visual quality is the top priority for any user-visible surface — especially web, dashboards, and games. Premium means screenshot-proof, Awwwards-worthy craft — NOT "works in the browser".',
  'A functional MVP with flat shapes, default fonts, or placeholder geometry fails Premium Quality unless the user asked for a wireframe/prototype. Fix until a principal designer would not reject the screenshot.',
  '',
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
].join('\n');

/** Art direction gate — must happen before visual implementation. */
export const PREMIUM_VISUAL_ART_DIRECTION_GATE = [
  '### Art direction before code (mandatory)',
  'Before the first visual implementation pass, write a short Art Direction Brief:',
  '- Vibe: 3 adjectives.',
  '- Palette: 1 neutral base + 1 accent (saturation < 80%). Ban AI purple/blue neon gradients.',
  '- Typography: display + body + mono/data — never browser defaults or Inter-by-default.',
  '- Layout: asymmetric/split hero when appropriate; max-width container; `min-h-[100dvh]` not `100vh`.',
  '- Motion + assets + evidence target (BrowserScreenshot / Playwright).',
].join('\n');

/** Cheat-key prompt patterns distilled from proven anti-slop / design-taste skills. */
export const PREMIUM_VISUAL_CHEAT_KEYS = [
  '### Visual cheat keys (apply by default)',
  'Typography: tight display tracking; body `max-w-[65ch] leading-relaxed`; ban naked Inter — use Geist, Outfit, Cabinet Grotesk, Satoshi.',
  'Color: off-black/off-white bases; tinted shadows; one accent; ban #000 large fields and purple AI-gradient heroes.',
  'Layout: CSS Grid; break 3-equal-card rows; optical spacing and depth.',
  'Surfaces/interaction: purposeful elevation; skeleton loaders; tactile active states; visible focus rings.',
  'Content/game: real copy; themed HUD/assets; no emoji-as-UI or primitive placeholder geometry.',
].join('\n');

/** Banned placeholder patterns that must never ship as "done". */
export const PREMIUM_VISUAL_BANNED_SHIP_STATES = [
  '### Banned ship states (auto-fail under Premium Quality)',
  '- Flat single-color background + primitive shapes as final art.',
  '- System font or zero typographic hierarchy.',
  '- Missing hover/active/loading/empty states on interactive UI.',
  '- Stock 3-column feature cards, centered generic hero, purple gradient CTA.',
  '- `height: 100vh` full-screen sections, emoji in UI, dead `#` buttons, lorem ipsum.',
  '- Claiming visual completion without opening a real screenshot of the rendered surface.',
].join('\n');

/** Verification loop — proof before done. */
export const PREMIUM_VISUAL_VERIFICATION_LOOP = [
  '### Visual verification loop (mandatory before done)',
  '1. Ship one visual slice → 2. Open real surface → 3. BrowserScreenshot / BrowserUse / Playwright / develop-web-game capture → 4. Inspect; iterate if still placeholder → 5. Rubric score; FAIL = another pass → 6. Record evidence path (not only chat).',
  'Missing optional npm packages do NOT prove browser verification is impossible; use harness BrowserUse paths first.',
].join('\n');

/** 10-point rubric for self-audit. */
export const PREMIUM_VISUAL_RUBRIC = [
  '### Premium Visual rubric (score each 1–5; ship only when all ≥ 4)',
  '1. First impression  2. Typography  3. Color/material  4. Layout  5. Component states',
  '6. Assets  7. Motion/feedback  8. Content  9. Accessibility  10. Screenshot evidence inspected',
].join('\n');

/** Focused upgrade playbook. */
export const PREMIUM_VISUAL_UPGRADE_PLAYBOOK = [
  '### Visual upgrade playbook (iterate until rubric passes)',
  'Pass A Structure → B Brand → C Components/states → D Assets → E Motion → F Screenshot proof.',
  'Prefer focused visual deltas over monolithic rewrites.',
].join('\n');

/** Full visual harness block composed for injection (compact refs, not the full catalog dump). */
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
  PREMIUM_VISUAL_REFERENCE_COMPACT,
  '',
  PREMIUM_VISUAL_SKIP_SKILL_WHEN,
  '',
  PREMIUM_VISUAL_SKILL_ROUTING,
].join('\n');
