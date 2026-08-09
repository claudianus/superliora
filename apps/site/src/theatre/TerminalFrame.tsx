import type { TheatreFrame, LineTone } from './script';

const toneClass: Record<LineTone, string> = {
  dim: 'text-muted',
  text: 'text-text',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-emerald',
  warn: 'text-amber',
  error: 'text-rose',
  user: 'text-amber',
};

export function TerminalFrame({ frame }: { frame: TheatreFrame }) {
  return (
    <div className="theatre-shell relative overflow-hidden rounded-none border-x-0 border-y sm:rounded-lg sm:border">
      <div className="flex items-center gap-2 border-b border-line bg-bg-2 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose/80" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber/80" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald/80" aria-hidden="true" />
        <span className="ml-2 font-mono text-[11px] text-muted">liora · neon noir</span>
      </div>
      <div
        className="scanline min-h-[280px] overflow-x-auto bg-bg-1 px-3 py-4 sm:min-h-[320px] sm:px-5"
        aria-hidden="true"
      >
        <pre className="font-mono text-[11px] leading-5 sm:text-xs sm:leading-6">
          {frame.lines.map((line, i) => (
            <div key={`${frame.id}-${String(i)}`} className={`theatre-line ${toneClass[line.tone ?? 'text']}`}>
              {line.text.length === 0 ? ' ' : line.text}
            </div>
          ))}
        </pre>
      </div>
      {frame.footer && (
        <div className="border-t border-line bg-bg-2 px-3 py-2 font-mono text-[11px] text-soft">
          {frame.footer}
        </div>
      )}
    </div>
  );
}
