import { useGame } from '../store.js';
import { formatDate, formatHour, formatInt, formatMoney, formatSignedMoney } from '../format.js';
import { Icon } from './icons.jsx';

const SPEEDS = [
  { n: 0, label: 'Pause', key: 'Space or 0' },
  { n: 1, label: 'Normal speed', key: '1' },
  { n: 2, label: 'Fast', key: '2' },
  { n: 3, label: 'Fastest', key: '3' },
];

function SpeedGlyph({ n }) {
  if (n === 0) return <Icon name="pause" size={16} />;
  return (
    <svg width={8 * n + 8} height={16} viewBox={`0 0 ${8 * n + 8} 16`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <path key={i} d={`M${3 + i * 8} 3l8 5-8 5z`} fill="currentColor" />
      ))}
    </svg>
  );
}

export function TopBar({ ctl, onQuit }) {
  const name = useGame((s) => s.cityName);
  const time = useGame((s) => s.time);
  const stats = useGame((s) => s.stats);
  const saveState = useGame((s) => s.saveState);
  const speed = time ? time.speed : 0;
  const net = stats ? stats.daily.net : 0;
  const funds = stats ? stats.funds : 0;

  return (
    <header className="topbar plate" data-testid="topbar">
      <div className="tb-city">
        <button className="btn-icon" onClick={onQuit} title="Main menu (progress is autosaved)" aria-label="Main menu">
          <Icon name="menu" size={18} />
        </button>
        <div>
          <div className="tb-name" data-testid="city-title">{name}</div>
          <div className="tb-date" data-testid="date">
            {formatDate(time)} <span className="tb-hour">{formatHour(time && time.hour)}</span>
          </div>
        </div>
      </div>

      <div className="tb-speed" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s.n}
            role="radio"
            aria-checked={speed === s.n}
            className={`speed-btn${speed === s.n ? ' on' : ''}`}
            onClick={() => ctl.setSpeed(s.n)}
            title={`${s.label} (${s.key})`}
            aria-label={s.label}
            data-testid={`speed-${s.n}`}
          >
            <SpeedGlyph n={s.n} />
          </button>
        ))}
      </div>

      <dl className="tb-figures">
        <div className={`fig fig-funds${funds < 0 ? ' neg' : ''}`}>
          <dt>Funds</dt>
          <dd data-testid="funds">{stats ? formatMoney(funds) : '—'}</dd>
        </div>
        <div className="fig">
          <dt>Daily net</dt>
          <dd data-testid="daily-net" className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>
            {stats ? formatSignedMoney(net) : '—'}
          </dd>
        </div>
        <div className="fig">
          <dt>Population</dt>
          <dd data-testid="population">{stats ? formatInt(stats.population) : '—'}</dd>
        </div>
        <div className="fig fig-sub">
          <dt>Jobs filled</dt>
          <dd data-testid="jobs">
            {stats ? `${formatInt(stats.jobs.total)} / ${formatInt(stats.jobCapacity.total)}` : '—'}
          </dd>
        </div>
      </dl>

      <button
        className={`btn btn-save${saveState.status === 'error' ? ' bad' : ''}`}
        onClick={() => ctl.save()}
        disabled={saveState.status === 'saving'}
        data-testid="save"
        title={saveState.error || 'Save this city'}
      >
        <Icon name="save" size={16} />
        {saveState.status === 'saving' ? 'Saving…' : 'Save'}
      </button>
    </header>
  );
}
