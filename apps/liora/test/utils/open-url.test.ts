import { describe, expect, it } from 'vitest';

import { openUrlCommand } from '#/utils/open-url';

const OAUTH_URL =
  'https://auth.x.ai/oauth/authorize?response_type=code&client_id=b1a00492-073a-47ea-816f-4c329264a828&redirect_uri=http%3A%2F%2F127.0.0.1%3A56121%2Fcallback';

describe('openUrlCommand', () => {
  it('quotes the URL on Windows so cmd does not split the OAuth query on &', () => {
    const opened = openUrlCommand(OAUTH_URL, 'win32');
    expect(opened.command).toBe('cmd');
    expect(opened.args).toEqual(['/c', 'start', '""', `"${OAUTH_URL}"`]);
    expect(opened.options?.windowsVerbatimArguments).toBe(true);
    expect(opened.args.at(-1)).toContain('client_id=b1a00492-073a-47ea-816f-4c329264a828');
  });

  it('passes the URL through on macOS and Linux', () => {
    expect(openUrlCommand(OAUTH_URL, 'darwin')).toEqual({ command: 'open', args: [OAUTH_URL] });
    expect(openUrlCommand(OAUTH_URL, 'linux')).toEqual({ command: 'xdg-open', args: [OAUTH_URL] });
  });
});
