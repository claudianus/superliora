import { useInView } from '../hooks/useInView';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  stagger?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Reveal({ children, className = '', stagger }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>({
    threshold: 0.04,
    rootMargin: '0px 0px 18% 0px',
  });
  const staggerClass = stagger ? `stagger-${stagger}` : '';
  const classes = `reveal ${inView ? 'visible' : ''} ${staggerClass} ${className}`.trim();

  return (
    <div ref={ref} className={classes}>
      {children}
    </div>
  );
}
