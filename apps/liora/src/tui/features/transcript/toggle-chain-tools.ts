/**
 * Expand/collapse every tool card in a turn after a chain summary component.
 * Pure over a children array so mouse routing and unit tests share one path.
 *
 * PREMIUM.md §7.9 rule 12: at minimal (and compact, where the chain bar also
 * mounts) a click on the chain phase bar toggles the whole tool unit.
 */

import type { Component } from '#/tui/renderer';
import { AgentGroupComponent } from '#/tui/components/messages/agent-group';
import { AssistantMessageComponent } from '#/tui/components/messages/assistant-message';
import { ReadGroupComponent } from '#/tui/components/messages/read-group';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { UserMessageComponent } from '#/tui/components/messages/user-message';
import { isOneLineToolLevel } from '#/tui/features/transcript/transcript-density';

/** Whether this tool participates in chain-bar bulk expand/collapse. */
export function isChainToggleableTool(tc: ToolCallComponent): boolean {
  return isOneLineToolLevel(tc.getDetail());
}

/** True when the card is collapsed for density (hidden row or one-line header). */
export function isChainToolCollapsed(tc: ToolCallComponent): boolean {
  return tc.isChainHidden || tc.isOneLineCollapsed;
}

function appendToolsFromChild(child: Component, tools: ToolCallComponent[]): void {
  if (child instanceof ToolCallComponent) {
    tools.push(child);
    return;
  }
  // Groups borrow tool components without mounting them as transcript siblings.
  if (child instanceof AgentGroupComponent) {
    tools.push(...child.getToolComponents());
    return;
  }
  if (child instanceof ReadGroupComponent) {
    tools.push(...child.getToolComponents());
  }
}

/**
 * Collect tool cards after the chain bar until the next turn or answer phase.
 * Includes tools nested in Agent/Read groups.
 */
export function collectToolsAfterChain(
  children: readonly Component[],
  chainIndex: number,
): ToolCallComponent[] {
  const tools: ToolCallComponent[] = [];
  for (let i = chainIndex + 1; i < children.length; i++) {
    const child = children[i]!;
    // Next user turn or the answer phase ends this tool unit.
    if (child instanceof UserMessageComponent) break;
    if (child instanceof AssistantMessageComponent) break;
    appendToolsFromChild(child, tools);
  }
  return tools;
}

/**
 * Toggle local expand on tools after the chain bar.
 * Expand-all if any toggleable tool is collapsed; otherwise collapse-all.
 * Standard/full tools are skipped (no one-line collapse semantics).
 * @returns number of tools toggled (0 = nothing to do).
 */
export function toggleChainToolsAfter(
  children: readonly Component[],
  chainIndex: number,
): number {
  if (chainIndex < 0 || chainIndex >= children.length) return 0;
  const tools = collectToolsAfterChain(children, chainIndex).filter(isChainToggleableTool);
  if (tools.length === 0) return 0;

  const anyCollapsed = tools.some(isChainToolCollapsed);
  let toggled = 0;
  for (const tc of tools) {
    if (anyCollapsed) {
      if (isChainToolCollapsed(tc)) {
        tc.toggleDetailOverride();
        toggled++;
      }
    } else if (!isChainToolCollapsed(tc)) {
      tc.toggleDetailOverride();
      toggled++;
    }
  }
  return toggled;
}
