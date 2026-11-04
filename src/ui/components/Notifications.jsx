import { useState } from 'react';
import { useGame } from '../store.js';
import { Icon } from './icons.jsx';
import { formatDate } from '../format.js';


export function Notifications() {
  const list = useGame((s) => s.notifications);
  const dismiss = useGame((s) => s.dismissNotification);
  const [open, setOpen] = useState(true);
  if (!list.length) return null;
  const shown = open ? list.slice(0, 4) : [];
  return (
    <section className="notes" aria-label="City notices" data-testid="notifications">
      <button className="notes-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Notices <span className="count">{list.length}</span>
      </button>
      <ul aria-live="polite">
        {shown.map((n) => (
          <li key={n.id} className={`note ${n.level}`}>
            {n.time && <span className="note-when">{formatDate(n.time)}</span>}
            <p>{n.message}</p>
            <button className="btn-icon" onClick={() => dismiss(n.id)} aria-label="Dismiss notice">
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
