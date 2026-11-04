import { useGame } from '../store.js';
import { ZONE_NAMES, formatInt } from '../format.js';
import { Icon } from './icons.jsx';

const STATE_TEXT = { constructing: 'Under construction', active: 'Active', abandoned: 'Abandoned' };
const ROAD_TEXT = { street: 'Street', avenue: 'Avenue', highway: 'Highway (outside connection)' };

function Row({ k, children, tone }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd className={tone || ''}>{children}</dd>
    </div>
  );
}

export function InspectPanel() {
  const selected = useGame((s) => s.selected);
  const inspect = useGame((s) => s.inspect);
  if (!selected || !inspect) return null;
  const { tile, building: b } = inspect;
  if (!tile) return null;
  const close = () => useGame.setState({ selected: null, inspect: null });

  let title = tile.terrain === 'water' ? 'Water' : 'Open land';
  if (tile.road) title = ROAD_TEXT[tile.road.type] || 'Road';
  else if (b) title = `${ZONE_NAMES[b.zone]} building`;
  else if (tile.zone) title = `${ZONE_NAMES[tile.zone]} zone`;

  return (
    <section className="plate panel inspect" aria-labelledby="inspect-h" data-testid="inspect">
      <header className="panel-head">
        <h2 id="inspect-h">{title}</h2>
        <button className="btn-icon" onClick={close} aria-label="Close inspector">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="coords">
        Tile {tile.x}, {tile.y}
      </p>
      <dl>
        <Row k="Zone">{tile.zone ? ZONE_NAMES[tile.zone] : 'None'}</Row>
        <Row k="Land value">
          <span className="lv-bar" aria-hidden="true">
            <span style={{ width: `${tile.landValue}%` }} />
          </span>
          {tile.landValue}
        </Row>
        <Row k="Road access" tone={tile.roadAccess ? 'pos' : 'neg'}>
          {tile.roadAccess ? 'Yes' : 'No road within 4 tiles'}
        </Row>
        <Row k="Connected" tone={tile.connected ? 'pos' : 'neg'}>
          {tile.connected ? 'Reaches the highway' : 'Not linked to the highway'}
        </Row>
      </dl>
      {b && (
        <>
          <h3>Building</h3>
          <dl>
            <Row k="State" tone={b.state === 'abandoned' ? 'neg' : b.state === 'active' ? 'pos' : 'warnish'}>
              {STATE_TEXT[b.state] || b.state}
              {b.state === 'constructing' && ` (${Math.round(b.constructionProgress * 100)}%)`}
            </Row>
            <Row k={b.zone === 'R' ? 'Households' : 'Workers'}>
              {formatInt(b.occupants)} of {formatInt(b.capacity)}
            </Row>
            <Row k="Level">{b.level}</Row>
          </dl>
        </>
      )}
    </section>
  );
}
