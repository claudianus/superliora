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
  // Prompt ingestion (server upload/base64 route, TUI paste, ACP) annotates
  // a compressed image with an inline `<system>` caption next to the image.
  // Left inside the user message, that raw markup is user-visible in every
  // history projection (TUI replay, vis, export). Reroute each caption
  // through the built-in system-reminder injection — hidden by its
  // `injection` origin — and keep only the real user content here.
  const { captions, parts } =
    origin.kind === 'user'
      ? splitImageCompressionCaptions(content)
      : { captions: [], parts: [...content] };
  for (const caption of captions) {
    appendSystemReminder(caption, { kind: 'injection', variant: 'image_compression' });
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
    origin: { kind: 'injection', variant: 'local-command-stdout' },
  });
}

// User-initiated `!` shell command. Unlike `injection` (which is skipped on
// replay), `shell_command` origin is replayed and rendered, so resumed
// sessions still show the command and its output. The XML tags carry the
// semantics to the model; the origin drives UI/replay routing.
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
