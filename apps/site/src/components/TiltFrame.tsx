import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

/** Pointer-tilt wrapper for TUI chrome demos. */
export function TiltFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = usePrefersReducedMotion();
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(y, [0, 1], [8, -8]), { stiffness: 220, damping: 24 });
  const rotateY = useSpring(useTransform(x, [0, 1], [-10, 10]), { stiffness: 220, damping: 24 });
  const glareX = useTransform(x, [0, 1], [0, 100]);
  const glareY = useTransform(y, [0, 1], [0, 100]);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(0,213,255,0.18), transparent 45%)`;

  if (reduce) {
    return <div className={`tilt-frame ${className}`.trim()}>{children}</div>;
  }

  return (
    <motion.div
      className={`tilt-frame ${className}`.trim()}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - rect.left) / rect.width);
        y.set((e.clientY - rect.top) / rect.height);
      }}
      onPointerLeave={() => {
        x.set(0.5);
        y.set(0.5);
      }}
    >
      <motion.div className="tilt-frame__glare" style={{ background: glare }} aria-hidden="true" />
      <div className="tilt-frame__inner">{children}</div>
    </motion.div>
  );
}
