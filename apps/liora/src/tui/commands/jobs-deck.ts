/**
 * Job Deck opener — mounts the interactive Conductor monitoring viewer
 * (deck list + worker transcript drill-down). Shared by `/jobs deck`, the
 * Command Hub row, and Job Desk card clicks (mouse router).
 */

import type { SlashCommandHost } from './hub/dispatch';
import { formatShellCommandPreview } from '../components/media/code-highlight';
import {
  JobDeckViewerComponent,
  type JobDeckWorkerLoad,
} from '../components/dialogs/job-deck/job-deck-viewer';
import type { ConductorJobCard } from '../utils/job/job-strip';
import {
  emptyConductorJobsSnapshot,
  resolveConductorJobCard,
} from '../utils/job/job-strip';
import { formatErrorMessage } from '../utils/event-payload';
import { formatTranscriptOutput } from '../utils/transcript/transcript-output-format';
import { shortJobId } from '../components/job-board/job-board-helpers';
import {
  hotpathJobCancel,
  hotpathJobResume,
  hotpathJobSteer,
} from './job-hotpath';
import { resyncJobBoardFromSession } from '../features/control-tower/job-resync';
import {
  rememberOpenSurface,
  SURFACE_JOB_DECK,
  toggleOffOpenSurface,
} from '../features/surfaces/editor-surface-toggle';
import { openMergePreview } from '../features/control-tower/merge-preview-controller';
import { openPushPreview } from '../features/control-tower/push-preview-controller';
import { ttui } from '../utils/tui-i18n';

export function openJobDeckViewer(host: SlashCommandHost, jobId?: string): void {
  // Alt+J on an empty deck request toggles the already-open viewer shut so it
  // behaves like the overlay the homepage demo shows, instead of remounting.
  if (jobId === undefined && toggleOffOpenSurface(host, SURFACE_JOB_DECK)) return;
  if (host.session === undefined) {
    host.showError(ttui('tui.jobs.deckNoSession'));
    return;
  }
  const snapshot = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  // Empty sessions: never force the board into the composer.
  if (snapshot.jobs.length === 0) {
    host.showStatus(ttui('tui.session.noJobsYet'), 'textMuted');
    return;
  }

  const resolved =
    jobId === undefined ? undefined : resolveConductorJobCard(snapshot.jobs, jobId);
  if (jobId !== undefined && resolved === undefined) {
    host.showStatus(
      `No Conductor job matches ${jobId}. Use /jobs deck to browse, or pass a full/short job id.`,
      'warning',
    );
    return;
  }

  const panel = new JobDeckViewerComponent({
    getSnapshot: () => host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot(),
    initialJobId: resolved?.id,
    loadWorker: (card) => loadJobDeckWorker(host, card),
    onAction: (action, card, text) => routeJobDeckAction(host, action, card, text),
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
  host.mountEditorReplacement(panel);
  rememberOpenSurface(SURFACE_JOB_DECK, panel);

  void resyncJobBoardFromSession(host).then((ok) => {
    if (ok) host.state.renderer.requestRender('manual');
  });
}

async function loadJobDeckWorker(
  host: SlashCommandHost,
  card: ConductorJobCard,
): Promise<JobDeckWorkerLoad> {
  const agentId = card.workerAgentId;
  if (agentId === undefined || agentId.length === 0) {
    return { lines: [], error: 'This job has no worker agent session yet.' };
  }
  const session = host.requireSession();
  try {
    const [trace, usage] = await host.harness.withInteractiveAgent(agentId, () =>
      Promise.all([session.getSessionTrace(), session.getUsage()]),
    );
    const total = usage.total;
    const usageLoad =
      total === undefined
        ? undefined
        : {
            input: total.inputOther + total.inputCacheCreation,
            output: total.output,
            cacheRead: total.inputCacheRead,
          };
    if (usageLoad !== undefined) {
      host.jobBoardController.rememberUsage(card.id, usageLoad);
    }
    return {
      lines: formatJobDeckTraceLines(trace.context.history),
      usage: usageLoad,
    };
  } catch (error) {
    return { lines: [], error: formatErrorMessage(error) };
  }
}

/** Exported for hotpath unit tests; Job Deck viewer wires this via onAction. */
export function routeJobDeckAction(
  host: SlashCommandHost,
  action: 'steer' | 'answer' | 'resume' | 'cancel' | 'mergePreview' | 'pushPreview' | 'retry',
  card: ConductorJobCard,
  text?: string,
): void {
  if (action === 'mergePreview') {
    openMergePreview(host, card);
    return;
  }
  if (action === 'pushPreview') {
    openPushPreview(host, card);
    return;
  }
  host.restoreEditor();
  const id = card.id;
    switch (action) {
      case 'steer':
        void hotpathJobSteer(host, id, text ?? '');
        return;
      case 'answer':
        void hotpathJobResume(host, { jobId: id, answer: text ?? '' });
        return;
      case 'resume':
        void hotpathJobResume(host, { jobId: id });
        return;
      case 'cancel':
        void hotpathJobCancel(host, id);
        return;
      case 'retry':
        void retryFailedJob(host, card);
        return;
    }
}

function retryPromptHint(card: ConductorJobCard): string {
  const summary = card.resultSummary?.trim();
  if (summary !== undefined && summary.length > 0) {
    return `Retry failed job ${shortJobId(card.id)}: ${summary}`;
  }
  return `Retry failed job ${shortJobId(card.id)}: ${card.title}`;
}

async function retryFailedJob(host: SlashCommandHost, card: ConductorJobCard): Promise<void> {
  const display = `/job retry ${shortJobId(card.id)}`;
  try {
    const result = await host.requireSession().jobCreate({
      title: card.title,
      kind: card.kind,
      prompt: retryPromptHint(card),
    });
    const created = result.jobs[0];
    const idPart =
      created === undefined ? result.text.trim() : shortJobId(created.id);
    host.showStatus(ttui('tui.job.created', { display, id: idPart }), 'success');
  } catch (error) {
    host.showError(ttui('tui.job.hotpathFailed', { display, message: formatErrorMessage(error) }));
  }
}

interface JobDeckTraceMessage {
  readonly role?: string;
  readonly content?: readonly unknown[];
  readonly toolCalls?: readonly unknown[];
  readonly toolCallId?: string;
  readonly isError?: boolean;
}

interface JobDeckTraceToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Full-fidelity worker transcript projection; viewport windowing happens in the component. */
export function formatJobDeckTraceLines(
  history: readonly JobDeckTraceMessage[],
): readonly string[] {
  const lines: string[] = [];
  const toolCalls = new Map<string, JobDeckTraceToolCall>();
  let inlineToolCallId = 0;

  for (const message of history) {
    const role = message.role;
    if (role === 'user' || role === 'assistant') {
      appendMessageContent(lines, role, message.content, toolCalls, () => {
        inlineToolCallId += 1;
        return `inline_${String(inlineToolCallId)}`;
      });
      for (const rawCall of message.toolCalls ?? []) {
        const call = normalizeToolCall(rawCall, () => {
          inlineToolCallId += 1;
          return `inline_${String(inlineToolCallId)}`;
        });
        if (call === undefined) continue;
        toolCalls.set(call.id, call);
        appendToolCall(lines, call);
      }
      continue;
    }
    if (role === 'tool') {
      const call = message.toolCallId === undefined ? undefined : toolCalls.get(message.toolCallId);
      appendToolResult(
        lines,
        call?.name ?? 'tool',
        message.toolCallId,
        contentValue(message.content),
        message.isError === true,
      );
    }
  }
  return lines;
}

function appendMessageContent(
  lines: string[],
  role: 'user' | 'assistant',
  content: readonly unknown[] | undefined,
  toolCalls: Map<string, JobDeckTraceToolCall>,
  nextInlineId: () => string,
): void {
  for (const item of content ?? []) {
    if (item === null || typeof item !== 'object') continue;
    const part = item as Record<string, unknown>;
    const type = typeof part['type'] === 'string' ? part['type'] : '';
    if (type === 'text') {
      appendText(lines, role === 'assistant' ? '◆' : '◇', stringValue(part['text']));
      continue;
    }
    if (type === 'think') {
      appendText(lines, '◌', stringValue(part['think']));
      continue;
    }
    if (type === 'image_url' || type === 'audio_url' || type === 'video_url') {
      lines.push(`${role === 'assistant' ? '◆' : '◇'} [${type.replace('_url', '')} attachment]`);
      continue;
    }
    if (type === 'toolCall' || type === 'tool_use') {
      const call = normalizeToolCall(part, nextInlineId);
      if (call === undefined) continue;
      toolCalls.set(call.id, call);
      appendToolCall(lines, call);
      continue;
    }
    if (type === 'toolResult' || type === 'tool_result') {
      const toolCallId = stringValue(part['toolCallId'] ?? part['tool_call_id']);
      const call =
        toolCallId === undefined
          ? [...toolCalls.values()].at(-1)
          : toolCalls.get(toolCallId);
      appendToolResult(
        lines,
        call?.name ?? stringValue(part['name']) ?? 'tool',
        toolCallId,
        valueToText(part['output'] ?? part['content']),
        part['isError'] === true || part['is_error'] === true,
      );
    }
}
}

function appendText(lines: string[], prefix: string, text: string | undefined): void {
  if (text === undefined) return;
  for (const line of text.split('\n')) {
    lines.push(`${prefix} ${line}`);
  }
}

function normalizeToolCall(
  raw: unknown,
  nextInlineId: () => string,
): JobDeckTraceToolCall | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const name = stringValue(value['name']) ?? 'tool';
  const id = stringValue(value['id']) ?? stringValue(value['toolCallId']) ?? nextInlineId();
  const rawInput = value['input'] ?? value['args'] ?? value['arguments'];
  return {
    id,
    name,
    input: typeof rawInput === 'string' ? parseToolArguments(rawInput) : rawInput,
  };
}

function appendToolCall(lines: string[], call: JobDeckTraceToolCall): void {
  lines.push(`⚙ ${call.name} · ${call.id}`);
  for (const line of formatToolInputLines(call.name, call.input)) {
    lines.push(`  │ ${line}`);
  }
}

function appendToolResult(
  lines: string[],
  name: string,
  toolCallId: string | undefined,
  output: string,
  isError: boolean,
): void {
  const status = isError ? '✗' : '✓';
  const id = toolCallId === undefined ? '' : ` · ${toolCallId}`;
  lines.push(`${status} ${name} result${id}`);
  const formatted = formatTranscriptOutput(output, {
    isError,
    mode: name === 'Bash' ? 'bash' : 'tool',
  });
  if (formatted.length === 0) {
    lines.push('  │ (empty)');
    return;
  }
  for (const line of formatted.split('\n')) {
    lines.push(`  │ ${line}`);
  }
}

function formatToolInputLines(name: string, input: unknown): readonly string[] {
  const record = asRecord(input);
  const command = stringValue(record?.['command']);
  if (name === 'Bash' && command !== undefined) {
    const lines = ['command:', ...formatShellCommandPreview(command)];
    const extras = withoutKeys(record, ['command']);
    if (Object.keys(extras).length > 0) {
      lines.push('arguments:', ...formatJsonLines(extras));
    }
    return lines;
  }


  return formatJsonLines(input);
}

function formatJsonLines(value: unknown): string[] {
  const formatted = formatTranscriptOutput(serializeTraceValue(value), {
    mode: 'tool',
  });
  return formatted.length === 0 ? [] : formatted.split('\n');
}

function withoutKeys(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  if (record === undefined) return {};
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
}

function contentValue(content: readonly unknown[] | undefined): string {
  return valueToText(content);
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value
      .flatMap((part) => {
        const record = asRecord(part);
        return record?.['type'] === 'text' && typeof record['text'] === 'string'
          ? [record['text']]
          : [];
      })
      .join('');
    if (text.length > 0) return text;
  }
  return value === undefined ? '' : serializeTraceValue(value);
}

function serializeTraceValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}


function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
