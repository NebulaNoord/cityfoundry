// Procedural building art. Each building is drawn deterministically from its
// id and position, so a rebuild of its chunk reproduces the same look.
// g = object Graphics (depth-sorted), sg = shadow Graphics (under objects).
import {
  P, box, boxShadow, gableRoof, southFaceRect, eastFaceRect, wireBox, rectPoly, shade, mix, hash2, LIGHT,
} from './draw.js';
import { WORLD, RES_WALLS, RES_ROOFS, COM_WALLS, COM_ACCENT, IND_WALLS, IND_ROOFS, GLASS, GLASS_LIT, ZONE } from './palette.js';

const DECAY = 0x6f6c66;
const BOARD = 0x4a3b2c;

function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

function decay(c, abandoned) {
  return abandoned ? shade(mix(c, DECAY, 0.55), 0.82) : c;
}

/** Lot ground under a building, drawn into the ground layer. */
export function drawLot(g, b, tileX, tileY) {
  const abandoned = b.state === 'abandoned';
  const x = tileX, y = tileY;
  let base;
  if (b.state === 'constructing') base = 0x8e8166; // bare earth
  else if (b.zone === 'R') base = WORLD.lotLawn;
  else if (b.zone === 'C') base = WORLD.lotPave;
  else base = WORLD.lotIndustrial;
  if (abandoned) base = mix(base, 0x7a6e58, 0.6);
  g.poly(rectPoly(x, y, x + 1, y + 1), true).fill(base);
  // parcel edge in the zone colour: keeps zoning legible under buildings
  g.poly(rectPoly(x + 0.04, y + 0.04, x + 0.96, y + 0.96), true).stroke({ width: 1, color: ZONE[b.zone], alpha: abandoned ? 0.25 : 0.55 });
  if (b.zone === 'R' && b.state === 'active') {
    // front path to the street side (south-east edge)
    g.poly(rectPoly(x + 0.46, y + 0.8, x + 0.56, y + 1), true).fill(0xc9c2ad);
  }
  if (b.zone === 'C' && b.state === 'active') {
    // painted parking bays at the front
    for (let k = 0; k < 3; k++) {
      const u = x + 0.2 + k * 0.22;
      g.moveTo(...P(u, y + 0.9)).lineTo(...P(u, y + 0.98));
    }
    g.stroke({ width: 0.8, color: 0xf3efe2, alpha: 0.7 });
  }
  if (abandoned) {
    for (let k = 0; k < 6; k++) {
      const u = x + 0.1 + hash2(b.id, k, 3) * 0.8;
      const v = y + 0.1 + hash2(b.id, k, 4) * 0.8;
      g.poly([...P(u - 0.04, v), ...P(u, v - 0.04), ...P(u + 0.04, v), ...P(u, v + 0.04)], true).fill({ color: 0x5f6b3c, alpha: 0.9 });
    }
  }
}

function tree(g, sg, u, v, s = 1) {
  const [x, y] = P(u, v);
  sg.ellipse(x + 5 * s, y + 1, 7 * s, 3 * s).fill({ color: 0x10140f, alpha: 0.22 });
  g.moveTo(x, y).lineTo(x, y - 6 * s).stroke({ width: 1.6 * s, color: 0x4b3a2a });
  g.circle(x, y - 10 * s, 6 * s).fill(0x4f6b38);
  g.circle(x - 1.5 * s, y - 11.5 * s, 4 * s).fill(0x638546);
}

// ---------------------------------------------------------------- residential
function house(g, sg, b, abandoned) {
  const r = (k) => hash2(b.id, b.x * 31 + b.y, k);
  const x = b.x, y = b.y;
  const twoStorey = r(1) > 0.6;
  const wide = r(2) > 0.5;
  const u0 = x + (wide ? 0.16 : 0.24), u1 = x + (wide ? 0.82 : 0.76);
  const v0 = y + (wide ? 0.26 : 0.18), v1 = y + (wide ? 0.78 : 0.82);
  const h = twoStorey ? 17 : 10;
  const rh = 7;
  const wall = decay(pick(RES_WALLS, r(3)), abandoned);
  const roof = decay(pick(RES_ROOFS, r(4)), abandoned);
  const alongU = (u1 - u0) >= (v1 - v0);

  if (r(5) > 0.35) tree(g, sg, x + 0.12, y + 0.14, abandoned ? 0.75 : 0.9);
  boxShadow(sg, u0, v0, u1, v1, h + rh * 0.6);
  box(g, u0, v0, u1, v1, 0, h, wall);
  // door + windows on the south (left) face
  const glass = abandoned ? BOARD : GLASS;
  const span = u1 - u0;
  southFaceRect(g, v1, u0 + span * 0.12, u0 + span * 0.26, 0, 6.5, abandoned ? BOARD : shade(roof, 0.8));
  southFaceRect(g, v1, u0 + span * 0.45, u0 + span * 0.7, 3, 7, glass);
  if (twoStorey) {
    southFaceRect(g, v1, u0 + span * 0.12, u0 + span * 0.32, 10, 14, glass);
    southFaceRect(g, v1, u0 + span * 0.5, u0 + span * 0.7, 10, 14, glass);
  }
  const vs = v1 - v0;
  eastFaceRect(g, u1, v0 + vs * 0.3, v0 + vs * 0.62, 3, 7, glass);
  if (twoStorey) eastFaceRect(g, u1, v0 + vs * 0.3, v0 + vs * 0.62, 10, 14, glass);
  gableRoof(g, u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.03, h, rh, roof, wall, alongU);
  if (abandoned) {
    // collapsed patch in the roof
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    g.poly([...P(mu - 0.06, mv + 0.02, h + rh * 0.6), ...P(mu + 0.08, mv, h + rh * 0.7), ...P(mu + 0.04, mv + 0.12, h + rh * 0.4)], true).fill(0x26221d);
  } else if (r(6) > 0.5) {
    const cu = alongU ? u0 + 0.12 : (u0 + u1) / 2 + 0.06;
    const cv = alongU ? (v0 + v1) / 2 - 0.05 : v0 + 0.1;
    box(g, cu, cv, cu + 0.07, cv + 0.07, h, h + rh + 3, 0x7d5546);
  }
}

// ----------------------------------------------------------------- commercial
function shop(g, sg, b, abandoned) {
  const r = (k) => hash2(b.id, b.x * 17 + b.y, k);
  const x = b.x, y = b.y;
  const tall = r(1) > 0.55;
  const u0 = x + 0.12, u1 = x + 0.88, v0 = y + 0.12, v1 = y + 0.84;
  const h = tall ? 24 : 15;
  const wall = decay(pick(COM_WALLS, r(2)), abandoned);
  const accent = decay(pick(COM_ACCENT, r(3)), abandoned);

  boxShadow(sg, u0, v0, u1, v1, h + 2);
  box(g, u0, v0, u1, v1, 0, h, wall);
  // storefront glazing, warm interior light (sodium accent) unless abandoned
  const front = abandoned ? BOARD : mix(GLASS, GLASS_LIT, 0.45);
  southFaceRect(g, v1, u0 + 0.04, u1 - 0.04, 1, 8, front);
  eastFaceRect(g, u1, v0 + 0.06, v1 - 0.04, 1, 8, front);
  if (!abandoned) {
    // mullions
    for (let k = 1; k < 5; k++) {
      const u = u0 + 0.04 + ((u1 - u0 - 0.08) * k) / 5;
      g.moveTo(...P(u, v1, 1)).lineTo(...P(u, v1, 8));
    }
    g.stroke({ width: 0.6, color: shade(wall, 0.7) });
  }
  // fascia sign band
  southFaceRect(g, v1, u0, u1, 8.5, 11, shade(accent, LIGHT.left));
  eastFaceRect(g, u1, v0, v1, 8.5, 11, shade(accent, LIGHT.right));
  if (tall) {
    for (let k = 0; k < 3; k++) {
      const ua = u0 + 0.06 + k * 0.24;
      southFaceRect(g, v1, ua, ua + 0.15, 14, 20, abandoned ? BOARD : GLASS);
    }
    for (let k = 0; k < 3; k++) {
      const va = v0 + 0.06 + k * 0.22;
      eastFaceRect(g, u1, va, va + 0.13, 14, 20, abandoned ? BOARD : GLASS);
    }
  }
  // parapet roof
  g.poly(rectPoly(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, h), true).fill(shade(wall, 0.78));
  if (!abandoned) box(g, u0 + 0.18, v0 + 0.16, u0 + 0.36, v0 + 0.32, h, h + 4, 0x9aa1a5);
}

// ----------------------------------------------------------------- industrial
function factory(g, sg, b, abandoned) {
  const r = (k) => hash2(b.id, b.x * 13 + b.y, k);
  const x = b.x, y = b.y;
  const u0 = x + 0.08, u1 = x + 0.9, v0 = y + 0.1, v1 = y + 0.9;
  const h = 13 + Math.floor(r(1) * 3) * 2;
  const wall = decay(pick(IND_WALLS, r(2)), abandoned);
  const roof = decay(pick(IND_ROOFS, r(3)), abandoned);
  const teeth = 3;
  const th = 6;

  boxShadow(sg, u0, v0, u1, v1, h + th);
  box(g, u0, v0, u1, v1, 0, h, wall);
  // corrugation lines on the east face
  for (let k = 1; k < 8; k++) {
    const v = v0 + ((v1 - v0) * k) / 8;
    g.moveTo(...P(u1, v, 0)).lineTo(...P(u1, v, h));
  }
  g.stroke({ width: 0.5, color: shade(wall, 0.55), alpha: 0.6 });
  // loading dock door on the south face
  southFaceRect(g, v1, u0 + 0.12, u0 + 0.36, 0, 8, abandoned ? BOARD : 0x3e4347);
  southFaceRect(g, v1, u0 + 0.5, u1 - 0.1, 7, 10, abandoned ? BOARD : GLASS);
  g.poly(rectPoly(u0, v0, u1, v1, h), true).fill(shade(roof, 0.9));

  // smokestack at the back corner, before the sawtooth so the roof occludes its base
  const sc = r(4) > 0.3;
  if (sc) {
    const su = u0 + 0.08, sv = v0 + 0.06;
    const sh = h + 26;
    boxShadow(sg, su, sv, su + 0.12, sv + 0.12, sh, 0.18);
    box(g, su, sv, su + 0.12, sv + 0.12, h, sh, abandoned ? 0x6a625a : 0x8f5a48);
    if (!abandoned) {
      southFaceRect(g, sv + 0.12, su, su + 0.12, sh - 6, sh - 3, 0xe9e2d2);
      eastFaceRect(g, su + 0.12, sv, sv + 0.12, sh - 6, sh - 3, 0xcfc8b8);
    }
  }
  // sawtooth roof: each tooth rises toward +v with a glazed vertical face
  const depth = (v1 - v0) / teeth;
  for (let k = 0; k < teeth; k++) {
    const va = v0 + depth * k, vb = va + depth;
    const ua = sc && k === 0 ? u0 + 0.24 : u0;
    g.poly([...P(ua, va, h), ...P(u1, va, h), ...P(u1, vb, h + th), ...P(ua, vb, h + th)], true).fill(shade(roof, 1.05));
    g.poly([...P(u1, va, h), ...P(u1, vb, h), ...P(u1, vb, h + th)], true).fill(shade(wall, LIGHT.right * 0.95));
    southFaceRect(g, vb, ua, u1, h, h + th, abandoned ? 0x3a3530 : 0x5d7f8f);
  }
  if (!abandoned && r(5) > 0.4) {
    // outdoor tank by the front-right corner
    const [cx, cy] = P(x + 0.92, y + 0.55);
    g.rect(cx - 4, cy - 12, 8, 12).fill(0xb9bdb9);
    g.ellipse(cx, cy - 12, 4, 2).fill(0xd8dbd6);
  }
}

// --------------------------------------------------------------- construction
function construction(g, sg, b) {
  const x = b.x, y = b.y;
  const p = Math.max(0.15, b.constructionProgress || 0);
  const target = b.zone === 'R' ? 12 : b.zone === 'C' ? 18 : 15;
  const ins = b.zone === 'I' ? 0.1 : 0.18;
  const u0 = x + ins, u1 = x + 1 - ins, v0 = y + ins, v1 = y + 1 - ins;
  box(g, u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, 0, 1.5, WORLD.concrete);
  const hh = target * p;
  boxShadow(sg, u0, v0, u1, v1, target, 0.12);
  box(g, u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, 1.5, hh, 0xa7a49b);
  wireBox(g, u0, v0, u1, v1, 0, target, WORLD.scaffold, 0.9, 0.95);
  // scaffold deck lines
  for (let z = 6; z < target; z += 6) {
    g.moveTo(...P(u0, v1, z)).lineTo(...P(u1, v1, z)).lineTo(...P(u1, v0, z));
  }
  g.stroke({ width: 0.7, color: WORLD.scaffold, alpha: 0.8 });
  // site barrier along the front edge
  for (let k = 0; k < 4; k++) {
    const u = x + 0.1 + k * 0.22;
    g.poly([...P(u, y + 0.97, 0), ...P(u + 0.12, y + 0.97, 0), ...P(u + 0.12, y + 0.97, 2.5), ...P(u, y + 0.97, 2.5)], true)
      .fill(k % 2 ? 0xf2f0e8 : 0xd8432f);
  }
}

export function drawBuilding(g, sg, b) {
  if (b.state === 'constructing') return construction(g, sg, b);
  const abandoned = b.state === 'abandoned';
  if (b.zone === 'R') return house(g, sg, b, abandoned);
  if (b.zone === 'C') return shop(g, sg, b, abandoned);
  return factory(g, sg, b, abandoned);
}
