/**
 * FileUpload — drag-drop zones and upload queue management.
 *
 * Provides modern file upload UI:
 * - Drag-and-drop zone visualization
 * - Upload queue with progress
 * - File type icons
 * - Size formatting
 * - Upload speed and ETA
 * - Retry/cancel actions
 * - Batch upload support
 * - Validation (size, type limits)
 * - Thumbnail previews (for images)
 * - Error states with messages
 * - Pause/resume support
 * - Overall progress aggregation
 *
 * Visual style:
 * ┌─────────────────────────────────────────────────┐
 * │                                                 │
 * │              📁 Drop files here                 │
 * │           or click to browse                    │
 * │                                                 │
 * └─────────────────────────────────────────────────┘
 *
 * Upload Queue:
 * ┌─────────────────────────────────────────────────┐
 * │ 📄 report.pdf              2.4 MB    ████░ 78%  │
 * │ 🖼️ screenshot.png          1.1 MB    ██░░░ 45%  │
 * │ 📦 archive.zip            15.2 MB    ░░░░░ 12%  │
 * │ ❌ invalid.exe             —         Rejected   │
 * └─────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus = 'pending' | 'uploading' | 'paused' | 'complete' | 'error' | 'cancelled';

export interface UploadFile {
  readonly id: string;
  readonly name: string;
  readonly size: number; // bytes
  readonly type?: string; // MIME type
  readonly path?: string;
  readonly status: UploadStatus;
  readonly progress: number; // 0-1
  readonly speed?: number; // bytes/sec
  readonly error?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface UploadQueueRenderOptions {
  readonly width: number;
  readonly showSpeed?: boolean;
  readonly showEta?: boolean;
  readonly compact?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface DropZoneRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly active?: boolean; // Drag hovering
  readonly disabled?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface UploadValidation {
  readonly maxSize?: number; // bytes
  readonly allowedTypes?: string[]; // MIME types or extensions
  readonly maxFiles?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_ICONS: Record<string, string> = {
  // Images
  'image/png': '🖼️', 'image/jpeg': '🖼️', 'image/gif': '🖼️', 'image/svg+xml': '🖼️',
  // Documents
  'application/pdf': '📄', 'text/plain': '📝', 'text/markdown': '📝',
  // Archives
  'application/zip': '📦', 'application/x-tar': '📦', 'application/gzip': '📦',
  // Code
  'text/javascript': '📜', 'text/typescript': '📜', 'application/json': '📜',
  // Video/Audio
  'video/mp4': '🎬', 'audio/mpeg': '🎵',
  // Default
  'default': '📎',
};

const STATUS_ICONS: Record<UploadStatus, string> = {
  pending: '⏳',
  uploading: '⬆️',
  paused: '⏸️',
  complete: '✓',
  error: '✗',
  cancelled: '⊘',
};

const STATUS_COLORS: Record<UploadStatus, string> = {
  pending: 'textMuted',
  uploading: 'primary',
  paused: 'warning',
  complete: 'success',
  error: 'error',
  cancelled: 'textDim',
};

// ---------------------------------------------------------------------------
// FileUploadQueue
// ---------------------------------------------------------------------------

export class FileUploadQueue {
  private files: UploadFile[] = [];
  private validation: UploadValidation;
  private counter = 0;

  constructor(validation: UploadValidation = {}) {
    this.validation = validation;
  }

  // ─── File Management ─────────────────────────────────────────────

  /** Add a file to the queue. */
  addFile(file: { name: string; size: number; type?: string; path?: string }): string | { error: string } {
    // Validate
    const validationError = this.validateFile(file);
    if (validationError) {
      return { error: validationError };
    }

    const id = `upload-${String(++this.counter)}`;
    const uploadFile: UploadFile = {
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      path: file.path,
      status: 'pending',
      progress: 0,
    };

    this.files.push(uploadFile);
    return id;
  }

  /** Remove a file from the queue. */
  removeFile(id: string): void {
    this.files = this.files.filter((f) => f.id !== id);
  }

  /** Clear completed files. */
  clearCompleted(): void {
    this.files = this.files.filter((f) => f.status !== 'complete');
  }

  /** Clear all files. */
  clearAll(): void {
    this.files = [];
  }

  private validateFile(file: { name: string; size: number; type?: string }): string | null {
    // Size validation
    if (this.validation.maxSize && file.size > this.validation.maxSize) {
      return `File too large (max ${formatBytes(this.validation.maxSize)})`;
    }

    // Type validation
    if (this.validation.allowedTypes && this.validation.allowedTypes.length > 0) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const typeAllowed = this.validation.allowedTypes.some((t) =>
        t === file.type || t === `.${ext}` || t === ext,
      );
      if (!typeAllowed) {
        return `File type not allowed (${file.type ?? ext ?? 'unknown'})`;
      }
    }

    // Count validation
    if (this.validation.maxFiles && this.files.length >= this.validation.maxFiles) {
      return `Too many files (max ${String(this.validation.maxFiles)})`;
    }

    return null;
  }

  // ─── Upload Control ──────────────────────────────────────────────

  /** Start uploading a file. */
  startUpload(id: string): void {
    this.files = this.files.map((f) =>
      f.id === id && f.status === 'pending'
        ? { ...f, status: 'uploading' as const, startedAt: Date.now() }
        : f,
    );
  }

  /** Update upload progress. */
  updateProgress(id: string, progress: number, speed?: number): void {
    this.files = this.files.map((f) => {
      if (f.id !== id) return f;

      const isComplete = progress >= 1;
      return {
        ...f,
        progress: Math.min(1, progress),
        speed,
        status: isComplete ? 'complete' as const : f.status,
        completedAt: isComplete ? Date.now() : f.completedAt,
      };
    });
  }

  /** Pause an upload. */
  pauseUpload(id: string): void {
    this.files = this.files.map((f) =>
      f.id === id && f.status === 'uploading'
        ? { ...f, status: 'paused' as const }
        : f,
    );
  }

  /** Resume an upload. */
  resumeUpload(id: string): void {
    this.files = this.files.map((f) =>
      f.id === id && f.status === 'paused'
        ? { ...f, status: 'uploading' as const }
        : f,
    );
  }

  /** Cancel an upload. */
  cancelUpload(id: string): void {
    this.files = this.files.map((f) =>
      f.id === id && (f.status === 'uploading' || f.status === 'paused' || f.status === 'pending')
        ? { ...f, status: 'cancelled' as const }
        : f,
    );
  }

  /** Mark upload as failed. */
  failUpload(id: string, error: string): void {
    this.files = this.files.map((f) =>
      f.id === id ? { ...f, status: 'error' as const, error } : f,
    );
  }

  /** Retry a failed upload. */
  retryUpload(id: string): void {
    this.files = this.files.map((f) =>
      f.id === id && f.status === 'error'
        ? { ...f, status: 'pending' as const, progress: 0, error: undefined }
        : f,
    );
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all files. */
  getFiles(): readonly UploadFile[] {
    return this.files;
  }

  /** Get file by ID. */
  getFile(id: string): UploadFile | undefined {
    return this.files.find((f) => f.id === id);
  }

  /** Get overall progress (0-1). */
  getOverallProgress(): number {
    if (this.files.length === 0) return 0;
    const total = this.files.reduce((sum, f) => sum + f.size, 0);
    const uploaded = this.files.reduce((sum, f) => sum + f.size * f.progress, 0);
    return total > 0 ? uploaded / total : 0;
  }

  /** Get total size. */
  getTotalSize(): number {
    return this.files.reduce((sum, f) => sum + f.size, 0);
  }

  /** Get uploaded size. */
  getUploadedSize(): number {
    return this.files.reduce((sum, f) => sum + f.size * f.progress, 0);
  }

  /** Get active upload count. */
  getActiveCount(): number {
    return this.files.filter((f) => f.status === 'uploading').length;
  }

  /** Get pending count. */
  getPendingCount(): number {
    return this.files.filter((f) => f.status === 'pending').length;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the upload queue. */
  renderQueue(options: UploadQueueRenderOptions): string[] {
    const { width, showSpeed = true, showEta = true, compact = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    if (this.files.length === 0) {
      return [dimFg('textMuted', '  (no files in queue)')];
    }

    // Header
    const totalSize = formatBytes(this.getTotalSize());
    const uploaded = formatBytes(this.getUploadedSize());
    lines.push(boldFg('text', ` Upload Queue ${dimFg('textMuted', `(${uploaded} / ${totalSize})`)}`));
    lines.push(dimFg('textMuted', '─'.repeat(width)));

    // Files
    for (const file of this.files) {
      lines.push(...this.renderFileRow(file, { width, showSpeed, showEta, compact, fg, boldFg, dimFg }));
    }

    // Overall progress
    const overall = this.getOverallProgress();
    if (overall > 0 && overall < 1) {
      lines.push('');
      const barWidth = width - 10;
      const filled = Math.round(barWidth * overall);
      const bar = fg('primary', '█'.repeat(filled)) + dimFg('textDim', '░'.repeat(barWidth - filled));
      lines.push(` Total: [${bar}] ${String(Math.round(overall * 100)).padStart(3)}%`);
    }

    return lines;
  }

  private renderFileRow(file: UploadFile, options: UploadQueueRenderOptions): string[] {
    const { width, showSpeed, showEta, compact, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const icon = this.getFileIcon(file);
    const statusIcon = fg(STATUS_COLORS[file.status], STATUS_ICONS[file.status]);
    const name = this.truncate(file.name, Math.floor(width * 0.4));
    const size = formatBytes(file.size);

    if (file.status === 'error') {
      lines.push(` ${statusIcon} ${icon} ${fg('error', name)} ${dimFg('textMuted', size)}`);
      if (file.error) {
        lines.push(`   ${dimFg('error', file.error)}`);
      }
      return lines;
    }

    if (file.status === 'complete') {
      lines.push(` ${fg('success', '✓')} ${icon} ${fg('text', name)} ${dimFg('textMuted', size)}`);
      return lines;
    }

    // Progress bar
    const barWidth = Math.floor(width * 0.25);
    const filled = Math.round(barWidth * file.progress);
    const bar = fg('primary', '█'.repeat(filled)) + dimFg('textDim', '░'.repeat(barWidth - filled));
    const pct = String(Math.round(file.progress * 100)).padStart(3);

    let meta = '';
    if (showSpeed && file.speed) {
      meta += ` ${dimFg('textMuted', `${formatBytes(file.speed)}/s`)}`;
    }
    if (showEta && file.speed && file.speed > 0) {
      const remaining = (file.size * (1 - file.progress)) / file.speed;
      meta += ` ${dimFg('textMuted', `ETA ${formatDuration(remaining * 1000)}`)}`;
    }

    lines.push(` ${statusIcon} ${icon} ${fg('text', name)} [${bar}] ${pct}%${meta}`);

    return lines;
  }

  /** Render the drop zone. */
  renderDropZone(options: DropZoneRenderOptions): string[] {
    const { width, height, active = false, disabled = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 4;
    const innerHeight = height - 2;

    const borderColor = disabled ? 'textDim' : active ? 'accent' : 'textMuted';
    const border = (char: string) => fg(borderColor, char);

    // Top border
    lines.push(border(`┌${'─'.repeat(innerWidth)}┐`));

    // Content
    const icon = disabled ? '🚫' : active ? '📥' : '📁';
    const title = disabled ? 'Uploads disabled' : active ? 'Release to upload' : 'Drop files here';
    const subtitle = disabled ? '' : 'or click to browse';

    for (let i = 0; i < innerHeight; i++) {
      let content = '';
      const mid = Math.floor(innerHeight / 2);

      if (i === mid - 1) {
        content = this.padCenter(`${icon} ${title}`, innerWidth);
      } else if (i === mid && subtitle) {
        content = this.padCenter(dimFg('textMuted', subtitle), innerWidth);
      } else {
        content = ' '.repeat(innerWidth);
      }

      lines.push(`${border('│')}${active ? fg('accent', content) : fg('textMuted', content)}${border('│')}`);
    }

    // Bottom border
    lines.push(border(`└${'─'.repeat(innerWidth)}┘`));

    return lines;
  }

  private getFileIcon(file: UploadFile): string {
    if (file.type && FILE_ICONS[file.type]) {
      return FILE_ICONS[file.type]!;
    }
    // Check extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    const extIcons: Record<string, string> = {
      ts: '📜', tsx: '📜', js: '📜', jsx: '📜', json: '📜',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
      pdf: '📄', doc: '📄', docx: '📄', txt: '📝', md: '📝',
      zip: '📦', tar: '📦', gz: '📦', rar: '📦',
      mp4: '🎬', mov: '🎬', avi: '🎬',
      mp3: '🎵', wav: '🎵', flac: '🎵',
    };
    return ext && extIcons[ext] ? extIcons[ext]! : FILE_ICONS['default']!;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }

  private padCenter(text: string, width: number): string {
    const plainLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - plainLen);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}
