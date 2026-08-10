import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  stagger?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Reveal({ children, className = '', stagger }: RevealProps) {
  const reduce = usePrefersReducedMotion();
  const delay = stagger ? (stagger - 1) * 0.07 : 0;

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28, filter: 'blur(6px)' }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-10% 0px', amount: 0.15 }}
      transition={{ duration: reduce ? 0 : 0.65, delay: reduce ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
