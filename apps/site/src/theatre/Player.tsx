import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { theatreFrames } from './script';
import { TerminalFrame } from './TerminalFrame';

const BEAT_MS = 3200;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TheatrePlayer() {
  const { lang, t } = useI18n();
  const frames = useMemo(() => theatreFrames(lang), [lang]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    setIndex(0);
    if (prefersReducedMotion()) setPlaying(false);
  }, [lang]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % frames.length);
    }, BEAT_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [playing, frames.length]);

  const beat = t.theatre.beats[index] ?? t.theatre.beats[0];
  const frame = frames[index] ?? frames[0];

  return (
    <div className="w-full">
      <TerminalFrame frame={frame} />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-h-[1.5rem] font-mono text-sm text-soft" aria-live="polite">
          <span className="text-primary">{beat.label}</span>
          <span className="text-muted"> — </span>
          {beat.caption}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary rounded-md px-3 py-1.5 text-xs font-semibold"
            onClick={() => {
              setPlaying((p) => !p);
            }}
          >
            {playing ? t.theatre.pause : t.theatre.play}
          </button>
          <div className="flex max-w-full gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label={t.theatre.chapter}>
            {t.theatre.beats.map((b, i) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={`shrink-0 rounded-md px-2 py-1 font-mono text-[10px] transition ${
                  i === index
                    ? 'bg-primary text-bg-1'
                    : 'border border-line bg-bg-2 text-muted hover:text-text'
                }`}
                onClick={() => {
                  setIndex(i);
                  setPlaying(false);
                }}
              >
                {String(i + 1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
