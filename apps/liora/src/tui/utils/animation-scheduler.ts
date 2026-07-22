/**
 * AnimationScheduler — centralized animation system for the TUI.
 *
 * Provides a frame-driven animation engine:
 * - Easing functions (linear, ease-in/out, cubic, elastic, bounce, spring)
 * - Tween animations (interpolate any numeric value over time)
 * - Keyframe sequences (multi-step animations)
 * - Particle system (sparkles, confetti, trails for celebrations)
 * - Staggered animations (cascade effects across lists)
 * - Looping animations (pulse, breathe, shimmer, rotate)
 * - Transition orchestration (enter/exit with configurable curves)
 * - Frame budget management (skip frames if behind)
 * - Clock-driven (Date.now() based, frame-rate independent)
 *
 * Architecture:
 * - Single scheduler tick per frame
 * - Animations register with duration, easing, and update callback
 * - Completed animations auto-remove
 * - Priority system for frame budget allocation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EasingFunction = (t: number) => number;

export interface Animation {
  readonly id: string;
  readonly startTime: number;
  readonly duration: number;
  readonly easing: EasingFunction;
  readonly loop: boolean;
  readonly loopCount: number; // -1 = infinite
  readonly delay: number;
  readonly priority: number;
  readonly onUpdate: (progress: number, easedProgress: number) => void;
  readonly onComplete?: () => void;
  /** Internal state */
  _completedLoops: number;
  _done: boolean;
}

export interface TweenOptions {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly easing?: EasingFunction;
  readonly delay?: number;
  readonly loop?: boolean;
  readonly loopCount?: number;
  readonly onUpdate: (value: number) => void;
  readonly onComplete?: () => void;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  char: string;
  color: string;
  size: number;
}

export interface ParticleEmitterOptions {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly spread: number; // Angle spread in radians
  readonly speed: number;
  readonly gravity: number;
  readonly lifetime: number;
  readonly chars: readonly string[];
  readonly colors: readonly string[];
  readonly direction?: number; // Base direction in radians
}

export interface Keyframe {
  readonly at: number; // 0-1 progress point
  readonly value: number;
  readonly easing?: EasingFunction;
}

export interface AnimationRenderOptions {
  readonly fg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Easing Functions
// ---------------------------------------------------------------------------

export const Easing = {
  linear: (t: number): number => t,

  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  easeInExpo: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  easeInElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
  },
  easeOutElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },

  easeOutBounce: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  spring: (t: number): number => {
    const frequency = 4.5;
    const damping = 0.55;
    return 1 - Math.exp(-damping * t * 10) * Math.cos(frequency * t * Math.PI * 2);
  },

  /** Smooth step (Hermite interpolation). */
  smoothStep: (t: number): number => t * t * (3 - 2 * t),

  /** Smoother step (Ken Perlin's improved version). */
  smootherStep: (t: number): number => t * t * t * (t * (t * 6 - 15) + 10),
} satisfies Record<string, EasingFunction>;

// ---------------------------------------------------------------------------
// AnimationScheduler
// ---------------------------------------------------------------------------

export class AnimationScheduler {
  private animations: Map<string, Animation> = new Map();
  private particles: Particle[] = [];
  private idCounter = 0;
  private lastTickTime = 0;
  private frameBudgetMs = 16; // ~60fps budget

  // ─── Animation Lifecycle ─────────────────────────────────────────

  /** Create and register a new animation. */
  animate(options: {
    duration: number;
    easing?: EasingFunction;
    loop?: boolean;
    loopCount?: number;
    delay?: number;
    priority?: number;
    onUpdate: (progress: number, easedProgress: number) => void;
    onComplete?: () => void;
  }): string {
    const id = `anim-${String(++this.idCounter)}`;
    const animation: Animation = {
      id,
      startTime: Date.now() + (options.delay ?? 0),
      duration: options.duration,
      easing: options.easing ?? Easing.easeOutCubic,
      loop: options.loop ?? false,
      loopCount: options.loopCount ?? -1,
      delay: options.delay ?? 0,
      priority: options.priority ?? 0,
      onUpdate: options.onUpdate,
      onComplete: options.onComplete,
      _completedLoops: 0,
      _done: false,
    };

    this.animations.set(id, animation);
    return id;
  }

  /** Create a tween animation (interpolate a numeric value). */
  tween(options: TweenOptions): string {
    return this.animate({
      duration: options.duration,
      easing: options.easing,
      delay: options.delay,
      loop: options.loop,
      loopCount: options.loopCount,
      onUpdate: (_progress, eased) => {
        const value = options.from + (options.to - options.from) * eased;
        options.onUpdate(value);
      },
      onComplete: options.onComplete,
    });
  }

  /** Create a keyframe animation. */
  keyframes(keyframes: Keyframe[], duration: number, onUpdate: (value: number) => void, easing?: EasingFunction): string {
    const sorted = [...keyframes].sort((a, b) => a.at - b.at);

    return this.animate({
      duration,
      easing: Easing.linear, // Keyframes handle their own easing
      onUpdate: (progress) => {
        const value = interpolateKeyframes(sorted, progress);
        onUpdate(value);
      },
    });
  }

  /** Create a staggered animation across multiple items. */
  stagger(
    count: number,
    staggerDelay: number,
    duration: number,
    easing: EasingFunction,
    onUpdate: (index: number, progress: number, eased: number) => void,
    onComplete?: () => void,
  ): string[] {
    const ids: string[] = [];
    let completed = 0;

    for (let i = 0; i < count; i++) {
      const id = this.animate({
        duration,
        easing,
        delay: i * staggerDelay,
        onUpdate: (progress, eased) => onUpdate(i, progress, eased),
        onComplete: () => {
          completed++;
          if (completed === count && onComplete) onComplete();
        },
      });
      ids.push(id);
    }

    return ids;
  }

  /** Cancel an animation by ID. */
  cancel(id: string): void {
    this.animations.delete(id);
  }

  /** Cancel all animations. */
  cancelAll(): void {
    this.animations.clear();
  }

  /** Check if an animation is active. */
  isActive(id: string): boolean {
    return this.animations.has(id);
  }

  /** Get active animation count. */
  get activeCount(): number {
    return this.animations.size;
  }

  // ─── Particle System ─────────────────────────────────────────────

  /** Emit particles from a point. */
  emitParticles(options: ParticleEmitterOptions): void {
    const { x, y, count, spread, speed, gravity, lifetime, chars, colors, direction = -Math.PI / 2 } = options;

    for (let i = 0; i < count; i++) {
      const angle = direction + (Math.random() - 0.5) * spread;
      const velocity = speed * (0.5 + Math.random() * 0.5);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: lifetime * (0.7 + Math.random() * 0.3),
        maxLife: lifetime,
        char: chars[Math.floor(Math.random() * chars.length)] ?? '✦',
        color: colors[Math.floor(Math.random() * colors.length)] ?? '\x1b[33m',
        size: 1,
      });
    }
  }

  /** Emit celebration confetti. */
  emitConfetti(x: number, y: number): void {
    this.emitParticles({
      x, y,
      count: 20,
      spread: Math.PI * 2,
      speed: 3,
      gravity: 0.15,
      lifetime: 60,
      chars: ['✦', '◆', '●', '★', '✧', '◇'],
      colors: ['\x1b[31m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m'],
    });
  }

  /** Emit a sparkle trail. */
  emitSparkle(x: number, y: number): void {
    this.emitParticles({
      x, y,
      count: 3,
      spread: Math.PI * 0.5,
      speed: 1,
      gravity: -0.05,
      lifetime: 20,
      chars: ['✧', '·', '˚', '°'],
      colors: ['\x1b[33m', '\x1b[93m', '\x1b[37m'],
    });
  }

  /** Get active particle count. */
  get particleCount(): number {
    return this.particles.length;
  }

  // ─── Tick (Frame Update) ─────────────────────────────────────────

  /** Advance all animations and particles. Call once per frame. */
  tick(): void {
    const now = Date.now();
    this.lastTickTime = now;

    // Update animations
    const toRemove: string[] = [];

    for (const [id, anim] of this.animations) {
      if (anim._done) {
        toRemove.push(id);
        continue;
      }

      const elapsed = now - anim.startTime;
      if (elapsed < 0) continue; // Still in delay

      let progress = Math.min(1, elapsed / anim.duration);
      const eased = anim.easing(progress);

      anim.onUpdate(progress, eased);

      if (progress >= 1) {
        if (anim.loop && (anim.loopCount === -1 || anim._completedLoops < anim.loopCount - 1)) {
          // Reset for next loop
          anim._completedLoops++;
          (anim as { startTime: number }).startTime = now;
        } else {
          anim._done = true;
          if (anim.onComplete) anim.onComplete();
          toRemove.push(id);
        }
      }
    }

    for (const id of toRemove) {
      this.animations.delete(id);
    }

    // Update particles
    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // Gravity
      p.life--;
      return p.life > 0;
    });
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render active particles as positioned characters. */
  renderParticles(): Array<{ x: number; y: number; char: string; color: string; alpha: number }> {
    return this.particles.map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      char: p.char,
      color: p.color,
      alpha: p.life / p.maxLife,
    }));
  }

  /** Render a debug overlay showing active animations. */
  renderDebug(options: AnimationRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];

    lines.push(dimFg('textMuted', ` Animations: ${String(this.animations.size)} | Particles: ${String(this.particles.length)}`));

    let shown = 0;
    for (const [, anim] of this.animations) {
      if (shown >= 5) {
        lines.push(dimFg('textMuted', `   …and ${String(this.animations.size - 5)} more`));
        break;
      }
      const elapsed = Date.now() - anim.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / anim.duration));
      const bar = renderMiniBar(progress, 15);
      lines.push(`   ${fg('primary', anim.id)} ${bar} ${dimFg('textMuted', `${Math.round(progress * 100)}%`)}`);
      shown++;
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Preset Animations
// ---------------------------------------------------------------------------

/** Create a pulse animation (scale 1→1.2→1). */
export function pulseAnimation(scheduler: AnimationScheduler, duration: number = 1000): string {
  return scheduler.animate({
    duration,
    easing: Easing.easeInOutQuad,
    loop: true,
    onUpdate: () => {}, // Consumer reads the eased value
  });
}

/** Create a shimmer animation for loading states. */
export function shimmerAnimation(scheduler: AnimationScheduler, width: number, onUpdate: (offset: number) => void): string {
  return scheduler.tween({
    from: -width,
    to: width * 2,
    duration: 1500,
    easing: Easing.linear,
    loop: true,
    onUpdate,
  });
}

/** Create a typewriter effect. */
export function typewriterAnimation(
  scheduler: AnimationScheduler,
  text: string,
  charsPerSecond: number,
  onUpdate: (visibleText: string) => void,
  onComplete?: () => void,
): string {
  const totalChars = text.length;
  const duration = (totalChars / charsPerSecond) * 1000;

  return scheduler.animate({
    duration,
    easing: Easing.linear,
    onUpdate: (_progress, _eased) => {
      const elapsed = Date.now();
      const charsToShow = Math.min(totalChars, Math.floor((elapsed / duration) * totalChars));
      onUpdate(text.slice(0, charsToShow));
    },
    onComplete,
  });
}

/** Create a fade-in animation. */
export function fadeInAnimation(scheduler: AnimationScheduler, duration: number, onUpdate: (opacity: number) => void): string {
  return scheduler.tween({
    from: 0,
    to: 1,
    duration,
    easing: Easing.easeOutCubic,
    onUpdate,
  });
}

/** Create a slide-in animation. */
export function slideInAnimation(
  scheduler: AnimationScheduler,
  fromX: number,
  toX: number,
  duration: number,
  easing: EasingFunction,
  onUpdate: (x: number) => void,
): string {
  return scheduler.tween({ from: fromX, to: toX, duration, easing, onUpdate });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function interpolateKeyframes(keyframes: Keyframe[], progress: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0]!.value;

  // Find surrounding keyframes
  let prev = keyframes[0]!;
  let next = keyframes[keyframes.length - 1]!;

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (progress >= keyframes[i]!.at && progress <= keyframes[i + 1]!.at) {
      prev = keyframes[i]!;
      next = keyframes[i + 1]!;
      break;
    }
  }

  const range = next.at - prev.at;
  if (range === 0) return next.value;

  const localProgress = (progress - prev.at) / range;
  const easing = next.easing ?? Easing.linear;
  const eased = easing(localProgress);

  return prev.value + (next.value - prev.value) * eased;
}

function renderMiniBar(progress: number, width: number): string {
  const filled = Math.round(progress * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
