/**
 * /thinking slash command and thinking-level validation extracted from config.ts.
 */

import type { ModelAlias } from '@superliora/sdk';

import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import {
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
} from '#/tui/utils/model/thinking-effort';
import type { SlashCommandHost } from '../dispatch';

const THINKING_LEVELS = ['off', 'on', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export async function handleThinkingCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim();
  if (raw.length === 0) {
    host.showStatus(formatThinkingStatus(host));
    return;
  }

  const level = normalizeThinkingLevel(args);
  if (level === undefined) {
    host.showError(
      `Unknown thinking level: ${args.trim() || '(empty)'}. Use ${formatThinkingLevels()}.`,
    );
    return;
  }

  const modelAlias = host.state.appState.model.trim();
  if (modelAlias.length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const model = host.state.appState.availableModels[modelAlias];
  const validationError = validateThinkingLevelForModel(level, model);
  if (validationError !== undefined) {
    host.showError(validationError);
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  // Clamp onto the model support list before applying so UI and session match.
  const applied =
    level === 'off' || level === 'on'
      ? level
      : resolveThinkingLevelForApply(true, level, model);

  try {
    await session.setThinking(applied);
  } catch (error) {
    host.showError(`Failed to set thinking: ${formatErrorMessage(error)}`);
    return;
  }

  const enabled = applied !== 'off';
  // UI may show a clamp note (max→high) when the wire mapping differs.
  const display = resolveThinkingDisplay(applied, { thinking: enabled, model });
  host.setAppState({ thinking: enabled, thinkingLevel: display.requested });
  host.track('thinking_toggle', { enabled, level: display.requested });
  const statusLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested} (wire ${display.effective})`;
  host.showStatus(`Thinking set to ${statusLabel}.`, 'success');
}

function normalizeThinkingLevel(args: string): ThinkingLevel | undefined {
  const normalized = args.trim().toLowerCase();
  return THINKING_LEVELS.includes(normalized as ThinkingLevel)
    ? (normalized as ThinkingLevel)
    : undefined;
}

function validateThinkingLevelForModel(
  level: ThinkingLevel,
  model: ModelAlias | undefined,
): string | undefined {
  if (model === undefined) return undefined;
  const caps = model.capabilities ?? [];
  const alwaysThinking = caps.includes('always_thinking');
  const supportsThinking =
    alwaysThinking || caps.includes('thinking') || model.adaptiveThinking === true;

  if (level === 'off') {
    return alwaysThinking ? 'Current model requires thinking.' : undefined;
  }
  if (!supportsThinking) return 'Current model does not support thinking.';

  const supportEfforts = model.supportEfforts;
  if (supportEfforts !== undefined && level !== 'on') {
    const supported = new Set(supportEfforts.map((effort) => effort.trim().toLowerCase()));
    if (!supported.has(level)) {
      return `Current model supports thinking efforts: ${supportEfforts.join(', ')}.`;
    }
  }
  return undefined;
}

function formatThinkingLevels(): string {
  return THINKING_LEVELS.join(', ');
}

function formatThinkingStatus(host: SlashCommandHost): string {
  const modelAlias = host.state.appState.model.trim();
  const model = host.state.appState.availableModels[modelAlias];
  const display = resolveThinkingDisplay(
    host.state.appState.thinkingLevel ?? (host.state.appState.thinking ? 'on' : 'off'),
    { thinking: host.state.appState.thinking, model },
  );
  const levelLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested}→${display.effective}`;

  // Check if model supports thinking.
  const caps = model?.capabilities ?? [];
  const supportsThinking =
    caps.includes('always_thinking') || caps.includes('thinking') || model?.adaptiveThinking === true;

  if (!supportsThinking) {
    return `Thinking is ${levelLabel}. Current model does not support thinking.`;
  }

  const supportEfforts = model?.supportEfforts;
  const defaultEffort = model?.defaultEffort ?? 'high';

  if (supportEfforts !== undefined && supportEfforts.length > 0) {
    return `Thinking is ${levelLabel}. Default effort: ${defaultEffort}. Supported: ${supportEfforts.join(', ')}. Use /thinking <level>.`;
  }
  return `Thinking is ${levelLabel}. Default effort: ${defaultEffort}. Use /thinking <${formatThinkingLevels()}>.`;
}
