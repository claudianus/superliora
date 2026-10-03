export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function extractBashTag(
  text: string,
  tag: 'bash-input' | 'bash-stdout' | 'bash-stderr',
): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match?.[1] === undefined ? undefined : unescapeBashXml(match[1]);
}

function unescapeBashXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

