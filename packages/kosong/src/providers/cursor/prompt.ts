/**
 * Fold SuperLiora message history into a single Cursor agent prompt.
 *
 * Tool definitions are advertised separately as MCP tools; prior tool_use /
 * tool_result turns are inlined as XML so a fresh AgentService/Run can resume
 * after SuperLiora executes tools (stateless bridge, same shape as shunt).
 */

import type { ContentPart, Message } from '#/message';

export function renderCursorPrompt(systemPrompt: string, history: readonly Message[]): string {
  const sections: string[] = [];
  const system = systemPrompt.trim();
  if (system.length > 0) {
    sections.push(`<system>\n${system}\n</system>`);
  }
  for (const message of history) {
    const body = renderMessage(message);
    if (body === undefined) continue;
    sections.push(`<${message.role}>\n${body}\n</${message.role}>`);
  }
  return sections.join('\n\n');
}

function renderMessage(message: Message): string | undefined {
  const parts: string[] = [];
  for (const part of message.content) {
    const rendered = renderContentPart(part);
    if (rendered !== undefined) parts.push(rendered);
  }
  if (message.role === 'assistant') {
    for (const call of message.toolCalls) {
      parts.push(
        `<tool_use id="${escapeXml(call.id)}" name="${escapeXml(call.name)}">\n${call.arguments ?? '{}'}\n</tool_use>`,
      );
    }
  }
  if (message.role === 'tool') {
    const id = message.toolCallId ?? 'unknown';
    const text = message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    parts.push(`<tool_result tool_use_id="${escapeXml(id)}">\n${text}\n</tool_result>`);
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function renderContentPart(part: ContentPart): string | undefined {
  switch (part.type) {
    case 'text':
      return part.text.length > 0 ? part.text : undefined;
    case 'think':
      return part.think.length > 0 ? `<thinking>\n${part.think}\n</thinking>` : undefined;
    case 'image_url':
      return `[image: ${part.imageUrl.url}]`;
    case 'audio_url':
      return `[audio: ${part.audioUrl.url}]`;
    case 'video_url':
      return `[video: ${part.videoUrl.url}]`;
    default: {
      const exhaustive: never = part;
      void exhaustive;
      return undefined;
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
