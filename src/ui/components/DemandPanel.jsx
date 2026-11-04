import { useGame } from '../store.js';
import { ZONE_NAMES, formatInt, formatSignedMoney } from '../format.js';
import { Icon } from './icons.jsx';

const ZONES = ['R', 'C', 'I'];

/** Bipolar demand gauge −100..100, centre zero. */
function Gauge({ zone, value }) {
  const v = Math.max(-100, Math.min(100, value ?? 0));
  const pct = Math.abs(v) / 2; // half the track per side
  return (
    <div className={`gauge zone-${zone.toLowerCase()}`} data-testid={`demand-${zone}`} data-value={v}>
      <div className="gauge-label">
        <span className="gauge-letter">{zone}</span>
      </div>
      <div
        className="gauge-track"
        role="meter"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={`${ZONE_NAMES[zone]} demand`}
      >
        <div className="gauge-zero" />
        <div className={`gauge-fill${v < 0 ? ' neg' : ''}`} style={v >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />
      </div>
      <span className="gauge-num">{v > 0 ? `+${v}` : v}</span>
    </div>
  );
}

export function DemandPanel({ ctl }) {
  const stats = useGame((s) => s.stats);
  const sheet = useGame((s) => s.sheet);
  if (!stats) return null;
  return (
    <section
      className={`plate panel demand${sheet === 'city' ? ' sheet-open' : ''}`}
      aria-labelledby="demand-h"
      id="city-sheet"
      data-testid="demand-panel"
    >
      <header className="panel-head">
        <h2 id="demand-h">Demand</h2>
        {/* compact layouts only */}
        <button className="btn-icon sheet-close" onClick={() => useGame.setState({ sheet: null })} aria-label="Close city panel" data-testid="sheet-close">
          <Icon name="close" size={16} />
        </button>
      </header>
      {/* compact layouts only: top-bar figures that don't fit on a phone */}
      <dl className="sheet-figures">
        <div>
          <dt>Daily net</dt>
          <dd className={stats.daily.net > 0 ? 'pos' : stats.daily.net < 0 ? 'neg' : ''}>{formatSignedMoney(stats.daily.net)}</dd>
        </div>
        <div>
          <dt>Jobs filled</dt>
          <dd>
            {formatInt(stats.jobs.total)} / {formatInt(stats.jobCapacity.total)}
          </dd>
        </div>
      </dl>
      <div className="gauges">
        {ZONES.map((z) => (
          <Gauge key={z} zone={z} value={stats.demand[z]} />
        ))}
      </div>
      <h3>Tax rates</h3>
      <div className="taxes">
        {ZONES.map((z) => (
          <label key={z} className={`tax zone-${z.toLowerCase()}`}>
            <span className="tax-name">{ZONE_NAMES[z]}</span>
            <input
              type="range"
              min={0}
              max={29}
              step={1}
              value={stats.taxRates[z]}
              onChange={(e) => ctl.setTaxRate(z, Number(e.target.value))}
              data-testid={`tax-${z}`}
              aria-valuetext={`${stats.taxRates[z]} percent`}
            />
            <output>{stats.taxRates[z]}%</output>
          </label>
        ))}
      </div>
      <dl className="mini-stats">
        <div>
          <dt>Households</dt>
          <dd>{formatInt(stats.households)}</dd>
        </div>
        <div>
          <dt>Unemployed</dt>
          <dd className={stats.unemployed > 0 ? 'warnish' : ''}>{formatInt(stats.unemployed)}</dd>
        </div>
        <div>
          <dt>Buildings</dt>
          <dd>
            <span className="zr">{stats.buildings.R}</span> <span className="zc">{stats.buildings.C}</span>{' '}
            <span className="zi">{stats.buildings.I}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
