/**
 * SoundIntegration — audio feedback for terminal events.
 *
 * Provides non-intrusive audio cues for important events:
 * - Terminal bell (BEL) for basic notifications
 * - OSC 9;4 console beep (Windows Terminal, ConEmu)
 * - Custom sound themes (mapping events to sound characteristics)
 * - Volume/intensity control
 * - Do-not-disturb mode
 * - Frequency/duration control for terminal bell patterns
 *
 * Sound events:
 * - Task complete: Success chime pattern
 * - Error: Alert pattern
 * - Permission needed: Attention pattern
 * - Streaming complete: Subtle tick
 * - Milestone: Achievement pattern
 *
 * The module respects terminal capabilities and user preferences,
 * falling back gracefully when audio is not available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SoundEvent =
  | 'task-complete'
  | 'error'
  | 'permission-needed'
  | 'streaming-tick'
  | 'milestone'
  | 'notification'
  | 'input'
  | 'success'
  | 'warning';

export type SoundBackend = 'bell' | 'osc9' | 'none';

export interface SoundConfig {
  /** Whether sound is enabled. */
  readonly enabled: boolean;
  /** Preferred backend. */
  readonly backend: SoundBackend;
  /** Volume 0-100. */
  readonly volume: number;
  /** Do-not-disturb mode (suppress all sounds). */
  readonly dnd: boolean;
  /** Custom event mappings. */
  readonly eventConfig: Partial<Record<SoundEvent, SoundPattern>>;
}

export interface SoundPattern {
  /** Number of bell pulses. */
  readonly pulses: number;
  /** Interval between pulses (ms). */
  readonly intervalMs: number;
  /** Duration of each pulse (for OSC 9;4). */
  readonly durationMs: number;
  /** Frequency hint (for terminals that support it). */
  readonly frequency: 'low' | 'medium' | 'high';
  /** Whether this event should vibrate (mobile terminals). */
  readonly vibrate: boolean;
}

export interface SoundState {
  readonly enabled: boolean;
  readonly dnd: boolean;
  readonly lastSoundMs: number;
  readonly soundCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEL = '\x07';
const OSC = '\x1b]';
const ST = '\x1b\\';

const DEFAULT_CONFIG: SoundConfig = {
  enabled: true,
  backend: 'bell',
  volume: 50,
  dnd: false,
  eventConfig: {},
};

/** Default sound patterns for each event type. */
const DEFAULT_PATTERNS: Record<SoundEvent, SoundPattern> = {
  'task-complete': { pulses: 2, intervalMs: 150, durationMs: 100, frequency: 'high', vibrate: true },
  'error': { pulses: 3, intervalMs: 100, durationMs: 150, frequency: 'low', vibrate: true },
  'permission-needed': { pulses: 2, intervalMs: 200, durationMs: 200, frequency: 'medium', vibrate: true },
  'streaming-tick': { pulses: 1, intervalMs: 0, durationMs: 30, frequency: 'high', vibrate: false },
  'milestone': { pulses: 3, intervalMs: 100, durationMs: 80, frequency: 'high', vibrate: true },
  'notification': { pulses: 1, intervalMs: 0, durationMs: 100, frequency: 'medium', vibrate: false },
  'input': { pulses: 1, intervalMs: 0, durationMs: 20, frequency: 'high', vibrate: false },
  'success': { pulses: 2, intervalMs: 120, durationMs: 80, frequency: 'high', vibrate: false },
  'warning': { pulses: 2, intervalMs: 150, durationMs: 120, frequency: 'medium', vibrate: false },
};

// ---------------------------------------------------------------------------
// SoundController
// ---------------------------------------------------------------------------

export class SoundController {
  private config: SoundConfig;
  private lastSoundMs = 0;
  private soundCount = 0;
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  private writeFn: (data: string) => void;

  constructor(
    writeFn: (data: string) => void,
    config?: Partial<SoundConfig>,
  ) {
    this.writeFn = writeFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Playback ─────────────────────────────────────────────────────

  /** Play a sound for an event. */
  play(event: SoundEvent): void {
    if (!this.config.enabled || this.config.dnd) return;

    const pattern = this.config.eventConfig[event] ?? DEFAULT_PATTERNS[event];
    if (!pattern) return;

    // Rate limiting: don't play more than once per 100ms
    const now = Date.now();
    if (now - this.lastSoundMs < 100) return;

    this.lastSoundMs = now;
    this.soundCount++;

    this.playPattern(pattern);
  }

  /** Play a custom pattern. */
  playPattern(pattern: SoundPattern): void {
    // Clear any pending sounds
    this.clearPending();

    for (let i = 0; i < pattern.pulses; i++) {
      const delay = i * pattern.intervalMs;
      const timeout = setTimeout(() => {
        this.emitSound(pattern);
      }, delay);
      this.pendingTimeouts.push(timeout);
    }
  }

  /** Play a simple bell. */
  bell(): void {
    if (!this.config.enabled || this.config.dnd) return;
    this.writeFn(BEL);
    this.lastSoundMs = Date.now();
    this.soundCount++;
  }

  /** Play success sound. */
  success(): void {
    this.play('success');
  }

  /** Play error sound. */
  error(): void {
    this.play('error');
  }

  /** Play notification sound. */
  notify(): void {
    this.play('notification');
  }

  /** Play task complete sound. */
  taskComplete(): void {
    this.play('task-complete');
  }

  /** Play permission needed sound. */
  permissionNeeded(): void {
    this.play('permission-needed');
  }

  // ─── Configuration ────────────────────────────────────────────────

  /** Enable or disable sound. */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  /** Toggle do-not-disturb mode. */
  toggleDnd(): void {
    this.config = { ...this.config, dnd: !this.config.dnd };
  }

  /** Set volume (0-100). */
  setVolume(volume: number): void {
    this.config = { ...this.config, volume: Math.max(0, Math.min(100, volume)) };
  }

  /** Set the sound backend. */
  setBackend(backend: SoundBackend): void {
    this.config = { ...this.config, backend };
  }

  /** Configure a specific event's sound pattern. */
  configureEvent(event: SoundEvent, pattern: Partial<SoundPattern>): void {
    const existing = this.config.eventConfig[event] ?? DEFAULT_PATTERNS[event];
    this.config = {
      ...this.config,
      eventConfig: {
        ...this.config.eventConfig,
        [event]: { ...existing, ...pattern },
      },
    };
  }

  /** Mute a specific event. */
  muteEvent(event: SoundEvent): void {
    this.configureEvent(event, { pulses: 0 });
  }

  get currentConfig(): SoundConfig {
    return this.config;
  }

  get state(): SoundState {
    return {
      enabled: this.config.enabled,
      dnd: this.config.dnd,
      lastSoundMs: this.lastSoundMs,
      soundCount: this.soundCount,
    };
  }

  // ─── Detection ────────────────────────────────────────────────────

  /** Detect the best available sound backend. */
  static detectBackend(env: Record<string, string | undefined> = process.env): SoundBackend {
    // Windows Terminal supports OSC 9;4
    if (env['WT_SESSION'] !== undefined) return 'osc9';

    // ConEmu supports OSC 9;4
    if (env['ConEmuPID'] !== undefined) return 'osc9';

    // Default to bell (most compatible)
    return 'bell';
  }

  /** Check if sound is likely to work in this environment. */
  static isSoundAvailable(env: Record<string, string | undefined> = process.env): boolean {
    // SSH sessions might not have audio
    if (env['SSH_TTY'] !== undefined || env['SSH_CONNECTION'] !== undefined) {
      return false;
    }

    // Check for explicit disable
    if (env['SUPERLIORA_NO_SOUND'] === '1') {
      return false;
    }

    return true;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private emitSound(pattern: SoundPattern): void {
    switch (this.config.backend) {
      case 'bell':
        this.emitBell();
        break;
      case 'osc9':
        this.emitOsc9(pattern);
        break;
      case 'none':
        break;
    }
  }

  private emitBell(): void {
    // Volume control via multiple bells (crude but works)
    const bells = Math.max(1, Math.round(this.config.volume / 50));
    this.writeFn(BEL.repeat(bells));
  }

  private emitOsc9(pattern: SoundPattern): void {
    // OSC 9;4 - Console beep (Windows Terminal)
    // Format: ESC ] 9 ; 4 ; st ; id BEL
    // st: 0 = stop, 1 = info, 2 = warning, 3 = error
    // id: notification id (for grouping)

    const severity = pattern.frequency === 'low' ? 3 : pattern.frequency === 'medium' ? 2 : 1;
    const duration = Math.round(pattern.durationMs * (this.config.volume / 100));

    // Play sound
    this.writeFn(`${OSC}9;4;${String(severity)};${String(duration)}${BEL}`);

    // Stop after duration
    const timeout = setTimeout(() => {
      this.writeFn(`${OSC}9;4;0;0${BEL}`);
    }, duration);
    this.pendingTimeouts.push(timeout);
  }

  private clearPending(): void {
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts = [];
  }

  /** Clean up resources. */
  dispose(): void {
    this.clearPending();
  }
}

// ---------------------------------------------------------------------------
// Sound Themes
// ---------------------------------------------------------------------------

export interface SoundTheme {
  readonly name: string;
  readonly patterns: Record<SoundEvent, SoundPattern>;
}

/** Minimal theme: subtle, non-intrusive sounds. */
export const SOUND_THEME_MINIMAL: SoundTheme = {
  name: 'minimal',
  patterns: {
    'task-complete': { pulses: 1, intervalMs: 0, durationMs: 50, frequency: 'high', vibrate: false },
    'error': { pulses: 1, intervalMs: 0, durationMs: 80, frequency: 'low', vibrate: false },
    'permission-needed': { pulses: 1, intervalMs: 0, durationMs: 100, frequency: 'medium', vibrate: false },
    'streaming-tick': { pulses: 0, intervalMs: 0, durationMs: 0, frequency: 'high', vibrate: false },
    'milestone': { pulses: 1, intervalMs: 0, durationMs: 60, frequency: 'high', vibrate: false },
    'notification': { pulses: 1, intervalMs: 0, durationMs: 50, frequency: 'medium', vibrate: false },
    'input': { pulses: 0, intervalMs: 0, durationMs: 0, frequency: 'high', vibrate: false },
    'success': { pulses: 1, intervalMs: 0, durationMs: 50, frequency: 'high', vibrate: false },
    'warning': { pulses: 1, intervalMs: 0, durationMs: 60, frequency: 'medium', vibrate: false },
  },
};

/** Expressive theme: rich, varied sounds for maximum feedback. */
export const SOUND_THEME_EXPRESSIVE: SoundTheme = {
  name: 'expressive',
  patterns: {
    'task-complete': { pulses: 3, intervalMs: 100, durationMs: 80, frequency: 'high', vibrate: true },
    'error': { pulses: 4, intervalMs: 80, durationMs: 150, frequency: 'low', vibrate: true },
    'permission-needed': { pulses: 3, intervalMs: 150, durationMs: 200, frequency: 'medium', vibrate: true },
    'streaming-tick': { pulses: 1, intervalMs: 0, durationMs: 20, frequency: 'high', vibrate: false },
    'milestone': { pulses: 5, intervalMs: 80, durationMs: 60, frequency: 'high', vibrate: true },
    'notification': { pulses: 2, intervalMs: 100, durationMs: 100, frequency: 'medium', vibrate: false },
    'input': { pulses: 1, intervalMs: 0, durationMs: 15, frequency: 'high', vibrate: false },
    'success': { pulses: 3, intervalMs: 100, durationMs: 70, frequency: 'high', vibrate: true },
    'warning': { pulses: 2, intervalMs: 120, durationMs: 120, frequency: 'medium', vibrate: false },
  },
};

/** Apply a theme to the sound controller. */
export function applySoundTheme(controller: SoundController, theme: SoundTheme): void {
  for (const [event, pattern] of Object.entries(theme.patterns)) {
    controller.configureEvent(event as SoundEvent, pattern);
  }
}
