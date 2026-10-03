/**
 * Pure result-body routing for ToolCallComponent's `buildContent` tail.
 * All tool results use the shared formatted output renderer.
 */

import type { Component } from '#/tui/renderer';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { pickResultRenderer } from '../tool-renderers/registry';

export function buildToolCallResultContentComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData;
  readonly expanded: boolean;
  readonly isSingleSubagentView: boolean;
}): Component[] {
  const { toolCall, result, expanded, isSingleSubagentView } = params;

  if (!result.output) return [];

  if (isSingleSubagentView) return [];


  const renderer = pickResultRenderer(toolCall.name);
  return renderer(toolCall, result, {
    expanded: true,
    showCommand: expanded,
  });
}
