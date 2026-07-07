export interface TextToolMeta {
  readonly tool: string;
  readonly mode?: string | undefined;
  readonly truncated?: boolean | undefined;
  readonly partial?: boolean | undefined;
  readonly summary?: string | undefined;
  readonly nextStep?: string | undefined;
  readonly stats?: Readonly<Record<string, string | number | boolean | undefined>> | undefined;
}

export function appendTextToolMeta(body: string, meta: TextToolMeta): string {
  const lines = [`<tool_meta tool="${escapeAttribute(meta.tool)}"${renderMode(meta.mode)}>`];
  if (meta.truncated !== undefined) lines.push(`truncated: ${String(meta.truncated)}`);
  if (meta.partial !== undefined) lines.push(`partial: ${String(meta.partial)}`);
  if (meta.summary !== undefined && meta.summary.length > 0) lines.push(`summary: ${meta.summary}`);
  for (const [key, value] of Object.entries(meta.stats ?? {})) {
    if (value === undefined) continue;
    lines.push(`${key}: ${String(value)}`);
  }
  if (meta.nextStep !== undefined && meta.nextStep.length > 0) lines.push(`next_step: ${meta.nextStep}`);
  lines.push('</tool_meta>');
  return body.length === 0 ? lines.join('\n') : `${body}\n${lines.join('\n')}`;
}

function renderMode(mode: string | undefined): string {
  return mode === undefined ? '' : ` mode="${escapeAttribute(mode)}"`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
