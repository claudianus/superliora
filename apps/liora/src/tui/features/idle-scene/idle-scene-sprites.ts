/**
 * Jewel Tank sprite/prop glyph library — fish frames, plant sway kits,
 * hardscape silhouettes, and the timing constants that drive their motion.
 *
 * Pure data (no rendering logic). Split out of `idle-scene.ts`.
 */

/**
 * Ornamental school — multi-row silhouettes with dorsal/ventral fins.
 * Large ≈ clownfish (3-row with flowing fins). Compact ≈ betta (2-row).
 * Tiny ≈ neon danios (single-row darts).
 */
export const FISH_LARGE_RIGHT = [
  '  /~\\  ',
  '>═((º═>',
  '  \\~/  ',
] as const;

/** Lead fish — left (3-row). */
export const FISH_LARGE_LEFT = [
  '  /~\\  ',
  '<═º))═<',
  '  \\~/  ',
] as const;

/** Mid-size betta companion — right (2-row with dorsal crest). */
export const FISH_COMPACT_RIGHT = [
  ' .~~. ',
  '>∽((º≈',
] as const;

/** Mid-size betta companion — left (2-row). */
export const FISH_COMPACT_LEFT = [
  ' .~~. ',
  '≈º))∽<',
] as const;

/** Tiny neon danios (right / left pairs). */
export const FISH_TINY = [
  ['>◦≡>', '<≡◦<'],
  ['>º≡>', '<≡º<'],
  ['>◦~>', '<~◦<'],
] as const;

/**
 * Jellyfish — pulsing bell with trailing tentacles (3 rows).
 * Adds vertical movement and bioluminescent glow to the mid-water column.
 */
export const JELLYFISH_FRAMES = [
  [' .oOo. ', ' )~~~( ', '  )|(| '],
  [' .oOo. ', ' )~~~( ', '  |)|  '],
  ['  oOo  ', '  )~(  ', '  )|(  '],
  [' .oOo. ', ' )~~~( ', '  )|(| '],
] as const;

/** Seahorse — slow drift, curled tail (3 rows). */
export const SEAHORSE_FRAMES = [
  [' .o. ', ' (º) ', '  )~ '],
  [' .o. ', ' (º) ', '  ~( '],
  [' .o. ', ' (º) ', '  )~ '],
  [' .o. ', ' (º) ', '  ~( '],
] as const;

/**
 * Aquascape plant kits — each row is 4 sway frames.
 * Carpet / fine bush / broad mid / tall sword. Avoid bamboo `|` poles.
 */
export const PLANT_CARPET = [['.,.~', '~.,.', '.,.~', '~.,.']] as const;

/** Fluffy fine-leaf bush (hornwort / milfoil). */
export const PLANT_BUSH = [
  [' )~) ', ' (~( ', ' )~) ', ' (~( '],
  [')~)~(', '(~(~)', ')~)~(', '(~(~)'],
  [')~~)(', '(~~(~)', ')~~)(', '(~~(~)'],
] as const;

/** Broad mid leaves near the hardscape (anubias-ish). */
export const PLANT_BROAD = [
  ['  ,  ', '  .  ', '  ,  ', '  .  '],
  [' )u( ', ' (n) ', ' )u( ', ' (n) '],
  ['(_)_ ', '(_)( ', '(_)_ ', '(_)( '],
] as const;

/** Tall sword / java-fern leaves — right bank hero (8-row grand sword). */
export const PLANT_TALL = [
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['  )/   ', '  \\(  ', '  )/   ', '  \\(  '],
  ['  )~(  ', '  (~)  ', '  )~(  ', '  (~)  '],
  [' )~)~( ', ' (~(~) ', ' )~)~( ', ' (~(~) '],
  [' )~~)( ', ' (~~(~ ', ' )~~)( ', ' (~~(~ '],
  ['(~)~~( ', '~(~)~) ', '(~)~~( ', '~(~)~) '],
  ['(~)~~(~', '~(~)~~)', '(~)~~(~', '~(~)~~)'],
] as const;

/** Slim stem plant for a single magenta/red accent (taller). */
export const PLANT_STEM = [
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['  )|(  ', '  (|\\ ', '  )|(  ', '  (/|  '],
  ['  )~(  ', '  (~)  ', '  )~(  ', '  (~)  '],
  [' )~)~( ', ' (~(~) ', ' )~)~( ', ' (~(~) '],
  ['(~)~(~ ', '~(~)~) ', '(~)~(~ ', '~(~)~) '],
] as const;

/** Tall grass / vallisneria — flowing ribbon leaves for left bank. */
export const PLANT_GRASS = [
  ['  |  ', '  |  ', '  |  ', '  |  '],
  ['  )  ', '  (  ', '  )  ', '  (  '],
  [' )~  ', ' (~  ', ' )~  ', ' (~  '],
  [' )~) ', ' (~( ', ' )~) ', ' (~( '],
  ['(~)~ ', '~(~) ', '(~)~ ', '~(~) '],
] as const;

/** Centerpiece rock — warm hardscape mass, not coral theatre. */
export const ROCK_FORMS = [
  ['   /¯\\/¯\\  ', '  //¯¯¯\\\\  ', ' /_______\\ '],
  ['    /¯¯\\   ', '   /||||\\  ', '  /______\\ '],
  ['   /\\/\\    ', '  /____\\   '],
] as const;

export const BUBBLE_GLYPHS = ['·', 'o', '°', '○'] as const;

export const FISH_SWIM_MS = 4_200;
export const FISH_TAIL_MS = 360;
export const BUBBLE_STEP_MS = 170;
export const PLANT_SWAY_MS = 2_400;
export const CAUSTIC_DRIFT_MS = 55;
