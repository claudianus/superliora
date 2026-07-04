import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { release as osRelease, type as osType } from 'node:os';
import { join, relative } from 'node:path';

import { resolveEvidenceRoot } from '#/constant/workspace-data';
import type { McpServerInfo, SessionStatus, SessionUsage } from '@superliora/sdk';

import { buildMcpStatusReportLines } from '../components/messages/mcp-status-panel';
import {
  buildStatusReportLines,
  type StatusRecoveryReadiness,
} from '../components/messages/status-panel';
import { buildUsageReportLines, UsagePanelComponent, type ManagedUsageReport } from '../components/messages/usage-panel';
import {
  FEEDBACK_ISSUE_URL,
  FEEDBACK_STATUS_CANCELLED,
  FEEDBACK_STATUS_FALLBACK,
  FEEDBACK_STATUS_NOT_SIGNED_IN,
  FEEDBACK_STATUS_SUBMITTING,
  FEEDBACK_STATUS_SUCCESS,
  FEEDBACK_STATUS_UPLOAD_FAILED,
  FEEDBACK_TELEMETRY_EVENT,
  feedbackIdLine,
  feedbackSessionLine,
  withFeedbackVersionPrefix,
} from '../constant/feedback';
import { isManagedUsageProvider } from '../constant/liora-tui';
import { submitFeedbackWithAttachments } from '../../feedback/feedback-attachments';
import { formatErrorMessage } from '../utils/event-payload';
import { createGitStatusCache } from '#/utils/git/git-status';
import { openUrl } from '#/utils/open-url';
import { loadPreflightHumanWriting } from './preflight';
import { promptFeedbackAttachment, promptFeedbackInput } from './prompts';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function handleFeedbackCommand(host: SlashCommandHost): Promise<void> {
  const fallback = (reason: string): void => {
    host.showStatus(reason);
    host.showStatus(FEEDBACK_ISSUE_URL);
    openUrl(FEEDBACK_ISSUE_URL);
  };

  const providerKey = host.state.appState.availableModels[host.state.appState.model]?.provider;
  if (!isManagedUsageProvider(providerKey)) {
    fallback(FEEDBACK_STATUS_NOT_SIGNED_IN);
    return;
  }

  // Stage 1: collect the free-form feedback text.
  const input = await promptFeedbackInput(host);
  if (input === undefined) {
    host.showStatus(FEEDBACK_STATUS_CANCELLED);
    return;
  }

  // Stage 2: ask whether to attach diagnostics (logs / codebase).
  const level = await promptFeedbackAttachment(host);
  if (level === undefined) {
    host.showStatus(FEEDBACK_STATUS_CANCELLED);
    return;
  }

  const version = withFeedbackVersionPrefix(host.state.appState.version);
  const spinner = host.showLoginProgressSpinner(FEEDBACK_STATUS_SUBMITTING);
  const res = await host.harness.auth.submitFeedback({
    content: input.value,
    sessionId: host.state.appState.sessionId,
    version,
    os: `${osType()} ${osRelease()}`,
    model: host.state.appState.model.length > 0 ? host.state.appState.model : null,
  });

  if (res.kind !== 'ok') {
    spinner.stop({ ok: false, label: res.message });
    fallback(FEEDBACK_STATUS_FALLBACK);
    return;
  }

  // Stage 3: prepare and upload each requested attachment independently.
  const attachmentFailed = await submitFeedbackWithAttachments(host, res.feedbackId, level);

  spinner.stop({ ok: true, label: FEEDBACK_STATUS_SUCCESS });
  host.showStatus(feedbackSessionLine(host.state.appState.sessionId));
  host.showStatus(feedbackIdLine(res.feedbackId));
  host.track(FEEDBACK_TELEMETRY_EVENT);
  if (attachmentFailed) {
    host.showStatus(FEEDBACK_STATUS_UPLOAD_FAILED);
  }
}

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}

interface ManagedUsageResult {
  readonly usage?: ManagedUsageReport;
  readonly error?: string;
}

interface SotaRecoveryCandidate {
  readonly path: string;
  readonly mtimeMs: number;
}

const SOTA_SUMMARY_FILENAME = 'sota-gate-summary.json';
const SOTA_RECOVERY_SCAN_MAX_DEPTH = 5;
const SOTA_RECOVERY_SCAN_LIMIT = 2_000;

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const sessionUsage = await loadSessionUsageReport(host);
  const managedUsage = await loadManagedUsageReport(host);
  const reportArgs = {
    sessionUsage: sessionUsage.usage,
    sessionUsageError: sessionUsage.error,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
  };
  const panel = new UsagePanelComponent(() => buildUsageReportLines(reportArgs), 'primary');
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const [runtimeStatus, managedUsage] = await Promise.all([
    loadRuntimeStatusReport(host),
    loadManagedUsageReport(host),
  ]);
  const appState = host.state.appState;
  const humanWriting = loadPreflightHumanWriting(appState.workDir);
  const recovery = loadStatusRecoveryReadiness(appState.workDir);
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    sessionTitle: appState.sessionTitle,
    thinking: appState.thinking,
    permissionMode: appState.permissionMode,
    planMode: appState.planMode,
    ultraworkMode: appState.ultraworkMode,
    swarmMode: appState.swarmMode,
    goalStatus: appState.goal?.status,
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    availableProviders: appState.availableProviders,
    providerRouteStatus: runtimeStatus.status?.providerRouteStatus ?? appState.providerRouteStatus,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
    gitStatus: createGitStatusCache(appState.workDir).getStatus(),
    humanWriting: {
      ready: humanWriting.ready,
      advisoryOnly: humanWriting.advisoryOnly,
      nextAction: humanWriting.ready
        ? 'Describe the task to start.'
        : 'Restore writing-quality guidance before long autonomous work.',
    },
    recovery,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
  };
  const panel = new UsagePanelComponent(() => buildStatusReportLines(reportArgs), 'primary', ' Status ');
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

export async function showMcpServers(host: SlashCommandHost): Promise<void> {
  let servers: readonly McpServerInfo[];
  try {
    servers = await host.requireSession().listMcpServers();
  } catch (error) {
    host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    return;
  }

  const title = servers.length > 0 ? ` MCP (${servers.length}) ` : ' MCP ';
  const panel = new UsagePanelComponent(
    () => buildMcpStatusReportLines({ servers }),
    'primary',
    title,
  );
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  try {
    return { usage: await host.requireSession().getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  try {
    return { status: await host.requireSession().getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadManagedUsageReport(host: SlashCommandHost): Promise<ManagedUsageResult | undefined> {
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  if (!isManagedUsageProvider(providerKey)) return undefined;

  let res;
  try {
    res = await host.harness.auth.getManagedUsage(providerKey);
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
  if (res.kind === 'error') {
    return { error: res.message };
  }
  return { usage: { summary: res.summary, limits: res.limits } };
}

export function loadStatusRecoveryReadiness(workDir: string): StatusRecoveryReadiness {
  const evidenceRoot = join(workDir, resolveEvidenceRoot(workDir));
  const latest = latestPassingSotaRecoveryEvidence(evidenceRoot);
  if (latest === undefined) {
    return {
      ready: false,
      nextAction: 'Run live TUI SOTA gate to capture recovery evidence.',
    };
  }
  return {
    ready: true,
    evidencePath: displayStatusEvidencePath(workDir, latest.path),
    nextAction: 'Recovery evidence ready.',
  };
}

function latestPassingSotaRecoveryEvidence(root: string): SotaRecoveryCandidate | undefined {
  if (!existsSync(root)) return undefined;
  const candidates: SotaRecoveryCandidate[] = [];
  collectPassingSotaRecoveryEvidence(root, 0, { visited: 0 }, candidates);
  return candidates.toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function collectPassingSotaRecoveryEvidence(
  dir: string,
  depth: number,
  state: { visited: number },
  candidates: SotaRecoveryCandidate[],
): void {
  if (state.visited >= SOTA_RECOVERY_SCAN_LIMIT || depth > SOTA_RECOVERY_SCAN_MAX_DEPTH) return;
  state.visited += 1;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPassingSotaRecoveryEvidence(entryPath, depth + 1, state, candidates);
      continue;
    }
    if (!entry.isFile() || entry.name !== SOTA_SUMMARY_FILENAME) continue;
    const summary = readStatusJsonRecord(entryPath);
    if (summary === undefined || !isPassingSotaRecoverySummary(summary)) continue;
    candidates.push({ path: entryPath, mtimeMs: fileMtimeMs(entryPath) });
  }
}

function isPassingSotaRecoverySummary(summary: Record<string, unknown>): boolean {
  return (
    summary['status'] === 'PASS' &&
    statusField(summary['tuiWorkflowProof']) === 'PASS' &&
    statusField(summary['tuiUltraworkProof']) === 'PASS' &&
    statusField(summary['harnessRadarGate']) === 'PASS'
  );
}

function statusField(value: unknown): string | undefined {
  return isRecord(value) && typeof value['status'] === 'string' ? value['status'] : undefined;
}

function readStatusJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function displayStatusEvidencePath(workDir: string, path: string): string {
  const rel = relative(workDir, path);
  return rel.length > 0 && !rel.startsWith('..') ? rel : path;
}
