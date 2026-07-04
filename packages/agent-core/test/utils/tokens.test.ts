import type { ContentPart, Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  estimateTokensForContentPart,
  estimateTokensForMessage,
  MEDIA_TOKEN_ESTIMATE,
} from '../../src/utils/tokens';

describe('estimateTokensForContentPart', () => {
  const imagePart: ContentPart = {
    type: 'image_url',
    imageUrl: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
  };
  const audioPart: ContentPart = {
    type: 'audio_url',
    audioUrl: { url: 'data:audio/mp3;base64,AAAA' },
  };
  const videoPart: ContentPart = {
    type: 'video_url',
    videoUrl: { url: 'data:video/mp4;base64,AAAA' },
  };

  it('estimates media parts as a substantial non-zero token cost', () => {
    expect(estimateTokensForContentPart(imagePart)).toBe(MEDIA_TOKEN_ESTIMATE);
    expect(estimateTokensForContentPart(audioPart)).toBe(MEDIA_TOKEN_ESTIMATE);
    expect(estimateTokensForContentPart(videoPart)).toBe(MEDIA_TOKEN_ESTIMATE);
    expect(MEDIA_TOKEN_ESTIMATE).toBeGreaterThan(100);
  });

  it('uses a bounded estimate instead of counting base64 payload text', () => {
    const huge = 'A'.repeat(4_000_000);
    const bigImage: ContentPart = {
      type: 'image_url',
      imageUrl: { url: `data:image/png;base64,${huge}` },
    };

    const estimate = estimateTokensForContentPart(bigImage);
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeLessThan(50_000);
  });

  it('includes media when estimating a whole message', () => {
    const message: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'see screenshot' }, imagePart],
      toolCalls: [],
    };

    expect(estimateTokensForMessage(message)).toBeGreaterThan(100);
  });
});
