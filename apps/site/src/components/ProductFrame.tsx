import { useI18n } from '../i18n';
import { TermStream } from './TermStream';
import { TuiChrome } from './tui/TuiChrome';

/** Hero showcase — curated board + worker strip. */
export function ProductFrame() {
  const { t } = useI18n();
  const f = t.hero.frame;

  return (
    <TuiChrome title="SuperLiora" badge="live">
      <div className="product-frame__body">
        <div className="product-frame__conductor">
          <span className="product-frame__conductor-mark" aria-hidden="true">⌁</span>
          <div className="product-frame__conductor-meta">
            <span>{f.conductor}</span>
            <strong>{f.conductorState}</strong>
          </div>
          <span className="product-frame__inbox">{f.inbox}</span>
        </div>
        <div className="product-frame__job">
          <span className="product-frame__live" />
          <span className="product-frame__job-label">{f.jobLabel}</span>
          <span className="product-frame__job-name">{f.jobName}</span>
          <span className="product-frame__branch">worktree/job_a1</span>
          <span className="product-frame__job-status">{f.jobStatus}</span>
        </div>

        <div className="product-frame__board">
          <div className="product-frame__board-head">
            <span>{f.boardTitle}</span>
            <span className="product-frame__progress-label">{f.progress}</span>
          </div>
          <div className="product-frame__progress" role="presentation">
            <div className="product-frame__progress-bar" />
          </div>
          <div className="product-frame__cols">
            <div className="product-frame__col">
              <div className="product-frame__col-label">{f.doingLabel}</div>
              <div className="product-frame__item product-frame__item--active">{f.doing}</div>
            </div>
            <div className="product-frame__col">
              <div className="product-frame__col-label">{f.nextLabel}</div>
              <div className="product-frame__item">{f.next}</div>
            </div>
            <div className="product-frame__col">
              <div className="product-frame__col-label">{f.doneLabel}</div>
              <div className="product-frame__item product-frame__item--done">{f.done}</div>
            </div>
          </div>
        </div>

        <div className="product-frame__worker">
          <div className="product-frame__worker-meta">
            <span className="product-frame__worker-name">{f.workerName}</span>
            <span className="product-frame__worker-model">{f.workerModel}</span>
          </div>
          <div className="product-frame__spark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <span className="product-frame__worker-rate">{f.workerRate}</span>
        </div>
        <div className="product-frame__rail" aria-label="Job states">
          <span><i className="product-frame__state product-frame__state--run" />01 running</span>
          <span><i className="product-frame__state product-frame__state--ask" />01 needs you</span>
          <span><i className="product-frame__state product-frame__state--done" />01 landed</span>
        </div>
        <TermStream lines={f.stream} />
      </div>
    </TuiChrome>
  );
}
