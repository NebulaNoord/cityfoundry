// Zustand store: UI-only state plus throttled snapshots of sim queries for the
// HUD. The renderer and input controller read/write it imperatively
// (useGame.getState()), React components subscribe to slices.
import { create } from 'zustand';

export const MAX_NOTIFICATIONS = 30;

export const initialState = {
  screen: 'menu', // 'menu' | 'loading' | 'game'
  cityName: '',
  slot: null,
  tool: 'inspect',
  roadType: 'street',
  hover: null, // {x,y}
  selected: null, // {x,y}
  inspect: null, // { tile, building } snapshot for the selected tile
  stats: null,
  time: null,
  hour: 0,
  notifications: [],
  hint: null, // { text, tone: 'ok'|'bad', x, y } floating cursor hint
  toast: null, // { text, tone, id }
  saveState: { status: 'idle', at: null, error: null }, // 'idle'|'saving'|'saved'|'error'
  glLost: false,
  dragging: false, // a touch tool drag (road/zone/bulldoze) is in progress
  sheet: null, // compact layouts: 'city' when the demand/tax sheet is open
};

/** Pure reducer for notification feed: newest first, de-duplicated by id, capped. */
export function pushNotification(list, n) {
  if (!n) return list;
  if (n.id != null && list.some((m) => m.id === n.id)) return list;
  return [n, ...list].slice(0, MAX_NOTIFICATIONS);
}

export const useGame = create((set) => ({
  ...initialState,
  setTool: (tool) => set({ tool, hint: null }),
  setRoadType: (roadType) => set({ roadType }),
  setHover: (hover) => set({ hover }),
  addNotification: (n) => set((s) => ({ notifications: pushNotification(s.notifications, n) })),
  dismissNotification: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  showToast: (text, tone = 'info') => set({ toast: { text, tone, id: Date.now() + Math.random() } }),
  toggleSheet: (name) => set((s) => ({ sheet: s.sheet === name ? null : name })),
  reset: () => set({ ...initialState }),
}));
