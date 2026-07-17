/**
 * LLM-oriented HTML cleanup.
 *
 * Thin integration around Defuddle (Obsidian Web Clipper's extractor):
 * article detection + chrome stripping + markdown conversion. We do not
 * reimplement HTML→text here — Defuddle is the source of truth.
 *
 * @see https://github.com/kepano/defuddle
 */

import { Defuddle } from 'defuddle/node';

export interface HtmlToLlmTextOptions {
  /** Source URL — helps resolve relative links and site-specific extractors. */
  readonly url?: string;
  /** Force a content container when auto-detection would pick chrome. */
  readonly contentSelector?: string;
  /** Soft cap on returned markdown length. */
  readonly maxChars?: number;
  /** Drop images from the markdown (token-saving default for research). */
  readonly removeImages?: boolean;
}

export interface HtmlToLlmTextResult {
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
}

/**
 * Convert a full HTML document (or fragment) into compact markdown for LLMs.
 *
 * Always local: third-party extractor fallbacks are disabled (`useAsync: false`).
 */
export async function htmlToLlmText(
  html: string,
  options: HtmlToLlmTextOptions = {},
): Promise<HtmlToLlmTextResult> {
  const result = await Defuddle(html, options.url, {
    markdown: true,
    useAsync: false,
    removeImages: options.removeImages ?? true,
    contentSelector: options.contentSelector,
  });

  const title = (result.title ?? '').trim();
  let content = (result.content ?? '').trim();
  if (options.maxChars !== undefined && options.maxChars > 0 && content.length > options.maxChars) {
    content = `${content.slice(0, Math.max(0, options.maxChars - 20)).trimEnd()}\n\n[...truncated]`;
  }

  return {
    title,
    content,
    wordCount: result.wordCount ?? 0,
  };
}
