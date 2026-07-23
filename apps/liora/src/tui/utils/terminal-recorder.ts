/**
 * TerminalRecorder — record and playback terminal sessions.
 *
 * Provides terminal session recording:
 * - Record terminal output with timestamps
 * - Playback with adjustable speed
 * - Pause/resume playback
 * - Seek to specific time
 * - Export to asciinema format
 * - Session metadata (title, duration, size)
 * - Loop playback
 * - Frame-by-frame stepping
 * - Recording indicators
 * - Session list management
 *
 * Visual style:
 * ┌─ Recording ● ────────────────────────────────────┐
 * │ $ npm run build                                   │
 * │ > tsc && vite build                               │
 * │                                                   │
 * │ ✓ Built in 2.3s                                   │
 * │                                                   │
 * │ [■■■■■■■■■■░░░░░░░░░░] 0:45 / 1:30               │
 * └───────────────────────────────────────────────────┘
 * ▶ Playing | Speed: 1.0x | Frame: 127/254
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecorderFrame {
  readonly time: number; // ms from start
  readonly data: string; // Terminal output
  readonly type: 'output' | 'input' | 'resize';
}

export interface RecordingSession {
  readonly id: string;
  readonly title: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly frames: RecorderFrame[];
  readonly width: number;
  readonly height: number;
  readonly metadata?: Record<string, string>;
}

export interface PlaybackState {
  readonly playing: boolean;
  readonly paused: boolean;
  readonly currentTime: number;
  readonly speed: number;
  readonly frameIndex: number;
  readonly loop: boolean;
}

export interface RecorderRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showProgressBar?: boolean;
  readonly showControls?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// TerminalRecorder
// ---------------------------------------------------------------------------

export class TerminalRecorder {
  private sessions: Map<string, RecordingSession> = new Map();
  private currentSession: RecordingSession | null = null;
  private recording = false;
  private playback: PlaybackState = {
    playing: false,
    paused: false,
    currentTime: 0,
    speed: 1,
    frameIndex: 0,
    loop: false,
  };
  private counter = 0;

  // ─── Recording ───────────────────────────────────────────────────

  /** Start a new recording session. */
  startRecording(title: string, width = 80, height = 24): string {
    const id = `rec-${String(++this.counter)}`;
    this.currentSession = {
      id,
      title,
      startTime: Date.now(),
      frames: [],
      width,
      height,
    };
    this.recording = true;
    return id;
  }

  /** Stop recording. */
  stopRecording(): RecordingSession | null {
    if (!this.currentSession) return null;

    const session: RecordingSession = {
      ...this.currentSession,
      endTime: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.currentSession = null;
    this.recording = false;

    return session;
  }

  /** Record a frame of output. */
  recordOutput(data: string): void {
    if (!this.recording || !this.currentSession) return;

    const frame: RecorderFrame = {
      time: Date.now() - this.currentSession.startTime,
      data,
      type: 'output',
    };

    this.currentSession.frames.push(frame);
  }

  /** Record user input. */
  recordInput(data: string): void {
    if (!this.recording || !this.currentSession) return;

    const frame: RecorderFrame = {
      time: Date.now() - this.currentSession.startTime,
      data,
      type: 'input',
    };

    this.currentSession.frames.push(frame);
  }

  /** Check if currently recording. */
  get isRecording(): boolean {
    return this.recording;
  }

  // ─── Session Management ──────────────────────────────────────────

  /** Get a session by ID. */
  getSession(id: string): RecordingSession | undefined {
    return this.sessions.get(id);
  }

  /** Get all sessions. */
  getSessions(): RecordingSession[] {
    return [...this.sessions.values()];
  }

  /** Delete a session. */
  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  /** Get session duration in ms. */
  getDuration(session: RecordingSession): number {
    if (session.frames.length === 0) return 0;
    return session.frames[session.frames.length - 1]!.time;
  }

  // ─── Playback ────────────────────────────────────────────────────

  /** Start playback of a session. */
  play(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.currentSession = session;
    this.playback = {
      playing: true,
      paused: false,
      currentTime: 0,
      speed: this.playback.speed,
      frameIndex: 0,
      loop: this.playback.loop,
    };
  }

  /** Pause playback. */
  pause(): void {
    this.playback = { ...this.playback, paused: true };
  }

  /** Resume playback. */
  resume(): void {
    this.playback = { ...this.playback, paused: false };
  }

  /** Stop playback. */
  stop(): void {
    this.playback = { ...this.playback, playing: false, paused: false, currentTime: 0, frameIndex: 0 };
  }

  /** Set playback speed. */
  setSpeed(speed: number): void {
    this.playback = { ...this.playback, speed: Math.max(0.25, Math.min(4, speed)) };
  }

  /** Toggle loop mode. */
  toggleLoop(): void {
    this.playback = { ...this.playback, loop: !this.playback.loop };
  }

  /** Seek to a specific time. */
  seek(time: number): void {
    if (!this.currentSession) return;

    const frames = this.currentSession.frames;
    let frameIndex = 0;

    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.time <= time) {
        frameIndex = i;
      } else {
        break;
      }
    }

    this.playback = { ...this.playback, currentTime: time, frameIndex };
  }

  /** Step forward one frame. */
  stepForward(): void {
    if (!this.currentSession) return;

    const nextIndex = Math.min(this.playback.frameIndex + 1, this.currentSession.frames.length - 1);
    const frame = this.currentSession.frames[nextIndex];

    this.playback = {
      ...this.playback,
      frameIndex: nextIndex,
      currentTime: frame?.time ?? this.playback.currentTime,
    };
  }

  /** Step backward one frame. */
  stepBackward(): void {
    if (!this.currentSession) return;

    const prevIndex = Math.max(this.playback.frameIndex - 1, 0);
    const frame = this.currentSession.frames[prevIndex];

    this.playback = {
      ...this.playback,
      frameIndex: prevIndex,
      currentTime: frame?.time ?? 0,
    };
  }

  /** Advance playback by delta time. */
  tick(deltaMs: number): string[] {
    if (!this.playback.playing || this.playback.paused || !this.currentSession) {
      return [];
    }

    const newTime = this.playback.currentTime + deltaMs * this.playback.speed;
    const frames = this.currentSession.frames;
    const duration = this.getDuration(this.currentSession);

    // Check for end
    if (newTime >= duration) {
      if (this.playback.loop) {
        this.playback = { ...this.playback, currentTime: 0, frameIndex: 0 };
        return [];
      }
      this.playback = { ...this.playback, playing: false };
      return [];
    }

    // Collect frames to output
    const output: string[] = [];
    let frameIndex = this.playback.frameIndex;

    while (frameIndex < frames.length && frames[frameIndex]!.time <= newTime) {
      const frame = frames[frameIndex]!;
      if (frame.type === 'output') {
        output.push(frame.data);
      }
      frameIndex++;
    }

    this.playback = { ...this.playback, currentTime: newTime, frameIndex };

    return output;
  }

  /** Get playback state. */
  getPlaybackState(): PlaybackState {
    return this.playback;
  }

  // ─── Export ──────────────────────────────────────────────────────

  /** Export to asciinema v2 format. */
  exportAsciinema(session: RecordingSession): string {
    const header = {
      version: 2,
      width: session.width,
      height: session.height,
      timestamp: Math.floor(session.startTime / 1000),
      title: session.title,
    };

    const lines: string[] = [JSON.stringify(header)];

    for (const frame of session.frames) {
      const timeSec = frame.time / 1000;
      const eventType = frame.type === 'input' ? 'i' : 'o';
      lines.push(JSON.stringify([timeSec, eventType, frame.data]));
    }

    return lines.join('\n');
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the recorder UI. */
  render(options: RecorderRenderOptions): string[] {
    const { width, height, showProgressBar = true, showControls = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Header
    const statusIcon = this.recording ? fg('error', '●') : this.playback.playing ? fg('success', '▶') : dimFg('textMuted', '○');
    const statusText = this.recording ? 'Recording' : this.playback.playing ? (this.playback.paused ? 'Paused' : 'Playing') : 'Idle';
    const title = this.currentSession?.title ?? 'No session';

    lines.push(fg('textMuted', `┌─ ${statusIcon} ${boldFg('text', title)} ${'─'.repeat(Math.max(0, width - title.length - 8))}┐`));

    // Content area (show recent frames)
    const contentHeight = height - (showProgressBar ? 3 : 2) - (showControls ? 2 : 1);
    const frames = this.currentSession?.frames ?? [];
    const visibleFrames = frames.slice(Math.max(0, this.playback.frameIndex - contentHeight + 1), this.playback.frameIndex + 1);

    for (const frame of visibleFrames) {
      const prefix = frame.type === 'input' ? fg('primary', '$ ') : '';
      const content = frame.data.replace(/\n/g, ' ').slice(0, width - 6);
      lines.push(`│ ${prefix}${fg('text', content)}${' '.repeat(Math.max(0, width - content.length - 6))}│`);
    }

    // Fill empty lines
    for (let i = visibleFrames.length; i < contentHeight; i++) {
      lines.push(`│${' '.repeat(width - 2)}│`);
    }

    // Progress bar
    if (showProgressBar && this.currentSession) {
      const duration = this.getDuration(this.currentSession);
      const progress = duration > 0 ? this.playback.currentTime / duration : 0;
      const barWidth = width - 20;
      const filled = Math.round(barWidth * progress);

      const bar = fg('primary', '■'.repeat(filled)) + dimFg('textDim', '░'.repeat(barWidth - filled));
      const timeStr = `${formatTime(this.playback.currentTime)} / ${formatTime(duration)}`;

      lines.push(`│ [${bar}] ${dimFg('textMuted', timeStr)} │`);
    }

    // Bottom border
    lines.push(fg('textMuted', `└${'─'.repeat(width - 2)}┘`));

    // Controls
    if (showControls) {
      const speed = `${this.playback.speed.toFixed(1)}x`;
      const frameInfo = `Frame: ${String(this.playback.frameIndex + 1)}/${String(frames.length)}`;
      const loopIcon = this.playback.loop ? fg('primary', '🔁') : dimFg('textMuted', '🔁');

      lines.push(dimFg('textMuted', ` ${statusText} | Speed: ${speed} | ${frameInfo} ${loopIcon}`));
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
