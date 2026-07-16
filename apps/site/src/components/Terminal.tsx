import { useEffect, useRef, useState } from 'react';
import type { TerminalStep } from '../i18n/translations';

interface TerminalProps {
  steps: TerminalStep[];
}

const CHAR_DELAY = 28;
const OUTPUT_DELAY = 520;
const STEP_DELAY = 280;
const LOOP_DELAY = 2400;

type Phase = 'typing' | 'output' | 'waiting' | 'done';

export function Terminal({ steps }: TerminalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const reducedMotion = useRef(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  const schedule = (fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  };

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion.current) {
      const flat = steps.flatMap((s) => [`$ ${s.cmd}`, s.output]);
      setLines(flat);
      setCurrentLine('');
      setShowCursor(false);
      setPhase('done');
      return;
    }
    setPhase('typing');
    setLineIndex(0);
    setCharIndex(0);
    setCurrentLine('');
    setLines([]);
    setShowCursor(true);

    return clearTimers;
  }, [steps]);

  useEffect(() => {
    if (reducedMotion.current || phase !== 'typing') return;
    if (lineIndex >= steps.length) {
      setPhase('done');
      schedule(() => {
        setLines([]);
        setLineIndex(0);
        setCharIndex(0);
        setCurrentLine('');
        setPhase('typing');
      }, LOOP_DELAY);
      return;
    }
    const step = steps[lineIndex];
    if (charIndex < step.cmd.length) {
      const id = window.setTimeout(() => {
        setCurrentLine(step.cmd.slice(0, charIndex + 1));
        setCharIndex(charIndex + 1);
      }, CHAR_DELAY);
      timers.current.push(id);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setPhase('output'), OUTPUT_DELAY);
    timers.current.push(id);
    return () => window.clearTimeout(id);
  }, [phase, lineIndex, charIndex, steps]);

  useEffect(() => {
    if (reducedMotion.current || phase !== 'output') return;
    const step = steps[lineIndex];
    const id = window.setTimeout(() => {
      setLines((prev) => [...prev, `$ ${step.cmd}`, step.output]);
      setCurrentLine('');
      setCharIndex(0);
      setLineIndex((prev) => prev + 1);
      setPhase('typing');
    }, STEP_DELAY);
    timers.current.push(id);
    return () => window.clearTimeout(id);
  }, [phase, lineIndex, steps]);

  useEffect(() => {
    if (reducedMotion.current) return;
    const id = window.setInterval(() => setShowCursor((v) => !v), 530);
    return () => window.clearInterval(id);
  }, []);

  const renderLine = (line: string, i: number) => {
    if (line.startsWith('$ ')) {
      return (
        <div key={i} className="mt-1">
          <span className="text-amber">$</span>{' '}
          <span className="text-text">{line.slice(2)}</span>
        </div>
      );
    }

    let colorClass = 'text-muted';
    if (line.includes('UltraPlan') || line.includes('interview')) colorClass = 'text-soft';
    if (line.includes('goal locked') || line.includes('passed')) colorClass = 'text-emerald';
    if (line.includes('Ultrawork') || line.includes('Routes')) colorClass = 'text-rose';
    if (line.includes('Server listening') || line.includes('Resumed')) colorClass = 'text-soft';
    if (line.includes('Blood Moon')) colorClass = 'text-cyan-dim';

    return (
      <div key={i} className={colorClass}>
        {line}
      </div>
    );
  };

  return (
    <div
      className="terminal-glow overflow-hidden rounded-2xl border border-line bg-bg-2/90 shadow-2xl backdrop-blur instrument"
      role="img"
      aria-label="Live terminal simulation"
    >
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="h-3 w-3 rounded-full bg-rose" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-amber" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-emerald" aria-hidden="true" />
        <span className="ml-2 font-mono text-xs font-medium text-muted">liora · blood-moon</span>
        <span className="ml-auto hidden items-center gap-1.5 font-mono text-[10px] text-muted sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald pulse-dot" />
          live
        </span>
      </div>
      <div className="min-h-[18rem] p-5 font-mono text-sm leading-relaxed text-soft">
        <div aria-live="polite" aria-atomic="false">
          {lines.map(renderLine)}
          {lineIndex < steps.length && phase !== 'done' && (
            <div className="mt-1">
              <span className="text-amber">$</span>{' '}
              <span className="text-text">
                {currentLine}
                {showCursor && <span className="terminal-cursor ml-0.5" />}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
