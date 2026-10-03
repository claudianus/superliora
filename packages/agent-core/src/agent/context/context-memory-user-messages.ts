import type { ContentPart } from '@superliora/kosong';

import { escapeXml } from '../../utils/xml-escape';
import { splitImageCompressionCaptions } from './message-helpers';
import { USER_PROMPT_ORIGIN, type ContextMessage, type PromptOrigin } from './types';

export function appendUserMessageToContext(
  content: readonly ContentPart[],
  origin: PromptOrigin = USER_PROMPT_ORIGIN,
  appendMessage: (message: ContextMessage) => void,
  appendSystemReminder: (content: string, origin: PromptOrigin) => void,
): void {
  if (content.length === 0) return;
  // Image preprocessing contributes factual metadata, not a user prompt.
  const { captions, parts } =
    origin.kind === 'user'
      ? splitImageCompressionCaptions(content)
      : { captions: [], parts: [...content] };
  for (const caption of captions) {
    appendSystemReminder(caption, { kind: 'system_trigger', name: 'image_compression' });
  }
  if (parts.length === 0) return;
  appendMessage({
    role: 'user',
    content: parts,
    toolCalls: [],
    origin,
  });
}

export function appendSystemReminderToContext(
  content: string,
  origin: PromptOrigin,
  appendMessage: (message: ContextMessage) => void,
): void {
  const text = `<system-reminder>\n${content.trim()}\n</system-reminder>`;
  appendMessage({
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin,
  });
}

export function appendLocalCommandStdoutToContext(
  content: string,
  appendMessage: (message: ContextMessage) => void,
): void {
  const text = `<local-command-stdout>\n${content.trim()}\n</local-command-stdout>`;
  appendMessage({
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin: { kind: 'system_trigger', name: 'local-command-stdout' },
  });
}

// Explicit operator shell input and output stay visible on replay.
export function appendBashInputToContext(
  command: string,
  appendMessage: (message: ContextMessage) => void,
): void {
  const text = `<bash-input>\n${escapeXml(command)}\n</bash-input>`;
  appendMessage({
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin: { kind: 'shell_command', phase: 'input' },
  });
}

export function appendBashOutputToContext(
  stdout: string,
  stderr: string,
  isError: boolean | undefined,
  appendMessage: (message: ContextMessage) => void,
): void {
  const text = `<bash-stdout>${escapeXml(stdout)}</bash-stdout><bash-stderr>${escapeXml(stderr)}</bash-stderr>`;
  appendMessage({
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin:
      isError === true
        ? { kind: 'shell_command', phase: 'output', isError: true }
        : { kind: 'shell_command', phase: 'output' },
  });
}
