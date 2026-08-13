import type { ReactNode } from 'react';

export function TuiChrome({
  title,
  badge,
  children,
  className = '',
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`tui-chrome tui-chrome--crt ${className}`.trim()} aria-hidden="true">
      <div className="tui-chrome__glow" />
      <div className="tui-chrome__bar">
        <div className="tui-chrome__dots">
          <span className="tui-chrome__dot tui-chrome__dot--rose" />
          <span className="tui-chrome__dot tui-chrome__dot--amber" />
          <span className="tui-chrome__dot tui-chrome__dot--emerald" />
        </div>
        <span className="tui-chrome__title">{title}</span>
        {badge ? <span className="tui-chrome__badge">{badge}</span> : null}
      </div>
      <div className="tui-chrome__screen">
        <div className="tui-chrome__body">{children}</div>
        <div className="crt-scanlines" />
        <div className="crt-sweep" />
        <div className="crt-vignette" />
        <div className="crt-reflect" />
      </div>
    </div>
  );
}
