import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  copiedLabel?: string;
  copyLabel?: string;
  idleText?: string;
  doneText?: string;
}

export function CopyButton({
  text,
  copiedLabel = 'Copied',
  copyLabel = 'Copy command',
  idleText = 'Copy',
  doneText = 'OK',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 1500);
      } catch {
        // ignore
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-copied={copied ? 'true' : 'false'}
      aria-label={copied ? copiedLabel : copyLabel}
      className="copy-reward absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-soft transition hover:bg-bg-3 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {copied ? doneText : idleText}
    </button>
  );
}
