import { useGame } from '../store.js';
import { TOOLS, TOOL_ORDER, ROAD_TYPES } from '../tools.js';
import { Icon } from './icons.jsx';

const GROUPS = [['inspect'], ['road'], ['zoneR', 'zoneC', 'zoneI', 'dezone'], ['bulldoze']];

export function Toolbar({ ctl }) {
  const tool = useGame((s) => s.tool);
  const roadType = useGame((s) => s.roadType);

  return (
    <nav className="toolbar plate" aria-label="Tools" data-testid="toolbar">
      <div className="tools" role="toolbar" aria-orientation="horizontal">
        {GROUPS.map((group, gi) => (
          <div className="tool-group" key={gi}>
            {group.map((id) => {
              const t = TOOLS[id];
              const zone = t.zone;
              return (
                <button
                  key={id}
                  className={`tool${tool === id ? ' on' : ''}${zone ? ` zone-${zone.toLowerCase()}` : ''}`}
                  aria-pressed={tool === id}
                  onClick={() => ctl.setTool(id)}
                  title={`${t.label} (${t.key})`}
                  data-testid={`tool-${id}`}
                >
                  <Icon name={id} size={22} />
                  <span className="tool-label">{t.label}</span>
                  <span className="tool-short" aria-hidden="true">
                    {t.short}
                  </span>
                  <kbd>{t.key}</kbd>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {tool === 'road' && (
        <div className="subtools" role="radiogroup" aria-label="Road type">
          {Object.values(ROAD_TYPES).map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={roadType === r.id}
              className={`chip${roadType === r.id ? ' on' : ''}`}
              onClick={() => useGame.getState().setRoadType(r.id)}
              data-testid={`road-${r.id}`}
            >
              {r.label}
              <span className="chip-meta">{r.id === 'street' ? '$10 per tile' : '$25 per tile'}</span>
            </button>
          ))}
        </div>
      )}
      <p className="tool-hint" aria-live="polite">
        <span className="hint-pointer">{TOOLS[tool] ? TOOLS[tool].hint : ''}</span>
        <span className="hint-touch">{TOOLS[tool] ? TOOLS[tool].touchHint : ''}</span>
      </p>
    </nav>
  );
}

export { TOOL_ORDER };
