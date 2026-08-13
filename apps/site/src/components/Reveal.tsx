import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  stagger?: 1 | 2 | 3 | 4 | 5 | 6;
  /** First-viewport blocks skip the entrance motion so they cannot stay hidden. */
  eager?: boolean;
}

export function Reveal({ children, className = '', stagger, eager = false }: RevealProps) {
  const reduce = usePrefersReducedMotion();
  const delay = stagger ? (stagger - 1) * 0.07 : 0;
  const skipMotion = reduce || eager;

  return (
    <motion.div
      className={className}
      initial={skipMotion ? false : { opacity: 1, y: 18 }}
      whileInView={skipMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.01, margin: '0px 0px -6% 0px' }}
      transition={{ duration: skipMotion ? 0 : 0.5, delay: skipMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
