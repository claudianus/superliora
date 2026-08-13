import { getLandingManifest } from '../landing';
import { useI18n } from '../i18n';

export function CommandTicker() {
  const { lang } = useI18n();
  const items = getLandingManifest(lang).usage;
  const loop = [...items, ...items];

  return (
    <div className="cmd-ticker" aria-hidden="true">
      <div className="cmd-ticker__track">
        {loop.map((item, i) => (
          <span key={`${item.id}-${String(i)}`} className="cmd-ticker__item">
            <code>{item.cmd}</code>
            <em>{item.title}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
