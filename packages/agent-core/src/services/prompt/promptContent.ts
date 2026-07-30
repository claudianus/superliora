import type { PromptSubmission } from '@superliora/protocol';

import type { PromptState } from './promptState';

export type CorePromptPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly imageUrl: { readonly url: string } }
  | { readonly type: 'video_url'; readonly videoUrl: { readonly url: string } };

export function contentToCoreParts(content: PromptSubmission['content']): CorePromptPart[] {
  const input: CorePromptPart[] = [];
  for (const part of content) {
    switch (part.type) {
      case 'text':
        input.push({ type: 'text', text: part.text });
        break;
      case 'image':
        if (part.source.kind === 'url') {
          input.push({
            type: 'image_url',
            imageUrl: { url: part.source.url },
          });
        } else if (part.source.kind === 'base64') {
          input.push({
            type: 'image_url',
            imageUrl: {
              url: `data:${part.source.media_type};base64,${part.source.data}`,
            },
          });
        }
        break;
      case 'video':
        if (part.source.kind === 'url') {
          input.push({
            type: 'video_url',
            videoUrl: { url: part.source.url },
          });
        } else if (part.source.kind === 'base64') {
          input.push({
            type: 'video_url',
            videoUrl: {
              url: `data:${part.source.media_type};base64,${part.source.data}`,
            },
          });
        }
        break;
      case 'file':
      case 'thinking':
      case 'tool_result':
      case 'tool_use':
        break;
    }
  }
  return input;
}

export function steerContentToCoreParts(states: readonly PromptState[]): CorePromptPart[] {
  const textBodies: string[] = [];
  let allText = true;
  for (const state of states) {
    const texts: string[] = [];
    for (const part of state.body.content) {
      if (part.type !== 'text') {
        allText = false;
        break;
      }
      texts.push(part.text);
    }
    if (!allText) break;
    textBodies.push(texts.join('\n'));
  }
  if (allText) {
    return [{ type: 'text', text: textBodies.join('\n\n') }];
  }

  const input: CorePromptPart[] = [];
  states.forEach((state, index) => {
    if (index > 0) input.push({ type: 'text', text: '\n\n' });
    input.push(...contentToCoreParts(state.body.content));
  });
  return input;
}
