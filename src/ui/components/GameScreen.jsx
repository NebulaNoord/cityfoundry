import { useEffect, useRef, useState } from 'react';
import { GameController } from '../game/GameController.js';
import { useGame } from '../store.js';
import { AUTOSAVE_SLOT } from '../../sim/storage.js';
import { tileCenter } from '../render/iso.js';
import { worldToScreen } from '../render/camera.js';
import { TopBar } from './TopBar.jsx';
import { Toolbar } from './Toolbar.jsx';
import { DemandPanel } from './DemandPanel.jsx';
import { InspectPanel } from './InspectPanel.jsx';
import { Notifications } from './Notifications.jsx';
import { CursorHint } from './CursorHint.jsx';
import { Toast } from './Toast.jsx';

export function GameScreen({ sim, onQuit }) {
  const hostRef = useRef(null);
  const [ctl, setCtl] = useState(null);
  const [error, setError] = useState(null);
  const glLost = useGame((s) => s.glLost);
  const dragging = useGame((s) => s.dragging);

  useEffect(() => {
    const c = new GameController(sim);
    let alive = true;
    c.mount(hostRef.current)
      .then(() => {
        if (!alive) return;
        setCtl(c);
        exposeDebug(sim, c);
      })
      .catch((err) => {
        console.error('[cityfoundry] renderer failed to start', err);
        if (alive) setError('The map renderer could not start. WebGL may be disabled in this browser.');
      });
    return () => {
      alive = false;
      c.destroy();
      if (window.__cityfoundry && window.__cityfoundry.sim === sim) delete window.__cityfoundry;
    };
  }, [sim]);

  const quit = async () => {
    // Leaving writes the autosave slot, which the menu offers as "Continue".
    if (ctl) await ctl.save(AUTOSAVE_SLOT, { quiet: true }).catch(() => null);
    onQuit();
  };

  return (
    <div className="game">
      <div className="map-host" ref={hostRef} tabIndex={-1} />
      {error && (
        <div className="fatal" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={onQuit}>
            Back to menu
          </button>
        </div>
      )}
      {ctl && (
        <>
          <TopBar ctl={ctl} onQuit={quit} />
          <Toolbar ctl={ctl} />
          <aside className="side">
            <DemandPanel ctl={ctl} />
            <InspectPanel ctl={ctl} />
          </aside>
          <Notifications ctl={ctl} />
          {dragging && (
            // Touch drags only: the Esc equivalent. Tap it with another finger,
            // or slide the dragging finger onto it and lift.
            <button className="btn cancel-drag" data-cancel-drag onClick={() => ctl.cancelDrag()} data-testid="cancel-drag">
              Cancel
            </button>
          )}
          <CursorHint />
          <Toast />
        </>
      )}
      {glLost && (
        <div className="fatal soft" role="status">
          <p>The graphics context was lost. Waiting for the browser to restore it…</p>
        </div>
      )}
    </div>
  );
}

/** Dev/test-only read hook. Exposed in dev builds or with ?debug in the URL. */
function exposeDebug(sim, ctl) {
  const debug = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
  if (!debug) return;
  window.__cityfoundry = {
    sim,
    camera: () => ({ ...ctl.cam }),
    renderStats: () => ({ ...ctl.renderer.stats }),
    /** Canvas-pixel position of a tile centre, for driving real mouse events in tests. */
    tileToScreen: (x, y) => {
      const { w, h } = ctl.viewport();
      const c = tileCenter(x, y);
      return worldToScreen(ctl.cam, w, h, c.x, c.y);
    },
  };
}
