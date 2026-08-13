import { execFile, type ExecFileOptions } from 'node:child_process';

export interface OpenUrlCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: ExecFileOptions;
}

/**
 * Build the platform opener for a URL.
 * On Windows, `cmd /c start` must receive a quoted URL so `&` in query
 * strings is not treated as a command separator (OAuth client_id would drop).
 */
export function openUrlCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): OpenUrlCommand {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  if (platform !== 'win32') {
    return { command: 'xdg-open', args: [url] };
  }
  const safeUrl = url.replaceAll('"', '');
  return {
    command: 'cmd',
    args: ['/c', 'start', '""', `"${safeUrl}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export function openUrl(url: string): void {
  const { command, args, options } = openUrlCommand(url);
  execFile(command, [...args], options ?? {}, () => {});
}
