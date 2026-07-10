import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  copiedLabel?: string;
  copyLabel?: string;
}

export function CopyButton({ text, copiedLabel = 'Copied', copyLabel = 'Copy command' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? copiedLabel : copyLabel}
      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-soft transition hover:bg-bg-3 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      {copied ? 'OK' : 'Copy'}
    </button>
  );
}
