import { useEffect } from 'react';
import { useGame } from '../store.js';

export function Toast() {
  const toast = useGame((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => {
      if (useGame.getState().toast === toast) useGame.setState({ toast: null });
    }, 2600);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" data-testid="toast">
      {toast.text}
    </div>
  );
}
