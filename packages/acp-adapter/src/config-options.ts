/** Native model, thinking and permission configuration advertised to ACP clients. */

import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import type { LioraHarness } from '@superliora/sdk';

import { ACP_MODES, type AcpModeId } from './modes';
import { listModelsFromHarness, type AcpModelEntry } from './model-catalog';

/** Each configured native model alias gets one picker entry. */
export function buildModelOption(
  models: readonly AcpModelEntry[],
  currentBaseModelId: string,
): SessionConfigOption {
  const options: SessionConfigSelectOption[] = models.map((model) => ({
    value: model.id,
    name: model.name,
    ...(model.description !== undefined ? { description: model.description } : {}),
  }));
  return {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: currentBaseModelId,
    options,
  };
}

/**
 * Build the `thinking` toggle.
 *
 * Spec category `'thought_level'` (`schema/types.gen.d.ts:4492`) is the
 * reserved bucket for reasoning / thinking knobs; using it lets a client
 * like Zed render the toggle with the right icon / placement without the
 * adapter advertising a custom category.
 *
 * Phase 16 made this a 2-entry `type: 'select'` (`off` / `on`) instead
 * of `type: 'boolean'` — Zed's chip strip currently only renders
 * `select` options; boolean shows as "Unknown" because the UI hasn't
 * been wired up to the spec's boolean arm yet. The adapter still tracks
 * the toggle internally as a boolean (`AcpSession.currentThinkingEnabled`);
 * only the wire encoding is `'on'` / `'off'` strings.
 *
 * The caller decides whether to include this option at all — when the
 * currently-selected model has `thinkingSupported === false`, the
 * snapshot omits it entirely (dynamic visibility), so the client never
 * shows a toggle that wouldn't do anything.
 *
 * `alwaysThinking` models (declared `always_thinking` capability — the
 * runtime cannot disable thinking) collapse the select to a single
 * locked `on` entry: the state stays visible to the client, but there
 * is no off option to pick. ACP has no "disabled entry" concept, so
 * omitting `off` is the wire-level equivalent of the TUI's greyed-out
 * `Off (Unsupported)` segment.
 */
export function buildThinkingOption(
  enabled: boolean,
  alwaysThinking = false,
): SessionConfigOption {
  if (alwaysThinking) {
    return {
      type: 'select',
      id: 'thinking',
      name: 'Thinking',
      category: 'thought_level',
      currentValue: 'on',
      options: [{ value: 'on', name: 'Thinking On' }],
    };
  }
  return {
    type: 'select',
    id: 'thinking',
    name: 'Thinking',
    category: 'thought_level',
    currentValue: enabled ? 'on' : 'off',
    options: [
      { value: 'off', name: 'Thinking Off' },
      { value: 'on', name: 'Thinking On' },
    ],
  };
}

/** Project native permission policies into the mode picker. */
export function buildModeOption(currentModeId: AcpModeId): SessionConfigOption {
  const options: SessionConfigSelectOption[] = ACP_MODES.map((mode) => ({
    value: mode.id,
    name: mode.name,
    description: mode.description,
  }));
  return {
    type: 'select',
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: currentModeId,
    options,
  };
}

/**
 * Compose the v0 `SessionConfigOption[]` surface — `[modelOption, …(thinkingOption?), modeOption]`.
 * Order is part of the contract: ACP clients render options top-to-bottom, and
 * PLAN D11 fixes model on top of mode so the more frequently-used selector
 * is reachable first. The thinking toggle is wedged between them so its
 * effect on the model selection above is visually adjacent.
 *
 * The thinking toggle only appears when the currently-selected base
 * model is `thinkingSupported`; otherwise the snapshot is just
 * `[modelOption, modeOption]`. This means switching from a thinking-
 * capable model (e.g. `kimi-coder`) to a non-thinking one (e.g.
 * `kimi-plain`) causes the next `config_option_update` to omit the
 * toggle entirely — Zed's UI is expected to handle "option set changes
 * across updates", which is the standard configOptions contract.
 *
 * Calls {@link listModelsFromHarness} exactly once per invocation so a
 * session refresh after each model/mode/thinking change is a single
 * round-trip to the harness. The helper itself is tolerant to
 * partial-stub harnesses: missing `getConfig` or a throwing one resolve
 * to an empty catalog, so the model picker ships an empty options
 * array and the thinking toggle is suppressed (no current model means
 * no thinkingSupported signal to read).
 *
 * Returns a mutable `SessionConfigOption[]` (rather than `readonly`) so
 * the value is assignable to the SDK's `NewSessionResponse.configOptions`
 * field, which is typed `Array<SessionConfigOption>` — TypeScript treats
 * `readonly T[]` as not assignable to `T[]` even when callers never
 * mutate it.
 */
export async function buildSessionConfigOptions(
  harness: LioraHarness,
  currentBaseModelId: string,
  currentThinkingEnabled: boolean,
  currentModeId: AcpModeId,
): Promise<SessionConfigOption[]> {
  const models = await listModelsFromHarness(harness);
  const currentModelEntry = models.find((m) => m.id === currentBaseModelId);
  const showThinking = currentModelEntry?.thinkingSupported === true;
  const alwaysThinking = currentModelEntry?.alwaysThinking === true;
  const out: SessionConfigOption[] = [buildModelOption(models, currentBaseModelId)];
  if (showThinking) {
    // Always-thinking models render locked-on regardless of the session's
    // recorded toggle state — agent-core clamps the runtime the same way.
    out.push(buildThinkingOption(alwaysThinking || currentThinkingEnabled, alwaysThinking));
  }
  out.push(buildModeOption(currentModeId));
  return out;
}
