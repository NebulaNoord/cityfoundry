import { useCallback, useState } from 'react';
import { MainMenu } from './components/MainMenu.jsx';
import { GameScreen } from './components/GameScreen.jsx';
import { useGame } from './store.js';

export function App() {
  const [sim, setSim] = useState(null);
  const reset = useGame((s) => s.reset);

  const start = useCallback(
    (newSim) => {
      reset();
      useGame.setState({ screen: 'game' });
      setSim(newSim);
    },
    [reset],
  );

  const quit = useCallback(() => {
    setSim(null);
    reset();
  }, [reset]);

  if (!sim) return <MainMenu onStart={start} />;
  return <GameScreen key={sim.getWorld().seed + ':' + sim.getTime().tick} sim={sim} onQuit={quit} />;
}
