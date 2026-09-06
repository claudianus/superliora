import type { ModelCapability } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { ReadMediaFileTool } from '../../src/tools/builtin/file/read-media';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';

function capability(input: Partial<ModelCapability>): ModelCapability {
  return input as ModelCapability;
}

function makeTool(capabilities: Partial<ModelCapability>): ReadMediaFileTool {
  return new ReadMediaFileTool(createFakeKaos(), PERMISSIVE_WORKSPACE, capability(capabilities));
}

describe('ReadMediaFileTool description by capabilities', () => {
  it('mentions image and video when both capabilities are present', () => {
    const tool = makeTool({ image_in: true, video_in: true });
    expect(tool.description).toContain('supports image and video');
  });

  it('mentions image but flags video unsupported when only image_in is present', () => {
    const tool = makeTool({ image_in: true, video_in: false });
    expect(tool.description).toContain('supports image files for the current model');
    expect(tool.description).not.toContain('supports video files');
  });

  it('mentions video but flags image unsupported when only video_in is present', () => {
    const tool = makeTool({ image_in: false, video_in: true });
    expect(tool.description).toContain('supports video files for the current model');
    expect(tool.description).not.toContain('supports image files');
  });

  it('mentions pdf support when pdf_in is present', () => {
    const tool = makeTool({ image_in: true, video_in: true, pdf_in: true });
    expect(tool.description).toContain('supports PDF files for the current model');
  });

  it('flags pdf unsupported when pdf_in is absent', () => {
    const tool = makeTool({ image_in: true, video_in: true, pdf_in: false });
    expect(tool.description).toContain('PDF files are not supported');
  });

  it('mentions audio support when audio_in is present', () => {
    const tool = makeTool({ image_in: true, video_in: true, audio_in: true });
    expect(tool.description).toContain('supports audio files for the current model');
  });

  it('throws when no media capability is present', () => {
    expect(() =>
      makeTool({ image_in: false, video_in: false, audio_in: false, pdf_in: false }),
    ).toThrow(/image_in, video_in, audio_in, or pdf_in/);
  });

  it('description pins the stable contract phrases: image+video, 100MB, parallel reads, Read pointer', () => {
    const tool = makeTool({ image_in: true, video_in: true });
    expect(tool.description).toContain('image and video');
    expect(tool.description).toContain('100MB');
    expect(tool.description).toContain('parallel');
    // TS renamed the sibling tool to `Read` (py was `ReadFile`); the
    // description must still point readers at the text-file tool.
    expect(tool.description).toContain('text files use Read');
  });
});
