import { useEffect } from 'react';

/** Pointer-linked atmosphere. Always on — this is user-driven, not autoplay motion. */
export function PointerField() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (x: number, y: number) => {
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      root.style.setProperty('--mx', `${String(x)}px`);
      root.style.setProperty('--my', `${String(y)}px`);
      root.style.setProperty('--mxn', (x / w).toFixed(4));
      root.style.setProperty('--myn', (y / h).toFixed(4));
    };
    apply(window.innerWidth * 0.62, window.innerHeight * 0.28);
    const onMove = (e: PointerEvent) => {
      apply(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <>
      <div className="ambient-field" aria-hidden="true" data-atmosphere="on" />
      <div className="pointer-glow" aria-hidden="true" />
      <div className="cursor-ring" aria-hidden="true" />
    </>
  );
}
