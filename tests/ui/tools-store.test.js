import { describe, it, expect, beforeEach } from 'vitest';
import { toolForKey, normRect, cellsInRect, zoneBlockReason, zoneForTool, isZoneTool, errorText } from '../../src/ui/tools.js';
import { pushNotification, useGame, MAX_NOTIFICATIONS } from '../../src/ui/store.js';
import { formatMoney, formatSignedMoney, formatDate } from '../../src/ui/format.js';

describe('tools', () => {
  it('maps hotkeys', () => {
    expect(toolForKey('q')).toBe('inspect');
    expect(toolForKey('r')).toBe('road');
    expect(toolForKey('B')).toBe('bulldoze');
    expect(toolForKey('z')).toBe('zoneR');
    expect(toolForKey('x')).toBe('zoneC');
    expect(toolForKey('c')).toBe('zoneI');
    expect(toolForKey('v')).toBe('dezone');
    expect(toolForKey('k')).toBe(null);
  });

  it('zone tool mapping', () => {
    expect(zoneForTool('zoneR')).toBe('R');
    expect(zoneForTool('dezone')).toBe(null);
    expect(zoneForTool('road')).toBe(undefined);
    expect(isZoneTool('dezone')).toBe(true);
    expect(isZoneTool('bulldoze')).toBe(false);
  });

  it('normalises and clamps rects', () => {
    expect(normRect({ x: 5, y: 9 }, { x: 2, y: 3 }, 128, 128)).toEqual({ x0: 2, y0: 3, x1: 5, y1: 9 });
    expect(normRect({ x: -4, y: 0 }, { x: 200, y: 1 }, 128, 128)).toEqual({ x0: 0, y0: 0, x1: 127, y1: 1 });
    expect(normRect({ x: -4, y: 0 }, { x: -1, y: 1 }, 128, 128)).toBe(null);
    expect(cellsInRect({ x0: 1, y0: 1, x1: 2, y1: 2 })).toHaveLength(4);
  });

  it('explains zone blocks from tile fields', () => {
    expect(zoneBlockReason(null)).toMatch(/outside/i);
    expect(zoneBlockReason({ terrain: 'water', road: null, roadAccess: true })).toMatch(/water/i);
    expect(zoneBlockReason({ terrain: 'grass', road: { type: 'street' }, roadAccess: true })).toMatch(/road/i);
    expect(zoneBlockReason({ terrain: 'grass', road: null, roadAccess: false })).toMatch(/no road/i);
    expect(zoneBlockReason({ terrain: 'grass', road: null, roadAccess: true })).toBe(null);
  });

  it('prefers sim error messages', () => {
    expect(errorText('WATER', 'Lake in the way')).toBe('Lake in the way');
    expect(errorText('WATER')).toMatch(/water/i);
  });
});

describe('store', () => {
  beforeEach(() => useGame.getState().reset());

  it('notification feed is newest-first, de-duplicated and capped', () => {
    let list = [];
    list = pushNotification(list, { id: 1, message: 'a' });
    list = pushNotification(list, { id: 2, message: 'b' });
    list = pushNotification(list, { id: 2, message: 'b again' });
    expect(list.map((n) => n.id)).toEqual([2, 1]);
    for (let i = 3; i < 100; i++) list = pushNotification(list, { id: i });
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list[0].id).toBe(99);
  });

  it('tool switching clears the cursor hint', () => {
    useGame.setState({ hint: { text: 'x' } });
    useGame.getState().setTool('road');
    expect(useGame.getState().tool).toBe('road');
    expect(useGame.getState().hint).toBe(null);
  });

  it('dismisses notifications', () => {
    const s = useGame.getState();
    s.addNotification({ id: 'a' });
    s.addNotification({ id: 'b' });
    useGame.getState().dismissNotification('a');
    expect(useGame.getState().notifications.map((n) => n.id)).toEqual(['b']);
  });
});

describe('format', () => {
  it('formats money and dates', () => {
    expect(formatMoney(50000)).toBe('$50,000');
    expect(formatMoney(-1234.6)).toBe('−$1,235');
    expect(formatSignedMoney(12)).toBe('+$12');
    expect(formatDate({ day: 1, month: 1, year: 1 })).toBe('1 Jan, Year 1');
  });
});
