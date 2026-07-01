import type { AppearancePreferences } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';

export type AmbientEffectMode = 'off' | 'subtle' | 'premium';

const SUBTLE_PARTICLES = ['·', '∙', '✧'] as const;
const PREMIUM_PARTICLES = ['✦', '✧', '✺', '∙', '•'] as const;
const PARTICLE_TOKENS: readonly ColorToken[] = [
  'particle',
  'accent',
  'primary',
  'gradientEnd',
];
const SHIMMER_FRAMES = ['✦', '✧', '∙', '·'] as const;

export function resolveAmbientEffectMode(appearance: AppearancePreferences): AmbientEffectMode {
  if (appearance.profile === 'off' || appearance.particles === 'off') return 'off';
  if (appearance.profile === 'premium' || appearance.particles === 'premium') return 'premium';
  if (
    appearance.profile === 'subtle' ||
    appearance.particles === 'ambient' ||
    appearance.particles === 'events'
  ) {
    return 'subtle';
  }
  return 'subtle';
}

export function motionEffectsAllowed(): boolean {
  if (process.env['TERM'] === 'dumb') return false;
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['CI'] !== undefined && process.env['CI'] !== '' && process.env['CI'] !== '0') {
    return false;
  }
  return !isRemoteSession();
}

export function shouldRenderAmbientEffects(appearance: AppearancePreferences): boolean {
  return motionEffectsAllowed() && resolveAmbientEffectMode(appearance) !== 'off';
}

export function renderParticleRail(
  width: number,
  appearance: AppearancePreferences,
  seed: string,
): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (safeWidth === 0) return '';
  if (!shouldRenderAmbientEffects(appearance)) return ' '.repeat(safeWidth);

  const mode = resolveAmbientEffectMode(appearance);
  const premium = mode === 'premium';
  const tickMs = premium ? 160 : 420;
  const tick = Math.floor(Date.now() / tickMs);
  const density = premium
    ? Math.max(3, Math.min(18, Math.floor(safeWidth / 7)))
    : Math.max(1, Math.min(6, Math.floor(safeWidth / 18)));
  const chars = premium ? PREMIUM_PARTICLES : SUBTLE_PARTICLES;
  const cells = Array.from({ length: safeWidth }, () => ' ');
  const base = hashSeed(seed);

  for (let i = 0; i < density; i++) {
    const direction = i % 2 === 0 ? 1 : -1;
    const speed = 1 + (i % 3);
    const origin = base + i * 17 + (i % 5) * 11;
    const x = positiveModulo(origin + direction * tick * speed, safeWidth);
    const char = chars[positiveModulo(origin + tick + i, chars.length)]!;
    const token = PARTICLE_TOKENS[positiveModulo(origin + tick + i * 3, PARTICLE_TOKENS.length)]!;
    cells[x] = currentTheme.fg(token, char);

    if (premium && safeWidth > 24) {
      const trail = positiveModulo(x - direction, safeWidth);
      if (cells[trail] === ' ') cells[trail] = currentTheme.dimFg('particle', '·');
    }
  }

  return cells.join('');
}

export function renderShimmerPrefix(appearance: AppearancePreferences): string {
  if (!shouldRenderAmbientEffects(appearance)) return '';
  const mode = resolveAmbientEffectMode(appearance);
  const interval = mode === 'premium' ? 180 : 520;
  const index = positiveModulo(Math.floor(Date.now() / interval), SHIMMER_FRAMES.length);
  return `${SHIMMER_FRAMES[index]!} `;
}

function isRemoteSession(): boolean {
  return (
    (process.env['SSH_TTY'] ?? '').length > 0 ||
    (process.env['SSH_CONNECTION'] ?? '').length > 0 ||
    (process.env['SSH_CLIENT'] ?? '').length > 0
  );
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    const codePoint = seed.codePointAt(i) ?? 0;
    hash ^= codePoint;
    hash = Math.imul(hash, 16777619);
    if (codePoint > 0xffff) i++;
  }
  return Math.abs(Math.trunc(hash));
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
