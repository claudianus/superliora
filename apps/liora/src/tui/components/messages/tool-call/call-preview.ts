import type { Component, MarkdownTheme } from '#/tui/renderer';
import { Text } from '#/tui/renderer';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';
import { appearanceAnimationNow } from '#/tui/utils/appearance-effects';
import { computeStagedLineReveal } from '#/tui/utils/streaming-text-reveal';

import { ShellExecutionComponent } from '../shell-execution';
import {
  buildPlanCallPreviewComponents,
  buildSettledCallPreviewComponents,
  buildStreamingCallPreviewComponents,
} from './call-preview-body';
import { previewRevealStartedAt, stagedPreviewRevealDurationMs } from './entrance';

export interface ToolCallCallPreviewHost {
  readonly previewRevealEligible: boolean;
  addChild(child: Component): void;
  readonly children: readonly Component[];
  getToolCall(): ToolCallBlockData;
  getResult(): ToolResultBlockData | undefined;
  isExpanded(): boolean;
  getCurrentPlan(): string | undefined;
  getPlanPath(): string | undefined;
  getMarkdownTheme(): MarkdownTheme;
  clearRenderCache(): void;
}

export class ToolCallCallPreview {
  callPreviewEndIndex = 0;
  previewItemTotal = 0;
  builtPreviewItemCount = 0;
  private streamingShellPreview: ShellExecutionComponent | undefined;

  build(host: ToolCallCallPreviewHost): void {
    this.previewItemTotal = 0;
    this.builtPreviewItemCount = 0;
    const toolCall = host.getToolCall();
    const result = host.getResult();
    if (toolCall.name === 'ExitPlanMode') {
      for (const child of buildPlanCallPreviewComponents({
        toolCall,
        result,
        currentPlan: host.getCurrentPlan(),
        planPath: host.getPlanPath(),
        markdownTheme: host.getMarkdownTheme(),
      })) {
        host.addChild(child);
      }
      return;
    }
    if (result === undefined && toolCall.truncated === true) {
      this.addItems(
        host,
        buildSettledCallPreviewComponents({
          toolCall,
          result,
          expanded: host.isExpanded(),
        }),
      );
      return;
    }
    if (result === undefined && toolCall.streamingArguments !== undefined) {
      this.buildStreaming(host, toolCall.streamingArguments);
      return;
    }
    this.addItems(
      host,
      buildSettledCallPreviewComponents({
        toolCall,
        result,
        expanded: host.isExpanded(),
      }),
    );
  }

  rebuildBlock(host: ToolCallCallPreviewHost, children: Component[]): void {
    host.clearRenderCache();
    const tail = children.splice(this.callPreviewEndIndex);
    while (children.length > 2) {
      children.pop();
    }
    this.build(host);
    this.callPreviewEndIndex = children.length;
    for (const child of tail) {
      host.addChild(child);
    }
  }

  private addItems(host: ToolCallCallPreviewHost, items: readonly Text[]): void {
    if (!host.previewRevealEligible) {
      for (const item of items) host.addChild(item);
      this.builtPreviewItemCount = items.length;
      return;
    }
    const durationMs = stagedPreviewRevealDurationMs();
    if (durationMs <= 0 || items.length <= 1) {
      for (const item of items) host.addChild(item);
      this.builtPreviewItemCount = items.length;
      return;
    }
    this.previewItemTotal = items.length;
    const startedAtMs = previewRevealStartedAt(host.getToolCall().id);
    const visible = computeStagedLineReveal({
      totalLines: items.length,
      elapsedMs: appearanceAnimationNow() - startedAtMs,
      durationMs,
    });
    this.builtPreviewItemCount = visible;
    for (const item of items.slice(0, visible)) host.addChild(item);
  }

  private buildStreaming(host: ToolCallCallPreviewHost, streamText: string): void {
    const built = buildStreamingCallPreviewComponents({
      toolCall: host.getToolCall(),
      streamText,
      existingShell: this.streamingShellPreview,
    });
    this.streamingShellPreview = built.shell;
    for (const item of built.components) {
      if (item instanceof ShellExecutionComponent && host.children.includes(item)) continue;
      host.addChild(item);
    }
  }
}
