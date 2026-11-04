// Tool definitions and pure helpers for tool interactions.

export const TOOLS = {
  inspect: { id: 'inspect', label: 'Inspect', short: 'Inspect', key: 'Q', hint: 'Click a tile to inspect it.', touchHint: 'Tap a tile to inspect. Drag to pan, pinch to zoom.' },
  road: { id: 'road', label: 'Road', short: 'Road', key: 'R', hint: 'Drag to lay road. Press R again to switch street / avenue.', touchHint: 'Drag to lay road. Two fingers pan and zoom.' },
  bulldoze: { id: 'bulldoze', label: 'Bulldoze', short: 'Bulldoze', key: 'B', hint: 'Click or drag a rectangle to demolish.', touchHint: 'Tap or drag a rectangle to demolish.' },
  zoneR: { id: 'zoneR', label: 'Residential', short: 'Homes', key: 'Z', zone: 'R', hint: 'Drag to zone. Needs a road within 4 tiles.', touchHint: 'Drag to zone. Needs a road within 4 tiles.' },
  zoneC: { id: 'zoneC', label: 'Commercial', short: 'Shops', key: 'X', zone: 'C', hint: 'Drag to zone. Needs a road within 4 tiles.', touchHint: 'Drag to zone. Needs a road within 4 tiles.' },
  zoneI: { id: 'zoneI', label: 'Industrial', short: 'Industry', key: 'C', zone: 'I', hint: 'Drag to zone. Needs a road within 4 tiles.', touchHint: 'Drag to zone. Needs a road within 4 tiles.' },
  dezone: { id: 'dezone', label: 'Dezone', short: 'Dezone', key: 'V', zone: null, hint: 'Drag to remove zoning.', touchHint: 'Drag to remove zoning.' },
};

export const TOOL_ORDER = ['inspect', 'road', 'zoneR', 'zoneC', 'zoneI', 'dezone', 'bulldoze'];

export const ROAD_TYPES = {
  street: { id: 'street', label: 'Street' },
  avenue: { id: 'avenue', label: 'Avenue' },
};

export function isZoneTool(tool) {
  return tool === 'zoneR' || tool === 'zoneC' || tool === 'zoneI' || tool === 'dezone';
}

/** Zone value for paintZone: 'R' | 'C' | 'I' | null (dezone). */
export function zoneForTool(tool) {
  return TOOLS[tool] && 'zone' in TOOLS[tool] ? TOOLS[tool].zone : undefined;
}

/** Map a keyboard key (event.key) to a tool id, or null. */
export function toolForKey(key) {
  const k = key.length === 1 ? key.toUpperCase() : key;
  for (const id of TOOL_ORDER) if (TOOLS[id].key === k) return id;
  return null;
}

/** Normalised inclusive rect from two tile corners, clamped to the map. */
export function normRect(a, b, width, height) {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(height - 1, Math.max(a.y, b.y));
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

export function cellsInRect(r) {
  const cells = [];
  if (!r) return cells;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) cells.push({ x, y });
  return cells;
}

/**
 * Why a tile can't take a zone brush, based only on tile fields the sim
 * exposes (terrain, road, roadAccess). Returns null when paintable.
 */
export function zoneBlockReason(tile) {
  if (!tile) return 'Outside the map';
  if (tile.terrain === 'water') return 'Water';
  if (tile.road) return 'Road';
  if (!tile.roadAccess) return 'No road within 4 tiles';
  return null;
}

export const ERROR_TEXT = {
  INSUFFICIENT_FUNDS: 'Not enough funds',
  BLOCKED: 'Blocked by a building',
  OUT_OF_BOUNDS: 'Outside the map',
  WATER: "Can't build on water",
  NO_ROAD_ACCESS: 'No road access',
  PROTECTED: 'The highway connection is protected',
  INVALID: 'Invalid placement',
};

export function errorText(code, message) {
  return message || ERROR_TEXT[code] || 'Not possible here';
}
