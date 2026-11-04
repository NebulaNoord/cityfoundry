import { useGame } from '../store.js';

export function CursorHint() {
  const hint = useGame((s) => s.hint);
  if (!hint) return null;
  return (
    <div
      className={`cursor-hint ${hint.tone}`}
      style={{ transform: `translate(${Math.round(hint.x + 18)}px, ${Math.round(hint.y + 18)}px)` }}
      role="status"
      data-testid="cursor-hint"
    >
      <strong>{hint.title}</strong>
      {hint.detail && <span>{hint.detail}</span>}
    </div>
  );
}
