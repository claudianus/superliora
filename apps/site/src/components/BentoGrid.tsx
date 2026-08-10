import { motion } from 'motion/react';
import type { FeatureItem } from '../i18n/translations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

function cellSize(index: number, total: number): 'hero' | 'lg' | 'md' | 'sm' {
  if (total <= 3) return index === 0 ? 'hero' : 'lg';
  // 6 → three equal columns × two rows (no orphan cell)
  if (total === 6) return 'md';
  if (total === 7) return index === 0 ? 'hero' : index < 3 ? 'lg' : 'md';
  // 8+
  if (index === 0) return 'hero';
  if (index < 3) return 'lg';
  return 'md';
}

export function BentoGrid({ features }: { features: FeatureItem[] }) {
  const reduce = usePrefersReducedMotion();

  return (
    <div className="bento" data-count={String(features.length)} role="list">
      {features.map((feature, i) => {
        const size = cellSize(i, features.length);
        return (
          <motion.div
            key={feature.id}
            role="listitem"
            className={`bento__cell bento__cell--${size}`}
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-8% 0px' }}
            transition={{ duration: 0.45, delay: reduce ? 0 : i * 0.045, ease: [0.22, 1, 0.36, 1] }}
            whileHover={
              reduce
                ? undefined
                : {
                    y: -4,
                    transition: { type: 'spring', stiffness: 420, damping: 28 },
                  }
            }
          >
            <div className="bento__glow" aria-hidden="true" />
            <div className="bento__index font-mono">{String(i + 1).padStart(2, '0')}</div>
            <div className="bento__title">{feature.title}</div>
            <p className="bento__body">{feature.body}</p>
            <span className="bento__sheen" aria-hidden="true" />
          </motion.div>
        );
      })}
    </div>
  );
}
