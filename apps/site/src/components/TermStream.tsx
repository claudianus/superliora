import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

export function TermStream({ lines }: { lines: string[] }) {
  const reduce = usePrefersReducedMotion();
  const [done, setDone] = useState<string[]>(() => lines.slice(0, reduce ? 5 : 1));
  const [partial, setPartial] = useState('');

  useEffect(() => {
    if (lines.length === 0) return;
    if (reduce) {
      setDone(lines.slice(0, 5));
      setPartial('');
      return;
    }
    let line = 1;
    let char = 0;
    const id = window.setInterval(() => {
      const full = lines[line % lines.length] ?? '';
      char += 1;
      if (char <= full.length) {
        setPartial(full.slice(0, char));
        return;
      }
      if (char === full.length + 1) {
        setDone((prev) => [...prev.slice(-3), full]);
        setPartial('');
      }
      if (char > full.length + 14) {
        line += 1;
        char = 0;
      }
    }, 34);
    return () => {
      window.clearInterval(id);
    };
  }, [lines, reduce]);

  return (
    <div className="term-stream" data-term-stream="on">
      <div className="term-stream__head">
        <span className="term-stream__live" />
        <span>stdout</span>
      </div>
      <ol className="term-stream__log">
        {done.map((line, i) => (
          <li key={`${line}-${String(i)}`} className="term-stream__line">
            <span className="term-stream__prompt">›</span>
            {line}
          </li>
        ))}
        {partial ? (
          <li className="term-stream__line term-stream__line--active">
            <span className="term-stream__prompt">›</span>
            {partial}
            <span className="term-stream__caret" />
          </li>
        ) : null}
      </ol>
    </div>
  );
}
