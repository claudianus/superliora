import type { TheatreFrame, LineTone } from './script';

const toneClass: Record<LineTone, string> = {
  dim: 'text-muted',
  text: 'text-text',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-emerald',
  warn: 'text-amber',
  error: 'text-rose',
  user: 'text-[color:var(--color-role-user)]',
  keyword: 'text-accent',
  string: 'text-emerald',
};

function stateDot(state: 'running' | 'done' | 'queued') {
  if (state === 'running') return 'bg-emerald pulse-dot';
  if (state === 'done') return 'bg-muted';
  return 'bg-amber';
}

export function TerminalFrame({ frame }: { frame: TheatreFrame }) {
  return (
    <div className="theatre-shell overflow-hidden rounded-xl border border-line shadow-glow">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-bg-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose/80" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/80" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald/80" aria-hidden="true" />
          <span className="ml-1 font-mono text-[11px] font-medium tracking-tight text-text">
            SuperLiora
          </span>
        </div>
        <span className="truncate font-mono text-[10px] text-muted sm:text-[11px]">
          {frame.headerRight}
        </span>
      </div>

      {frame.board && (
        <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
          {frame.board.map((col) => (
            <div key={col.label} className="bg-bg-1 px-2 py-2 sm:px-3">
              <div className="font-mono text-[10px] tracking-wider text-muted">{col.label}</div>
              <div className="mt-1.5 min-h-[1.5rem] space-y-1">
                {col.cards.length === 0 ? (
                  <div className="font-mono text-[10px] text-muted/50">—</div>
                ) : (
                  col.cards.map((card) => (
                    <div
                      key={card}
                      className="rounded border border-primary/25 bg-bg-2 px-1.5 py-1 font-mono text-[10px] text-soft sm:text-[11px]"
                    >
                      {card}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`grid bg-bg-1 ${frame.dock ? 'lg:grid-cols-[1fr_200px]' : ''}`}>
        <div className="min-h-[240px] overflow-x-auto px-3 py-4 sm:min-h-[280px] sm:px-4">
          <pre className="font-mono text-[11px] leading-5 sm:text-[12px] sm:leading-6">
            {frame.lines.map((line, i) => (
              <div
                key={`${frame.id}-${String(i)}`}
                className={`theatre-line ${toneClass[line.tone ?? 'text']}`}
              >
                {line.text.length === 0 ? ' ' : line.text}
              </div>
            ))}
          </pre>
          {frame.composer !== undefined && (
            <div className="mt-4 flex items-center gap-2 border-t border-line/80 pt-3">
              <span className="font-mono text-primary">❯</span>
              <span className="font-mono text-[11px] text-soft sm:text-xs">
                {frame.composer}
                <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-primary align-middle animate-pulse" />
              </span>
            </div>
          )}
        </div>

        {frame.dock && (
          <aside className="border-t border-line bg-bg-2/80 px-3 py-3 lg:border-l lg:border-t-0">
            <div className="font-mono text-[10px] tracking-wider text-primary">WORKER DOCK</div>
            <ul className="mt-2 space-y-2">
              {frame.dock.map((w) => (
                <li key={w.name} className="rounded-md border border-line bg-bg-1 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${stateDot(w.state)}`} />
                    <span className="font-mono text-[11px] text-text">{w.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted">{w.state}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-soft">{w.move}</div>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-bg-2 px-3 py-2 font-mono text-[10px] text-soft sm:text-[11px]">
        <span className="truncate">{frame.footerLeft}</span>
        <span className="shrink-0 text-muted">{frame.footerRight}</span>
      </div>
    </div>
  );
}
