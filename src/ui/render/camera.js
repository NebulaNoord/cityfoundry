// Camera math. Pure. A camera is { x, y, zoom } where (x, y) is the world-pixel
// point shown at the centre of the viewport.
//   screen = (world − cam) · zoom + viewport/2

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export function worldToScreen(cam, vw, vh, wx, wy) {
  return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
}

export function screenToWorld(cam, vw, vh, sx, sy) {
  return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
}

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Keep the camera centre inside the map bounds (world pixels). */
export function clampCamera(cam, bounds) {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, cam.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, cam.y)),
    zoom: clampZoom(cam.zoom),
  };
}

/**
 * Zoom by `factor` keeping the world point under screen pixel (sx, sy) fixed,
 * then clamp. Returns a new camera.
 */
export function zoomAt(cam, vw, vh, sx, sy, factor, bounds) {
  const zoom = clampZoom(cam.zoom * factor);
  const anchor = screenToWorld(cam, vw, vh, sx, sy);
  // After zooming, anchor must still map to (sx, sy):
  //   (anchor − cam') · zoom + v/2 = s  →  cam' = anchor − (s − v/2)/zoom
  const next = {
    x: anchor.x - (sx - vw / 2) / zoom,
    y: anchor.y - (sy - vh / 2) / zoom,
    zoom,
  };
  return bounds ? clampCamera(next, bounds) : next;
}

/** Pan by a screen-pixel delta (drag moves the world with the cursor). */
export function panByScreen(cam, dxScreen, dyScreen, bounds) {
  const next = { x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom, zoom: cam.zoom };
  return bounds ? clampCamera(next, bounds) : next;
}

/** World-pixel rectangle visible in the viewport. */
export function viewRect(cam, vw, vh) {
  const hw = vw / 2 / cam.zoom;
  const hh = vh / 2 / cam.zoom;
  return { minX: cam.x - hw, maxX: cam.x + hw, minY: cam.y - hh, maxY: cam.y + hh };
}
