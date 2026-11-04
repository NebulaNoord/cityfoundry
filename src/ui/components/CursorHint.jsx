import { useGame } from '../store.js';

export function CursorHint() {
  const hint = useGame((s) => s.hint);
  if (!hint) return null;
  // Under a mouse the hint trails the cursor; under a finger it floats above
  // the touch point (clamped to the screen) so the finger doesn't hide it.
  let x = hint.x + 18, y = hint.y + 18;
  if (hint.touch) {
    const w = typeof window !== 'undefined' ? window.innerWidth : 400;
    x = Math.max(8, Math.min(w - 200, hint.x - 90));
    y = Math.max(8, hint.y - 96);
  }
  return (
    <div
      className={`cursor-hint ${hint.tone}${hint.touch ? ' touch' : ''}`}
      style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` }}
      role="status"
      data-testid="cursor-hint"
    >
      <strong>{hint.title}</strong>
      {hint.detail && <span>{hint.detail}</span>}
    </div>
  );
}
