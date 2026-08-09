import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { parseAnsiFrame } from './parse-ansi';
import { NEON_NOIR } from './neon-noir';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AnsiStage({
  ansi,
  sceneId,
  caption,
  compact = false,
}: {
  ansi: string;
  sceneId: string;
  caption?: string;
  compact?: boolean;
}) {
  const lines = useMemo(() => parseAnsiFrame(ansi), [ansi]);
  const reduce = prefersReducedMotion();

  return (
    <div className={`ansi-stage ${compact ? 'ansi-stage--compact' : ''}`}>
      <div className="ansi-stage__chrome">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose/80" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/80" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald/80" aria-hidden="true" />
          <span className="ml-1 font-mono text-[11px] font-medium tracking-tight text-text">
            SuperLiora
          </span>
        </div>
        <span className="truncate font-mono text-[10px] text-muted sm:text-[11px]">
          Neon Noir · {sceneId}
        </span>
      </div>

      <div className="ansi-stage__viewport scanline">
        <div className="ansi-stage__bloom" aria-hidden="true" />
        <AnimatePresence mode="wait">
          <motion.pre
            key={sceneId}
            className="ansi-stage__pre"
            initial={reduce ? false : { opacity: 0.35 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {lines.map((line, li) => (
              <div key={`${sceneId}-${String(li)}`} className="theatre-line">
                {line.spans.length === 0 ? (
                  ' '
                ) : (
                  line.spans.map((span, si) => (
                    <span
                      key={`${String(li)}-${String(si)}`}
                      style={{
                        color: span.color ?? NEON_NOIR.text,
                        fontWeight: span.bold ? 600 : undefined,
                        opacity: span.dim ? 0.72 : undefined,
                      }}
                    >
                      {span.text}
                    </span>
                  ))
                )}
              </div>
            ))}
          </motion.pre>
        </AnimatePresence>
      </div>

      {caption ? (
        <div className="ansi-stage__caption" aria-live="polite">
          {caption}
        </div>
      ) : null}
    </div>
  );
}
