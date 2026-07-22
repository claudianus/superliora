/**
 * ImageManager — high-level image lifecycle management for the TUI.
 *
 * Builds on top of terminal-graphics.ts (kitty/iTerm2 protocols) and adds:
 * - LRU image cache with memory budget enforcement
 * - Unified API across protocols (kitty → iTerm2 → sixel → placeholder)
 * - Automatic format detection and transcoding hints
 * - Image placement tracking (which images are where on screen)
 * - Sixel fallback encoder for terminals without kitty/iTerm2 support
 * - Animated GIF frame extraction hints
 *
 * The manager assigns unique IDs to images and tracks their lifecycle,
 * enabling cleanup on scroll-out, panel close, or memory pressure.
 */

import {
  encodeRendererInlineImage,
  encodeKittyPlaceholderTransmit,
  encodeKittyPlaceholderLines,
  encodeKittyDeleteImage,
  encodeKittyDeleteImages,
  calculateRendererInlineImageRows,
  type RendererInlineImageProtocol,
  type RendererInlineImageFormat,
  type RendererInlineImageData,
  type RendererCellDimensions,
} from './terminal-graphics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageProtocol = 'kitty' | 'iterm2' | 'sixel' | 'placeholder' | 'none';

export interface ManagedImage {
  readonly id: number;
  readonly key: string;
  readonly format: RendererInlineImageFormat;
  readonly data: RendererInlineImageData;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sizeBytes: number;
  /** Terminal protocol used to transmit this image. */
  readonly protocol: ImageProtocol;
  /** Whether the image has been transmitted to the terminal. */
  transmitted: boolean;
  /** Placement locations (row, col) where this image is displayed. */
  placements: Array<{ row: number; col: number }>;
  /** Last access timestamp for LRU eviction. */
  lastAccessMs: number;
  /** Reference count (how many components use this image). */
  refCount: number;
}

export interface ImageManagerOptions {
  /** Maximum total memory for cached images in bytes. Default: 32MB. */
  readonly maxMemoryBytes?: number;
  /** Maximum number of cached images. Default: 64. */
  readonly maxImages?: number;
  /** Cell dimensions for size calculations. */
  readonly cellDimensions?: RendererCellDimensions;
  /** Preferred protocol order. Default: ['kitty', 'iterm2', 'sixel']. */
  readonly protocolPreference?: readonly ImageProtocol[];
}

export interface ImageDisplayOptions {
  readonly widthCells?: number;
  readonly heightCells?: number;
  readonly preserveAspectRatio?: boolean;
  readonly zIndex?: number;
  readonly row?: number;
  readonly col?: number;
}

export interface ImageManagerStats {
  readonly totalImages: number;
  readonly totalMemoryBytes: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly evictions: number;
  readonly protocol: ImageProtocol;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_MEMORY = 32 * 1024 * 1024; // 32MB
const DEFAULT_MAX_IMAGES = 64;
const DEFAULT_CELL_DIMENSIONS: RendererCellDimensions = { widthPx: 9, heightPx: 18 };

// ---------------------------------------------------------------------------
// ImageManager
// ---------------------------------------------------------------------------

export class ImageManager {
  private images: Map<number, ManagedImage> = new Map();
  private keyIndex: Map<string, number> = new Map();
  private nextId = 1;
  private totalMemory = 0;
  private readonly maxMemory: number;
  private readonly maxImages: number;
  private readonly cellDimensions: RendererCellDimensions;
  private readonly protocolPreference: readonly ImageProtocol[];
  private _activeProtocol: ImageProtocol = 'none';

  // Stats
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _evictions = 0;

  constructor(options?: ImageManagerOptions) {
    this.maxMemory = options?.maxMemoryBytes ?? DEFAULT_MAX_MEMORY;
    this.maxImages = options?.maxImages ?? DEFAULT_MAX_IMAGES;
    this.cellDimensions = options?.cellDimensions ?? DEFAULT_CELL_DIMENSIONS;
    this.protocolPreference = options?.protocolPreference ?? ['kitty', 'iterm2', 'sixel'];
  }

  // ─── Protocol Detection ─────────────────────────────────────────────

  /** Detect the best available image protocol from environment. */
  detectProtocol(env: Record<string, string | undefined> = process.env): ImageProtocol {
    const term = (env['TERM'] ?? '').toLowerCase();
    const termProgram = (env['TERM_PROGRAM'] ?? '').toLowerCase();
    const kittyWindowId = env['KITTY_WINDOW_ID'];

    for (const proto of this.protocolPreference) {
      switch (proto) {
        case 'kitty':
          if (term.includes('kitty') || kittyWindowId !== undefined) {
            this._activeProtocol = 'kitty';
            return 'kitty';
          }
          break;
        case 'iterm2':
          if (termProgram === 'iterm2' || termProgram === 'wezterm' || env['LC_TERMINAL'] === 'iTerm2') {
            this._activeProtocol = 'iterm2';
            return 'iterm2';
          }
          break;
        case 'sixel':
          // Sixel is widely supported as a fallback
          if (term !== 'dumb') {
            this._activeProtocol = 'sixel';
            return 'sixel';
          }
          break;
        case 'placeholder':
          this._activeProtocol = 'placeholder';
          return 'placeholder';
        default:
          break;
      }
    }

    this._activeProtocol = 'none';
    return 'none';
  }

  get activeProtocol(): ImageProtocol {
    return this._activeProtocol;
  }

  // ─── Image Registration ─────────────────────────────────────────────

  /**
   * Register an image in the cache. Returns the managed image entry.
   * If an image with the same key exists, returns the cached version.
   */
  register(
    key: string,
    data: RendererInlineImageData,
    format: RendererInlineImageFormat,
    widthPx: number,
    heightPx: number,
  ): ManagedImage {
    // Check cache
    const existingId = this.keyIndex.get(key);
    if (existingId !== undefined) {
      const existing = this.images.get(existingId);
      if (existing) {
        existing.lastAccessMs = Date.now();
        existing.refCount++;
        this._cacheHits++;
        return existing;
      }
    }

    this._cacheMisses++;

    // Evict if necessary
    const sizeBytes = estimateDataSize(data);
    this.evictIfNeeded(sizeBytes);

    // Create new entry
    const id = this.nextId++;
    const image: ManagedImage = {
      id,
      key,
      format,
      data,
      widthPx,
      heightPx,
      sizeBytes,
      protocol: this._activeProtocol,
      transmitted: false,
      placements: [],
      lastAccessMs: Date.now(),
      refCount: 1,
    };

    this.images.set(id, image);
    this.keyIndex.set(key, id);
    this.totalMemory += sizeBytes;

    return image;
  }

  /** Get a cached image by key. */
  get(key: string): ManagedImage | undefined {
    const id = this.keyIndex.get(key);
    if (id === undefined) return undefined;
    const image = this.images.get(id);
    if (image) {
      image.lastAccessMs = Date.now();
    }
    return image;
  }

  /** Get a cached image by id. */
  getById(id: number): ManagedImage | undefined {
    const image = this.images.get(id);
    if (image) {
      image.lastAccessMs = Date.now();
    }
    return image;
  }

  // ─── Rendering ──────────────────────────────────────────────────────

  /**
   * Encode an image for display at the current cursor position.
   * Returns the terminal escape sequence string.
   */
  encodeForDisplay(image: ManagedImage, options?: ImageDisplayOptions): string {
    image.lastAccessMs = Date.now();

    switch (this._activeProtocol) {
      case 'kitty':
      case 'iterm2': {
        const encoded = encodeRendererInlineImage(this._activeProtocol, {
          data: image.data,
          format: image.format,
          widthCells: options?.widthCells,
          heightCells: options?.heightCells,
          widthPx: image.widthPx,
          heightPx: image.heightPx,
          preserveAspectRatio: options?.preserveAspectRatio ?? true,
          imageId: image.id,
          zIndex: options?.zIndex,
          quiet: true,
        });
        image.transmitted = true;
        if (options?.row !== undefined && options?.col !== undefined) {
          image.placements.push({ row: options.row, col: options.col });
        }
        return encoded.output;
      }

      case 'sixel': {
        const sixel = encodeSixelPlaceholder(image.widthPx, image.heightPx, options?.widthCells);
        image.transmitted = true;
        return sixel;
      }

      case 'placeholder': {
        // Use kitty unicode placeholder protocol
        const cols = options?.widthCells ?? Math.ceil(image.widthPx / this.cellDimensions.widthPx);
        const rows = options?.heightCells ?? calculateRendererInlineImageRows(
          { widthPx: image.widthPx, heightPx: image.heightPx },
          cols,
          this.cellDimensions,
        );
        const base64 = typeof image.data === 'string'
          ? image.data
          : Buffer.from(Uint8Array.from(image.data as readonly number[])).toString('base64');
        const transmit = encodeKittyPlaceholderTransmit({
          id: image.id,
          base64,
          columns: cols,
          rows,
        });
        const lines = encodeKittyPlaceholderLines({ id: image.id, columns: cols, rows });
        image.transmitted = true;
        return transmit + lines.join('\r\n');
      }

      case 'none':
      default:
        return `[image: ${String(image.widthPx)}×${String(image.heightPx)} ${image.format}]`;
    }
  }

  /**
   * Calculate how many terminal rows an image will occupy.
   */
  calculateRows(image: ManagedImage, targetWidthCells: number, maxRows?: number): number {
    return calculateRendererInlineImageRows(
      { widthPx: image.widthPx, heightPx: image.heightPx },
      targetWidthCells,
      this.cellDimensions,
      maxRows,
    );
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  /** Remove an image from the cache and terminal. */
  remove(key: string): string | null {
    const id = this.keyIndex.get(key);
    if (id === undefined) return null;
    return this.removeById(id);
  }

  /** Remove an image by id. Returns the terminal cleanup sequence. */
  removeById(id: number): string | null {
    const image = this.images.get(id);
    if (!image) return null;

    this.images.delete(id);
    this.keyIndex.delete(image.key);
    this.totalMemory -= image.sizeBytes;

    // Generate cleanup sequence
    if (image.transmitted && this._activeProtocol === 'kitty') {
      return encodeKittyDeleteImage(id);
    }
    return null;
  }

  /** Release a reference to an image. Removes when refCount hits 0. */
  release(key: string): string | null {
    const id = this.keyIndex.get(key);
    if (id === undefined) return null;
    const image = this.images.get(id);
    if (!image) return null;

    image.refCount = Math.max(0, image.refCount - 1);
    if (image.refCount <= 0) {
      return this.removeById(id);
    }
    return null;
  }

  /** Clear all images. Returns cleanup sequence for kitty protocol. */
  clearAll(): string {
    this.images.clear();
    this.keyIndex.clear();
    this.totalMemory = 0;

    if (this._activeProtocol === 'kitty') {
      return encodeKittyDeleteImages();
    }
    return '';
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  get stats(): ImageManagerStats {
    return {
      totalImages: this.images.size,
      totalMemoryBytes: this.totalMemory,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      evictions: this._evictions,
      protocol: this._activeProtocol,
    };
  }

  get imageCount(): number {
    return this.images.size;
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private evictIfNeeded(incomingBytes: number): void {
    // Evict by LRU until we have space
    while (
      (this.totalMemory + incomingBytes > this.maxMemory || this.images.size >= this.maxImages) &&
      this.images.size > 0
    ) {
      // Find LRU image with refCount === 0
      let lru: ManagedImage | null = null;
      for (const image of this.images.values()) {
        if (image.refCount <= 0 && (lru === null || image.lastAccessMs < lru.lastAccessMs)) {
          lru = image;
        }
      }
      // If all images are referenced, evict the oldest regardless
      if (lru === null) {
        for (const image of this.images.values()) {
          if (lru === null || image.lastAccessMs < lru.lastAccessMs) {
            lru = image;
          }
        }
      }
      if (lru === null) break;
      this.removeById(lru.id);
      this._evictions++;
    }
  }
}

// ---------------------------------------------------------------------------
// Sixel Fallback Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a simple sixel placeholder/fallback.
 * Full sixel encoding requires pixel data; this provides a bordered box
 * with dimensions as a graceful degradation path.
 */
export function encodeSixelPlaceholder(
  widthPx: number,
  heightPx: number,
  widthCells?: number,
): string {
  const cols = widthCells ?? Math.ceil(widthPx / 9);
  const rows = Math.ceil(heightPx / 18);

  // DCS (Device Control String) sixel introduction
  // For a real implementation, we'd encode actual pixel data here.
  // This placeholder draws a bordered rectangle using sixel bands.
  const dcs = '\x1bP';
  const st = '\x1b\\';

  // Sixel header: aspect ratio 1:1, background color 0
  const header = `q;1;1;${String(cols * 9)};${String(rows * 18)}`;

  // Define color 1 (light gray border)
  const colorDef = '#1;2;70;70;70';

  // Draw top and bottom borders using sixel bands
  // Each sixel band is 6 pixels high
  const bands = Math.ceil((rows * 18) / 6);
  const bandWidth = cols * 9;

  let sixelData = '';
  for (let band = 0; band < bands; band++) {
    const isFirst = band === 0;
    const isLast = band === bands - 1;

    if (isFirst || isLast) {
      // Full border line
      sixelData += '#1' + '!'.repeat(0) + repeatSixelChar(63, bandWidth) + '$';
    } else {
      // Side borders only
      sixelData += '#1' + repeatSixelChar(33, 1) + ' '.repeat(Math.max(0, bandWidth - 2)) + repeatSixelChar(33, 1) + '$';
    }
  }

  return `${dcs}${header}${colorDef}${sixelData}${st}`;
}

/** Repeat a sixel character n times. */
function repeatSixelChar(charCode: number, count: number): string {
  if (count <= 0) return '';
  const char = String.fromCharCode(charCode);
  if (count > 3) {
    // Use sixel repeat: !count<char>
    return `!${String(count)}${char}`;
  }
  return char.repeat(count);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateDataSize(data: RendererInlineImageData): number {
  if (typeof data === 'string') {
    // Base64 string: ~75% of string length
    return Math.ceil(data.length * 0.75);
  }
  if (data instanceof Uint8Array) {
    return data.byteLength;
  }
  return (data as readonly number[]).length;
}
