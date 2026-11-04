import { useEffect, useRef } from 'react';
import { createSimulation } from '../../sim/index.js';

// Survey plate of the site a seed generates: real terrain from the sim, drawn
// as an isometric plan on a 2D canvas. Recomputed when the seed changes.
export function SitePlan({ seed, label }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const id = setTimeout(() => {
      let sim;
      try {
        sim = createSimulation({ seed: Number.isFinite(Number(seed)) && seed !== '' ? Number(seed) : String(seed), name: 'preview' });
      } catch {
        return;
      }
      const w = sim.getWorld();
      const tiles = sim.getTilesInRect(0, 0, w.width - 1, w.height - 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = cv.clientWidth || 520;
      const cssH = cv.clientHeight || 300;
      cv.width = cssW * dpr;
      cv.height = cssH * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const s = Math.min((cssW - 24) / w.width, (cssH - 24) / (w.height / 2) / 1.0) / 1.02;
      const hw = s / 2, hh = s / 4;
      const ox = cssW / 2, oy = (cssH - w.height * hh * 2) / 2;
      const P = (u, v) => [ox + (u - v) * hw, oy + (u + v) * hh];
      // slab
      ctx.fillStyle = '#2a3239';
      ctx.beginPath();
      ctx.moveTo(...P(0, w.height));
      ctx.lineTo(...P(w.width, w.height));
      ctx.lineTo(...P(w.width, 0));
      ctx.lineTo(P(w.width, 0)[0], P(w.width, 0)[1] + 8);
      ctx.lineTo(P(w.width, w.height)[0], P(w.width, w.height)[1] + 8);
      ctx.lineTo(P(0, w.height)[0], P(0, w.height)[1] + 8);
      ctx.fill();
      for (const t of tiles) {
        const water = t.terrain === 'water';
        const road = !!t.road;
        if (!water && !road) continue;
        ctx.fillStyle = road ? '#ff9f43' : '#3f6c7c';
        ctx.beginPath();
        ctx.moveTo(...P(t.x, t.y));
        ctx.lineTo(...P(t.x + 1, t.y));
        ctx.lineTo(...P(t.x + 1, t.y + 1));
        ctx.lineTo(...P(t.x, t.y + 1));
        ctx.closePath();
        ctx.fill();
      }
      // survey grid every chunk
      ctx.strokeStyle = 'rgba(127,178,214,0.28)';
      ctx.lineWidth = 1;
      for (let k = 0; k <= w.width; k += w.chunkSize) {
        ctx.beginPath();
        ctx.moveTo(...P(k, 0));
        ctx.lineTo(...P(k, w.height));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(...P(0, k));
        ctx.lineTo(...P(w.width, k));
        ctx.stroke();
      }
      // highway marker
      const o = w.outsideConnection;
      const [hx, hy] = P(o.x + 0.5, o.y + 0.5);
      ctx.strokeStyle = '#ff9f43';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - 10, hy - 10);
      ctx.lineTo(hx - 34, hy - 34);
      ctx.stroke();
      ctx.fillStyle = '#ebe7dd';
      ctx.font = '600 12px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Highway connection', hx - 36, hy - 38);
    }, 120);
    return () => clearTimeout(id);
  }, [seed]);

  return (
    <figure className="site-plan">
      <canvas ref={ref} aria-label={`Site plan for seed ${seed}`} role="img" />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
