import { useI18n } from '../../i18n';
import { TuiChrome } from './TuiChrome';

function Spark() {
  return (
    <div className="tui-spark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function StatusRoutePanel() {
  const { t } = useI18n();
  const v = t.visuals.statusRoute;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <div className="panel-status panel-status--demo">
        <div className="panel-status__strategy">
          <span className="panel-status__label">{v.strategyLabel}</span>
          <span className="panel-status__value">{v.strategy}</span>
          <span className="panel-status__ready">{v.ready}</span>
        </div>
        <ul className="panel-status__list">
          {v.candidates.map((c) => (
            <li key={c.rank} className={`panel-status__row panel-status__row--${c.tone}`} data-tone={c.tone}>
              <span className="panel-status__rank">{c.rank}</span>
              <span className="panel-status__name">{c.name}</span>
              <span className="panel-status__state">{c.state}</span>
            </li>
          ))}
        </ul>
        <div className="panel-status__roles">
          {v.roles.map((r) => (
            <div key={r.role} className="panel-status__role">
              <span>{r.role}</span>
              <span className="panel-status__arrow">→</span>
              <span>{r.model}</span>
            </div>
          ))}
        </div>
        <div className="panel-status__footer">{v.footer}</div>
      </div>
    </TuiChrome>
  );
}

function JobDeckPanel() {
  const { t } = useI18n();
  const v = t.visuals.jobDeck;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <div className="panel-deck panel-deck--demo">
        <div className="panel-deck__meta">
          <span>{v.subtitle}</span>
          <span className="panel-deck__inbox">{v.inbox}</span>
        </div>
        <ul className="panel-deck__list">
          {v.jobs.map((job) => (
            <li key={job.id} className={`panel-deck__job panel-deck__job--${job.tone}`} data-tone={job.tone}>
              <span className={`panel-deck__pill panel-deck__pill--${job.tone}`}>{job.status}</span>
              <div className="panel-deck__main">
                <div className="panel-deck__id">{job.id}</div>
                <div className="panel-deck__title">{job.title}</div>
              </div>
              <div className="panel-deck__side">
                <span>{job.phase}</span>
                <span className="panel-deck__age">{job.age}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="panel-deck__actions">
          {v.actions.map((a) => (
            <span key={a} className="panel-deck__action">
              {a}
            </span>
          ))}
        </div>
      </div>
    </TuiChrome>
  );
}

function CommandHubPanel() {
  const { t } = useI18n();
  const v = t.visuals.commandHub;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <div className="panel-hub">
        <div className="panel-hub__search">
          <span className="panel-hub__prompt">›</span>
          <span className="panel-hub__query">{v.query}</span>
          <span className="panel-hub__caret" />
        </div>
        <div className="panel-hub__modes">
          {v.modes.map((m) => (
            <span key={m.label} className={`panel-hub__mode${m.active ? ' panel-hub__mode--active' : ''}`}>
              {m.label}
            </span>
          ))}
        </div>
        <ul className="panel-hub__list">
          {v.rows.map((row) => (
            <li key={row.label} className={`panel-hub__row${row.selected ? ' panel-hub__row--selected' : ''}`}>
              <div>
                <div className="panel-hub__label">{row.label}</div>
                <div className="panel-hub__desc">{row.desc}</div>
              </div>
              <kbd className="panel-hub__keys">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </TuiChrome>
  );
}

function DiffStudioPanel() {
  const { t } = useI18n();
  const v = t.visuals.diffStudio;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <div className="panel-diff">
        <div className="panel-diff__tabs">
          {v.tabs.map((tab) => (
            <span key={tab.label} className={`panel-diff__tab${tab.active ? ' panel-diff__tab--active' : ''}`}>
              {tab.label}
            </span>
          ))}
        </div>
        <div className="panel-diff__file">{v.file}</div>
        <pre className="panel-diff__code">
          {v.lines.map((line, i) => (
            <div key={`${String(i)}-${line.kind}`} className={`panel-diff__line panel-diff__line--${line.kind}`}>
              <span className="panel-diff__gutter">{line.mark}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </pre>
        <div className="panel-diff__foot">
          <span>{v.stats}</span>
          <span className="panel-diff__hint">{v.hint}</span>
        </div>
      </div>
    </TuiChrome>
  );
}

function WorkerDockPanel() {
  const { t } = useI18n();
  const v = t.visuals.workerDock;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <div className="panel-dock">
        <div className="panel-dock__head">
          <span>{v.subtitle}</span>
          <span className="panel-dock__sum">{v.summary}</span>
        </div>
        <ul className="panel-dock__list">
          {v.workers.map((w) => (
            <li key={w.name} className="panel-dock__row">
              <span className={`panel-dock__pulse panel-dock__pulse--${w.tone}`} />
              <div className="panel-dock__meta">
                <div className="panel-dock__name">{w.name}</div>
                <div className="panel-dock__action">{w.action}</div>
              </div>
              <Spark />
              <span className="panel-dock__rate">{w.rate}</span>
            </li>
          ))}
        </ul>
        <div className="panel-dock__lane">
          {v.lane.map((item) => (
            <span key={item.label} className="panel-dock__chip">
              <strong>{item.count}</strong> {item.label}
            </span>
          ))}
        </div>
      </div>
    </TuiChrome>
  );
}

export function ClusterVisual({ clusterId }: { clusterId: string }) {
  switch (clusterId) {
    case 'keep-going':
      return <StatusRoutePanel />;
    case 'see-fleet':
      return (
        <div className="cluster-visual-stack">
          <JobDeckPanel />
          <WorkerDockPanel />
        </div>
      );
    case 'stay-control':
      return <CommandHubPanel />;
    case 'studio':
      return <DiffStudioPanel />;
    default:
      return null;
  }
}

export function UsageVisual() {
  const { t } = useI18n();
  return (
    <TuiChrome title="liora" badge="usage">
      <ol className="panel-usage">
        {t.usage.items.map((item) => (
          <li key={item.id} className="panel-usage__row">
            <code className="panel-usage__cmd">{item.cmd}</code>
            <span className="panel-usage__title">{item.title}</span>
          </li>
        ))}
      </ol>
    </TuiChrome>
  );
}

export function HowFlowVisual() {
  const { t } = useI18n();
  const v = t.visuals.howFlow;
  return (
    <TuiChrome title={v.chrome} badge={v.badge}>
      <ol className="panel-flow">
        {v.steps.map((step, i) => (
          <li key={step.title} className="panel-flow__step">
            <div className="panel-flow__num">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <div className="panel-flow__title">{step.title}</div>
              <div className="panel-flow__body">{step.body}</div>
            </div>
            {i < v.steps.length - 1 ? <span className="panel-flow__connector" /> : null}
          </li>
        ))}
      </ol>
    </TuiChrome>
  );
}

export function TowerHubVisual() {
  return <CommandHubPanel />;
}
