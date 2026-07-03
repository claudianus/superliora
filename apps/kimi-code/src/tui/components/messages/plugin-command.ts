import { Container, Spacer, Text } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { PluginCommandTrigger } from '#/tui/types';

const ARGS_PREVIEW_MAX = 200;

export class PluginCommandComponent extends Container {
  private headText: Text;
  private previewText?: Text;
  private readonly commandLabel: string;
  private readonly args?: string;

  constructor(
    pluginId: string,
    commandName: string,
    args: string | undefined,
    readonly trigger?: PluginCommandTrigger,
  ) {
    super();
    this.commandLabel = `${pluginId}:${commandName}`;
    this.args = args;
    this.addChild(new Spacer(1));
    this.headText = new Text(this.renderHead(), 0, 0);
    this.addChild(this.headText);

    const trimmed = args?.trim() ?? '';
    if (trimmed.length > 0) {
      this.previewText = new Text(`  ${currentTheme.fg('textDim', previewArgs(trimmed))}`, 0, 0);
      this.addChild(this.previewText);
    }
  }

  override invalidate(): void {
    this.headText.setText(this.renderHead());
    if (this.previewText !== undefined && this.args !== undefined) {
      this.previewText.setText(`  ${currentTheme.fg('textDim', previewArgs(this.args.trim()))}`);
    }
    super.invalidate();
  }

  private renderHead(): string {
    return (
      currentTheme.boldFg('primary', '▶ Ran command: ') +
      currentTheme.boldFg('roleUser', `/${this.commandLabel}`)
    );
  }
}

function previewArgs(args: string): string {
  return args.length > ARGS_PREVIEW_MAX ? `${args.slice(0, ARGS_PREVIEW_MAX)}…` : args;
}
