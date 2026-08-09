/**
 * Job Deck opener — mounts the interactive Conductor monitoring viewer
 * (deck list + worker transcript drill-down). Shared by `/jobs deck`, the
 * Command Hub row, and Job Desk card clicks (mouse router).
 */

import type { SlashCommandHost } from './hub/dispatch';
import {
  formatShellCommandPreview,
  highlightLines,
  langFromPath,
} from '../components/media/code-highlight';
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
  isConductorUxV2Enabled,
} from './job-hotpath';
import { resyncJobBoardFromSession } from '../features/control-tower/job-resync';
import { openMergePreview } from '../features/control-tower/merge-preview-controller';
import { ttui } from '../utils/tui-i18n';

export function openJobDeckViewer(host: SlashCommandHost, jobId?: string): void {
  if (host.session === undefined) {
    host.showError(ttui('tui.jobs.deckNoSession'));
    return;
  }
  const snapshot = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  if (snapshot.jobs.length === 0 && !isConductorUxV2Enabled()) {
    host.showStatus(
      'No Conductor jobs yet — the Job Deck opens once jobs exist.',
      'textMuted',
    );
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

  // F18: pull authoritative jobList into the store while the deck is open.
  if (isConductorUxV2Enabled()) {
    void resyncJobBoardFromSession(host).then((ok) => {
      if (ok) host.state.renderer.requestRender('manual');
    });
  }
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
  } catch (caught) {
    return { lines: [], error: formatErrorMessage(caught) };
  }
}

/** Exported for hotpath unit tests; Job Deck viewer wires this via onAction. */
export function routeJobDeckAction(
  host: SlashCommandHost,
  action: 'steer' | 'answer' | 'resume' | 'cancel' | 'mergePreview' | 'retry',
  card: ConductorJobCard,
  text?: string,
): void {
  if (action === 'mergePreview') {
    openMergePreview(host, card);
    return;
  }
  host.restoreEditor();
  const id = card.id;
  if (isConductorUxV2Enabled()) {
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
  switch (action) {
    case 'steer':
      host.sendNormalUserInput(
        `Use JobSteer with job_id=${id} and message=${JSON.stringify(text ?? '')} to steer the running Conductor worker in real time. Report ACK state briefly.`,
        { displayText: `/job steer ${shortJobId(id)} ${text ?? ''}` },
      );
      return;
    case 'answer':
      host.sendNormalUserInput(
        `Use JobResume with job_id=${id} and answer=${JSON.stringify(text ?? '')} to inject the user answer into the needs_user card and re-queue the job. Report the resumed state.`,
        { displayText: `/job answer ${shortJobId(id)} ${text ?? ''}` },
      );
      return;
    case 'resume':
      host.sendNormalUserInput(
        `Use JobResume with job_id=${id} to re-queue and schedule that job. Report ACK state.`,
        { displayText: `/job resume ${shortJobId(id)}` },
      );
      return;
    case 'cancel':
      host.sendNormalUserInput(
        `Use JobCancel with job_id=${id} to cancel the job and abort its worker if live. Report final state.`,
        { displayText: `/job cancel ${shortJobId(id)}` },
      );
      return;
    case 'retry':
      host.sendNormalUserInput(
        `Use JobCreate with title=${JSON.stringify(card.title)} and prompt=${JSON.stringify(retryPromptHint(card))} to retry the failed Conductor job. Report the new job id.`,
        { displayText: `/job retry ${shortJobId(id)}` },
      );
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
        call?.input,
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
        call?.input,
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
  input: unknown,
): void {
  const status = isError ? '✗' : '✓';
  const id = toolCallId === undefined ? '' : ` · ${toolCallId}`;
  lines.push(`${status} ${name} result${id}`);
  const path = pathFromToolInput(input);
  const formatted = formatTranscriptOutput(output, {
    isError,
    mode: name === 'Bash' ? 'bash' : 'tool',
    ...(path === undefined ? {} : { pathHint: path }),
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
  const path = pathFromToolInput(input);
  const command = stringValue(record?.['command']);
  if (name === 'Bash' && command !== undefined) {
    const lines = ['command:', ...formatShellCommandPreview(command)];
    const extras = withoutKeys(record, ['command']);
    if (Object.keys(extras).length > 0) {
      lines.push('arguments:', ...formatJsonLines(extras));
    }
    return lines;
  }

  if (path !== undefined && record !== undefined) {
    const lines = [`path: ${path}`];
    for (const key of ['content', 'old_string', 'new_string']) {
      const code = stringValue(record[key]);
      if (code === undefined) continue;
      lines.push(
        `${key}:`,
        ...highlightLines(code, langFromPath(path), { pathHint: path }),
      );
    }
    const extras = withoutKeys(record, ['content', 'old_string', 'new_string', 'path', 'file_path', 'filePath']);
    if (Object.keys(extras).length > 0) {
      lines.push('arguments:', ...formatJsonLines(extras));
    }
    return lines;
  }

  const serialized = serializeTraceValue(input);
  return formatJsonLines(serialized, path);
}

function formatJsonLines(value: unknown, pathHint?: string): string[] {
  const formatted = formatTranscriptOutput(serializeTraceValue(value), {
    mode: 'tool',
    ...(pathHint === undefined ? {} : { pathHint }),
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

function pathFromToolInput(input: unknown): string | undefined {
  const record = asRecord(input);
  return (
    stringValue(record?.['file_path']) ??
    stringValue(record?.['path']) ??
    stringValue(record?.['filePath'])
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
