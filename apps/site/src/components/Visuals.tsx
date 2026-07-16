import {
  CogIcon,
  CommandIcon,
  GoalIcon,
  MemoryIcon,
  PlanIcon,
  SwarmIcon,
  VerifyIcon,
} from './Icons';

const iconSize = 'h-4 w-4';

function Panel({
  children,
  className = '',
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-line bg-bg-1/80 p-4 shadow-card-sm ${glow ? 'shadow-glow' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

function StatusDot({ color = 'cyan' }: { color?: 'cyan' | 'emerald' | 'amber' | 'rose' }) {
  const map: Record<string, string> = {
    cyan: 'bg-cyan',
    emerald: 'bg-emerald',
    amber: 'bg-amber',
    rose: 'bg-rose',
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${map[color]} pulse-dot`} aria-hidden="true" />;
}

export function HeroCommandCenter() {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-bg-2 p-4 shadow-lg card-hover instrument scanline">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-rose/10 blur-3xl" />

      <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel className="col-span-2 sm:col-span-2" glow>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan">
              <CommandIcon className={iconSize} />
              <span>Terminal</span>
            </div>
            <StatusDot />
          </div>
          <div className="font-mono text-[11px] leading-relaxed text-soft sm:text-xs">
            <span className="text-cyan">$</span> liora --version
            <br />
            <span className="text-muted">›</span> SuperLiora 0.20.1
            <br />
            <span className="text-cyan">$</span> liora --plan
            <br />
            <span className="text-muted">›</span> UltraPlan interview armed
            <br />
            <span className="text-cyan">$</span> /ultrawork harden auth
            <br />
            <span className="text-emerald">›</span> goal locked · swarm deferred
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
            <GoalIcon className={`${iconSize} text-cyan`} />
            <span>UltraGoal</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-soft">
              <span>Scope</span>
              <span className="font-mono text-cyan">92%</span>
            </div>
            <div className="meter">
              <span style={{ width: '92%' }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>budget</span>
              <span className="font-mono">ok</span>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
            <SwarmIcon className={`${iconSize} text-rose`} />
            <span>Swarm</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {['A', 'S', 'T', 'D', 'X', 'Q'].map((label, i) => (
              <div
                key={label}
                className="flex aspect-square items-center justify-center rounded-md border border-line bg-bg-3 font-mono text-[10px] text-soft"
              >
                <span className={i < 3 ? 'text-cyan' : 'text-muted'}>{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 font-mono text-[10px] text-muted">ENGAGE · 3 live</div>
        </Panel>

        <Panel className="col-span-2 sm:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
            <CogIcon className={`${iconSize} text-amber`} />
            <span>Harness rail</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Plan', ok: true },
              { label: 'Research', ok: true },
              { label: 'Memory', ok: true },
              { label: 'Verify', ok: false },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-2 rounded-lg border border-line bg-bg-3 px-2 py-1.5"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${item.ok ? 'bg-emerald' : 'bg-amber'}`}
                />
                <span className="text-xs text-soft">{item.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="col-span-2 sm:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
            <MemoryIcon className={`${iconSize} text-cyan`} />
            <span>Liora Recall</span>
          </div>
          <div className="flex gap-2">
            {['Semantic', 'Episodic', 'Procedural'].map((m) => (
              <div
                key={m}
                className="flex-1 rounded-lg border border-line bg-bg-3 py-2 text-center text-[10px] text-soft"
              >
                {m}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-bg/80 px-3 py-1 text-xs font-medium text-text backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald pulse-dot" />
          SuperLiora 0.20.1
        </span>
      </div>
    </div>
  );
}

export function AgentCockpit() {
  return (
    <div className="group flex h-full min-h-[340px] flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-bg-2 p-4 shadow-lg card-hover instrument lg:flex-row">
      <Panel className="flex-1">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
          <PlanIcon className={`${iconSize} text-cyan`} />
          <span>Active sessions</span>
        </div>
        <div className="space-y-2">
          {[
            { name: 'refactor-auth', status: 'running' },
            { name: 'docs-deploy', status: 'done' },
            { name: 'perf-audit', status: 'paused' },
          ].map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-lg border border-line bg-bg-3 px-3 py-2"
            >
              <span className="font-mono text-xs text-soft">{s.name}</span>
              <span
                className={`text-[10px] uppercase tracking-wide ${
                  s.status === 'running'
                    ? 'text-emerald'
                    : s.status === 'done'
                      ? 'text-cyan'
                      : 'text-amber'
                }`}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="flex-[1.5]">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
          <CommandIcon className={`${iconSize} text-cyan`} />
          <span>Command log</span>
        </div>
        <div className="font-mono text-xs leading-6 text-soft">
          <div>
            <span className="text-muted">14:02</span> <span className="text-cyan">$</span> liora
            context index
          </div>
          <div>
            <span className="text-muted">14:05</span> <span className="text-cyan">$</span> swarm
            dispatch --research
          </div>
          <div>
            <span className="text-muted">14:09</span> <span className="text-cyan">$</span> verify
            tests
          </div>
          <div>
            <span className="text-muted">14:11</span> <span className="text-emerald">✓</span> 42
            passed · 0 flaky
          </div>
          <div>
            <span className="text-muted">14:13</span> <span className="text-rose">›</span> wiki seed
            written
          </div>
        </div>
      </Panel>

      <Panel className="flex-1">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
          <VerifyIcon className={`${iconSize} text-emerald`} />
          <span>Live metrics</span>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-soft">
              <span>Tokens</span>
              <span className="font-mono text-cyan">12.4k</span>
            </div>
            <div className="meter">
              <span style={{ width: '64%' }} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-soft">
              <span>Memory</span>
              <span className="font-mono text-emerald">87%</span>
            </div>
            <div className="meter">
              <span style={{ width: '87%' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="rounded-lg border border-line bg-bg-3 p-2 text-center">
              <div className="text-xs font-semibold text-text">3</div>
              <div className="text-[10px] text-muted">Agents</div>
            </div>
            <div className="rounded-lg border border-line bg-bg-3 p-2 text-center">
              <div className="text-xs font-semibold text-text">7</div>
              <div className="text-[10px] text-muted">Tasks</div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function WorkflowRail({
  steps,
}: {
  steps: { num: string; title: string; body: string }[];
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-bg-2 p-5 instrument">
      <div className="pointer-events-none absolute inset-x-8 top-[2.35rem] hidden h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent md:block" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {steps.map((step, i) => (
          <div key={step.num} className="relative rounded-xl border border-line bg-bg-1/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] text-cyan">{step.num}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-cyan/70" aria-hidden="true" />
            </div>
            <h3 className="font-sans text-sm font-semibold text-text">{step.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-soft">{step.body}</p>
            {i < steps.length - 1 && (
              <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-muted xl:block">
                ›
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
