/**
 * Premium session-loading modal — editor replacement while resume RPC +
 * history hydrate (or other long session work) run.
 *
 * Visual brief: luminous · kinetic · calm-busy
 * - Neutral: theme background / textDim
 * - Accent: primary + glow (sat kept terminal-safe)
 * - Motion: braille spinner, comet trail, jewel-orbit mini scene, progress bar
 *
 * Swallows all keystrokes so a second resume cannot start mid-load.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  renderPremiumHeadline,
  renderShimmerPrefix,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import { ttui } from '#/tui/utils/tui-i18n';

export type SessionLoadingPhase =
  | 'opening'
  | 'loading'
  | 'building'
  | 'finishing'
  | 'ready'
  | 'working';

export interface SessionLoadingOverlayOptions {
  readonly title?: string;
  readonly sessionId?: string;
  readonly phase?: SessionLoadingPhase;
  /** Optional 0–1 fraction; when omitted the phase supplies a soft estimate. */
  readonly progress?: number;
  readonly detail?: string;
}

const PHASE_FRACTION: Record<SessionLoadingPhase, number> = {
  opening: 0.08,
  loading: 0.32,
  building: 0.62,
  finishing: 0.9,
  ready: 1,
  working: 0.45,
};

const BAR_WIDTH = 32;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_MS = 64;
const COMET = ['·', '˙', '˚', '•', '∙', '●', '∙', '•', '˚', '˙'] as const;
const ORBIT = ['✦', '·', '✧', '·', '⋆', '·', '✧', '·'] as const;
const JEWEL = ['◆', '◇', '◈', '❖'] as const;
const SCENE_WIDTH = 32;

export class SessionLoadingOverlayComponent extends Container implements Focusable {
  focused = false;

  private title: string;
  private sessionId: string | undefined;
  private phase: SessionLoadingPhase;
  private progress: number | undefined;
  private detail: string | undefined;
  private readonly startedAtMs = appearanceAnimationNow();

  constructor(options: SessionLoadingOverlayOptions = {}) {
    super();
    this.title = options.title ?? ttui('tui.sessionLoading.title');
    this.sessionId = options.sessionId;
    this.phase = options.phase ?? 'opening';
    this.progress = options.progress;
    this.detail = options.detail;
  }

  update(patch: SessionLoadingOverlayOptions): void {
    if (patch.title !== undefined) this.title = patch.title;
    if (patch.sessionId !== undefined) this.sessionId = patch.sessionId;
    if (patch.phase !== undefined) this.phase = patch.phase;
    if (patch.progress !== undefined) this.progress = patch.progress;
    if (patch.detail !== undefined) this.detail = patch.detail;
  }

  get currentPhase(): SessionLoadingPhase {
    return this.phase;
  }

  handleInput(data: string): void {
    // Swallow all keys — cancel is not safe while wire/hydrate runs.
    if (matchesKey(data, Key.escape)) return;
  }

  override invalidate(): void {}

  override render(width: number): string[] {
    const safeWidth = Math.max(28, width);
    const fraction = this.resolveFraction();
    const elapsedSec = Math.max(0, (appearanceAnimationNow() - this.startedAtMs) / 1000);
    const phaseLabel = phaseLabelFor(this.phase);
    const spinner = this.renderSpinner();
    const bar = renderSessionLoadingBar(fraction, BAR_WIDTH, appearanceAnimationNow());
    const pct = `${String(Math.round(fraction * 100)).padStart(3, ' ')}%`;
    const appearance = getActiveAppearancePreferences();
    const shimmer = shouldRenderAmbientEffects(appearance)
      ? renderShimmerPrefix(appearance)
      : '';
    const sessionLine =
      this.sessionId === undefined || this.sessionId.length === 0
        ? undefined
        : truncateToWidth(
            currentTheme.dim(ttui('tui.sessionLoading.session', { id: shortId(this.sessionId) })),
            Math.max(8, safeWidth - 6),
            '…',
          );
    const detail =
      this.detail === undefined || this.detail.length === 0
        ? ttui('tui.sessionLoading.hint')
        : this.detail;
    const scene = this.renderMiniScene(Math.min(SCENE_WIDTH, Math.max(16, safeWidth - 10)));
    const content = [
      ...scene,
      '',
      `${spinner} ${shimmer}${currentTheme.fg('text', phaseLabel)}`,
      '',
      `${bar} ${currentTheme.boldFg('primary', pct)}`,
      currentTheme.dim(ttui('tui.sessionLoading.elapsed', { seconds: elapsedSec.toFixed(1) })),
      '',
      ...(sessionLine === undefined ? [] : [sessionLine]),
      currentTheme.dim(truncateToWidth(detail, Math.max(8, safeWidth - 6), '…')),
      '',
      currentTheme.fg('glow', ttui('tui.sessionLoading.locked')),
    ];

    const headline = renderPremiumHeadline(
      this.title,
      'session-loading:title',
      appearance,
    );

    return renderRoundedPanel({
      title: headline,
      content,
      width: safeWidth,
      borderToken: 'primary',
      minBoxWidth: 30,
    });
  }

  private resolveFraction(): number {
    if (this.progress !== undefined && Number.isFinite(this.progress)) {
      return clamp01(this.progress);
    }
    // Soft creep while phase has no explicit fraction (indeterminate work).
    if (this.phase === 'working') {
      const elapsed = appearanceAnimationNow() - this.startedAtMs;
      const wave = 0.5 + 0.5 * Math.sin(elapsed / 780);
      // Slow creep so long scans never look frozen at the same fraction.
      const creep = Math.min(0.22, elapsed / 45000);
      return clamp01(0.16 + 0.48 * wave + creep);
    }
    return PHASE_FRACTION[this.phase];
  }

  private renderSpinner(): string {
    if (!motionEffectsAllowed()) {
      return currentTheme.fg('primary', '●');
    }
    const now = appearanceAnimationNow();
    const frame = SPINNER[Math.floor(now / SPINNER_MS) % SPINNER.length] ?? '⠋';
    const comet = COMET[Math.floor(now / 90) % COMET.length] ?? '·';
    return `${currentTheme.fg('primary', frame)}${currentTheme.fg('glow', comet)}`;
  }

  /**
   * Tiny kinetic scene — dual jewel orbit, starfield, and a soft underline
   * pulse. Pure-string, no extra timers (rides host pulse + ambient clock).
   */
  private renderMiniScene(width: number): string[] {
    const w = Math.max(14, Math.min(SCENE_WIDTH, width));
    const now = appearanceAnimationNow();
    const cells: string[] = Array.from({ length: w }, () => ' ');

    // Layered starfield dust (two parities so the strip never looks empty).
    for (let i = 0; i < w; i++) {
      const tick = Math.floor(now / 120);
      const sparkA = (tick + i * 7) % 9 === 0;
      const sparkB = (tick + i * 5) % 13 === 0;
      if (sparkA) cells[i] = currentTheme.dim(ORBIT[i % ORBIT.length] ?? '·');
      else if (sparkB) cells[i] = currentTheme.fg('particle', '·');
    }

    // Primary jewel (sine orbit) + comet trail.
    const t1 = now / 380;
    const orbitX = Math.floor((Math.sin(t1) * 0.5 + 0.5) * (w - 1));
    const jewel = JEWEL[Math.floor(now / 240) % JEWEL.length] ?? '◆';
    for (let d = 4; d >= 1; d--) {
      const x = orbitX - d;
      if (x < 0) continue;
      const trail = COMET[(Math.floor(now / 70) + d) % COMET.length] ?? '·';
      cells[x] = currentTheme.fg(d <= 2 ? 'glow' : 'primary', trail);
    }
    cells[orbitX] = currentTheme.boldFg('primary', jewel);

    // Counter-orbit spark (phase-shifted) so the strip feels alive, not looping.
    const t2 = now / 520 + Math.PI * 0.65;
    const orbitY = Math.floor((Math.sin(t2) * 0.5 + 0.5) * (w - 1));
    if (orbitY !== orbitX) {
      cells[orbitY] = currentTheme.fg('glow', '✧');
    }

    // Soft underline pulse under the strip (separate visual beat).
    const underlineFill = Math.max(3, Math.floor(((Math.sin(now / 700) + 1) / 2) * w));
    const underline = Array.from({ length: w }, (_, i) => {
      if (i < underlineFill) {
        const hot = i >= underlineFill - 2;
        return currentTheme.fg(hot ? 'glow' : 'primary', hot ? '━' : '─');
      }
      return currentTheme.dim('·');
    }).join('');

    return [cells.join(''), underline];
  }

}

export function renderSessionLoadingBar(
  fraction: number,
  width: number,
  nowMs: number = appearanceAnimationNow(),
): string {
  const safeWidth = Math.max(4, Math.trunc(width));
  const pct = clamp01(fraction);
  const filled = Math.round(safeWidth * pct);
  const empty = Math.max(0, safeWidth - filled);
  const head = filled > 0 && filled < safeWidth;
  const pulse = head && motionEffectsAllowed() ? Math.floor(nowMs / 120) % 2 === 0 : false;
  const bodyLen = head ? Math.max(0, filled - 1) : filled;
  const body = currentTheme.fg('primary', '█'.repeat(bodyLen));
  const tip = head
    ? currentTheme.boldFg(pulse ? 'glow' : 'primary', '▓')
    : '';
  const rest = currentTheme.dim('░'.repeat(empty));
  return `[${body}${tip}${rest}]`;
}

function phaseLabelFor(phase: SessionLoadingPhase): string {
  switch (phase) {
    case 'opening':
      return ttui('tui.sessionLoading.phase.opening');
    case 'loading':
      return ttui('tui.sessionLoading.phase.loading');
    case 'building':
      return ttui('tui.sessionLoading.phase.building');
    case 'finishing':
      return ttui('tui.sessionLoading.phase.finishing');
    case 'ready':
      return ttui('tui.sessionLoading.phase.ready');
    case 'working':
      return ttui('tui.sessionLoading.phase.working');
  }
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
