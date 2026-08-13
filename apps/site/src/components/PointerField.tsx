import { useEffect } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

export function PointerField() {
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const root = document.documentElement;
    const onMove = (e: PointerEvent) => {
      root.style.setProperty('--mx', `${String(e.clientX)}px`);
      root.style.setProperty('--my', `${String(e.clientY)}px`);
      root.style.setProperty('--mxn', (e.clientX / window.innerWidth).toFixed(4));
      root.style.setProperty('--myn', (e.clientY / window.innerHeight).toFixed(4));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [reduce]);

  if (reduce) return null;
  return <div className="pointer-glow" aria-hidden="true" />;
}
