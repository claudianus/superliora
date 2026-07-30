import { ChatProviderError } from '#/errors';
import type { Message } from '#/message';

import { mergeConsecutiveUserMessages } from '../merge-user-messages';
import type { GoogleContent, GooglePart } from '#/providers/google/google-genai-types';

function toolCallIdToName(toolCallId: string, toolNameById: Map<string, string>): string {
  const name = toolNameById.get(toolCallId);
  if (name !== undefined) return name;
  // Fallback: ids produced by this provider follow the format
  // "{tool_name}_{id_suffix}" where `tool_name` may itself contain
  // underscores (e.g. `fetch_image`) and `id_suffix` is a single trailing
  // token without underscores (e.g. a random hex / UUID fragment). We strip
  // the last "_<suffix>" segment by matching it explicitly — splitting on
  // the first underscore would truncate multi-word tool names like
  // `fetch_image_<id>` to just `fetch`.
  const match = /^(.+)_[^_]+$/.exec(toolCallId);
  return match?.[1] ?? toolCallId;
}

/**
 * Convert a data URL or HTTP URL to a Google GenAI inline/file data part.
 * - data: URLs are parsed into { inlineData: { mimeType, data } }
 * - http(s): URLs use { fileData: { fileUri, mimeType } }
 */
function convertMediaUrl(
  url: string,
  fallbackMimeType: string,
):
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } } {
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',');
    if (commaIndex === -1) {
      return { fileData: { fileUri: url, mimeType: fallbackMimeType } };
    }
    const meta = url.slice(0, commaIndex);
    const data = url.slice(commaIndex + 1);
    const colonIndex = meta.indexOf(':');
    const semiIndex = meta.indexOf(';');
    const mimeType =
      colonIndex !== -1 && semiIndex !== -1
        ? meta.slice(colonIndex + 1, semiIndex)
        : fallbackMimeType;
    return { inlineData: { mimeType, data } };
  }
  // For HTTP(S) URLs, try to guess mime type from extension
  let mimeType = fallbackMimeType;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.png')) mimeType = 'image/png';
    else if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (pathname.endsWith('.gif')) mimeType = 'image/gif';
    else if (pathname.endsWith('.webp')) mimeType = 'image/webp';
    else if (pathname.endsWith('.mp3') || pathname.endsWith('.mpeg')) mimeType = 'audio/mpeg';
    else if (pathname.endsWith('.wav')) mimeType = 'audio/wav';
    else if (pathname.endsWith('.ogg')) mimeType = 'audio/ogg';
  } catch {
    // URL parsing failed, use fallback
  }
  return { fileData: { fileUri: url, mimeType } };
}

function messageToGoogleGenAI(message: Message): GoogleContent {
  if (message.role === 'tool') {
    throw new ChatProviderError(
      'Tool messages must be converted via messagesToGoogleGenAIContents.',
    );
  }

  // GoogleGenAI uses "model" instead of "assistant"
  const role = message.role === 'assistant' ? 'model' : message.role;
  const parts: GooglePart[] = [];

  // Handle content parts
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        parts.push({ text: part.text });
        break;
      case 'think':
        // Skip think parts (synthetic)
        break;
      case 'image_url':
        parts.push(convertMediaUrl(part.imageUrl.url, 'image/jpeg'));
        break;
      case 'audio_url':
        parts.push(convertMediaUrl(part.audioUrl.url, 'audio/mpeg'));
        break;
      case 'video_url':
        parts.push(convertMediaUrl(part.videoUrl.url, 'video/mp4'));
        break;
    }
  }

  // Handle tool calls
  for (const toolCall of message.toolCalls) {
    let args: Record<string, unknown> = {};
    if (toolCall.arguments) {
      try {
        const parsed: unknown = JSON.parse(toolCall.arguments);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          throw new ChatProviderError('Tool call arguments must be a JSON object.');
        }
      } catch (error) {
        if (error instanceof ChatProviderError) throw error;
        throw new ChatProviderError('Tool call arguments must be valid JSON.');
      }
    }

    const functionCallPart: GooglePart = {
      functionCall: {
        name: toolCall.name,
        args,
      },
    };

    // Restore thoughtSignature if available
    if (toolCall.extras && 'thought_signature_b64' in toolCall.extras) {
      functionCallPart['thoughtSignature'] = toolCall.extras['thought_signature_b64'] as string;
    }

    parts.push(functionCallPart);
  }

  return { role, parts };
}

/**
 * Convert a tool message into a list of Google GenAI parts.
 *
 * Returns a `functionResponse` part carrying the text output, followed by
 * independent media parts (`inlineData` / `fileData`) for any image/audio/video
 * content in the tool result. This preserves multimodal tool outputs so the
 * next Gemini/Vertex turn can see them — returning only the text would silently
 * drop media and break tool chains that rely on images or audio.
 */
function toolMessageToFunctionResponseParts(
  message: Message,
  toolNameById: Map<string, string>,
): GooglePart[] {
  if (message.role !== 'tool') {
    throw new ChatProviderError('Expected a tool message.');
  }
  if (message.toolCallId === undefined) {
    throw new ChatProviderError('Tool response is missing `toolCallId`.');
  }

  // Separate text output from media parts
  let textOutput = '';
  const mediaParts: GooglePart[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        if (part.text) textOutput += part.text;
        break;
      case 'image_url':
        mediaParts.push(convertMediaUrl(part.imageUrl.url, 'image/jpeg'));
        break;
      case 'audio_url':
        mediaParts.push(convertMediaUrl(part.audioUrl.url, 'audio/mpeg'));
        break;
      case 'video_url':
        mediaParts.push(convertMediaUrl(part.videoUrl.url, 'video/mp4'));
        break;
      case 'think':
        // Skip — handled separately via reasoning channel.
        break;
    }
  }

  const functionResponsePart: GooglePart = {
    functionResponse: {
      name: toolCallIdToName(message.toolCallId, toolNameById),
      response: { output: textOutput },
      parts: [],
    },
  };

  return [functionResponsePart, ...mediaParts];
}

export function messagesToGoogleGenAIContents(messages: Message[]): GoogleContent[] {
  const contents: GoogleContent[] = [];
  const toolNameById = new Map<string, string>();

  let i = 0;
  while (i < messages.length) {
    const message = messages[i];
    if (message === undefined) break;

    if (message.role === 'system') {
      // Google GenAI's `Content.role` only accepts "user" or "model", so a
      // system message in the history (e.g. from session restore or
      // cross-provider migration) would be rejected by the API. Preserve
      // the content by wrapping it in a `<system>` tag and attaching it as
      // a user turn — mirrors the Anthropic provider's behavior. The
      // dedicated top-level `systemPrompt` still flows into
      // `systemInstruction` separately; only historical system messages
      // come through here.
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (text.length > 0) {
        contents.push({
          role: 'user',
          parts: [{ text: `<system>${text}</system>` }],
        });
      }
      i += 1;
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls.length > 0) {
      contents.push(messageToGoogleGenAI(message));
      const expectedToolCallIds: string[] = [];
      for (const toolCall of message.toolCalls) {
        toolNameById.set(toolCall.id, toolCall.name);
        expectedToolCallIds.push(toolCall.id);
      }

      // Collect consecutive tool messages
      let j = i + 1;
      const toolMessages: Message[] = [];
      while (j < messages.length) {
        const toolMsg = messages[j];
        if (toolMsg === undefined || toolMsg.role !== 'tool') break;
        toolMessages.push(toolMsg);
        j += 1;
      }

      if (toolMessages.length > 0) {
        // Sort tool results to match the order of tool calls in the assistant
        // message, and reject incomplete / duplicated / unexpected results.
        // Gemini/Vertex expects the next user turn to contain a matching set of
        // function responses for the preceding function calls.
        const toolMsgById = new Map<string, Message>();
        const seenToolCallIds = new Set<string>();
        for (const toolMsg of toolMessages) {
          if (toolMsg.toolCallId === undefined) {
            throw new ChatProviderError('Tool response is missing `toolCallId`.');
          }
          if (seenToolCallIds.has(toolMsg.toolCallId)) {
            throw new ChatProviderError(`Duplicate tool response for id: ${toolMsg.toolCallId}`);
          }
          seenToolCallIds.add(toolMsg.toolCallId);
          toolMsgById.set(toolMsg.toolCallId, toolMsg);
        }

        const sortedToolMessages: Message[] = [];
        for (const expectedId of expectedToolCallIds) {
          const msg = toolMsgById.get(expectedId);
          if (msg === undefined) {
            throw new ChatProviderError(`Missing tool responses for ids: ${expectedId}`);
          }
          sortedToolMessages.push(msg);
          toolMsgById.delete(expectedId);
        }
        if (toolMsgById.size > 0) {
          throw new ChatProviderError(
            `Unexpected tool responses for ids: ${JSON.stringify([...toolMsgById.keys()])}`,
          );
        }

        // Pack all tool results into a single user Content.
        // Each tool result may expand to multiple parts (functionResponse +
        // media parts for image/audio/video outputs).
        const parts: GooglePart[] = [];
        for (const toolMsg of sortedToolMessages) {
          parts.push(...toolMessageToFunctionResponseParts(toolMsg, toolNameById));
        }
        contents.push({ role: 'user', parts });
        i = j;
        continue;
      }

      i += 1;
      continue;
    }

    if (message.role === 'tool') {
      // Tool message without preceding assistant message
      const parts: GooglePart[] = toolMessageToFunctionResponseParts(message, toolNameById);
      contents.push({ role: 'user', parts });
      i += 1;
      continue;
    }

    contents.push(messageToGoogleGenAI(message));
    i += 1;
  }

  return mergeConsecutiveUserMessages(contents, {
    isUser: (content) => content.role === 'user',
    isToolResultOnly: (content) =>
      content.parts.length > 0 &&
      content.parts.every((part) => part.functionResponse !== undefined),
    merge: (last, next) => ({ ...last, parts: [...last.parts, ...next.parts] }),
  });
}
