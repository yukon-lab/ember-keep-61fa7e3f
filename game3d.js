// Ember Keep — one big 3D world. Walk the hero around, coins stack on his back, stop on cost pads to build/upgrade.
import * as THREE from './vendor/three.module.min.js';

const Q = new URLSearchParams(location.search);
const AUTO = Q.has('auto'), SIM = Q.has('sim');
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
const pick = a => a[Math.floor(Math.random() * a.length)];
const easeInOut = t => t * t * (3 - 2 * t);
const easeBack = t => { const c = 1.9; t = clamp(t, 0, 1); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function fmt(n) { n = Math.floor(n); if (n < 1000) return '' + n; const u = ['K', 'M', 'B', 'T']; let i = -1; while (n >= 1000 && i < 3) { n /= 1000; i++; } return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + u[i]; }
function seeded(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ================= world layout =================
const MAPW = 600, MAPH = 380;
// the home valley was drawn on a small grid: wx/wz place it, 1.7x wider, in the big world
const wx = x => 250 + (x - 7.5) * 1.7, wz = z => 190 + (z - 24) * 1.7;
const KEEP = { x: 250, z: 190 };
const PATHS = [
  { pts: [[96, 8], [66, 9.5], [50, 15], [38, 19.5], [26, 22.2], [12, 24]], from: 1 },
  { pts: [[96, 40], [66, 38.5], [50, 33], [38, 28.5], [26, 25.8], [12, 24]], from: 2 },
  { pts: [[51, -10], [49, 5], [50, 15], [38, 19.5], [26, 22.2], [12, 24]], from: 6 },
  { pts: [[51, 58], [49, 43], [50, 33], [38, 28.5], [26, 25.8], [12, 24]], from: 10 },
];
for (const p of PATHS) {
  p.pts = p.pts.map(q => [wx(q[0]), wz(q[1])]);
  p.cum = [0];
  for (let i = 1; i < p.pts.length; i++) p.cum.push(p.cum[i - 1] + dist(p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]));
  p.len = p.cum[p.cum.length - 1]; p.walls = [];
}
function pathPos(p, s) {
  s = clamp(s, 0, p.len);
  let i = 1; while (i < p.pts.length - 1 && p.cum[i] < s) i++;
  const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1], t = seg ? (s - p.cum[i - 1]) / seg : 0;
  return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
function projS(p, x, z) {
  let best = 1e9, bs = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1], b = p.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1), d = dist(x, z, a[0] + dx * t, a[1] + dz * t);
    if (d < best) { best = d; bs = p.cum[i - 1] + Math.sqrt(L2) * t; }
  }
  return { s: bs, d: best };
}
// enemy castles: one at the far end of each road. Enemies march out of the gate. Capture one and that road goes quiet.
const FORTS = [
  { id: 'c0', fi: 0, x: wx(79), z: wz(9), unlock: 5, pw: 5, sz: 1, r: 'home', name: 'EAST CASTLE' },
  { id: 'c1', fi: 1, x: wx(79), z: wz(39), unlock: 9, pw: 9, sz: 1, r: 'home', name: 'SOUTH-EAST CASTLE' },
  { id: 'c2', fi: 2, x: wx(49), z: wz(2), unlock: 13, pw: 13, sz: 1, r: 'home', name: 'NORTH CASTLE' },
  { id: 'c3', fi: 3, x: wx(49), z: wz(46), unlock: 17, pw: 17, sz: 1, r: 'home', name: 'SOUTH CASTLE' },
];
PATHS.forEach((p, i) => { const f = FORTS[i]; f.path = p; p.start = projS(p, f.x, f.z).s + 4.5; });
// the wider world: walk there and take these castles yourself
const REALMS = {
  home: { name: 'HOME VALE', sub: 'Your land. Waves only come while you are here.', pay: '' },
  forest: { name: 'DARK FOREST', sub: 'Tall pines and plenty of wood', pay: 'wood' },
  desert: { name: 'SAND WASTES', sub: 'Rich in gold', pay: 'coins' },
  frost: { name: 'FROST PEAKS', sub: 'Cold, with plenty of stone', pay: 'stone' },
  fire: { name: 'FIRE LANDS', sub: 'The Emperor waits here', pay: 'troops' },
};
const realmAt = (x, z) => x > 440 ? 'frost' : x < 170 ? 'fire' : z < 112 ? 'forest' : z > 268 ? 'desert' : 'home';
const LANDS = [
  { id: 'f1', name: 'PINEWATCH', x: 215, z: 85, pw: 12 }, { id: 'f3', name: 'MOSSFORD', x: 345, z: 85, pw: 15 }, { id: 'f2', name: 'OAK HOLLOW', x: 190, z: 40, pw: 18 }, { id: 'fc', name: 'FOREST CAPITAL', x: 290, z: 35, pw: 24, cap: true },
  { id: 'd1', name: 'DUNE GATE', x: 215, z: 295, pw: 20 }, { id: 'd3', name: 'SUNSPIRE', x: 345, z: 295, pw: 23 }, { id: 'd2', name: 'RED OASIS', x: 190, z: 340, pw: 26 }, { id: 'dc', name: 'DESERT CAPITAL', x: 290, z: 345, pw: 32, cap: true },
  { id: 'i1', name: 'COLDWATER', x: 475, z: 125, pw: 28 }, { id: 'i3', name: 'WHITECLIFF', x: 475, z: 255, pw: 31 }, { id: 'i2', name: 'ICE PASS', x: 545, z: 80, pw: 34 }, { id: 'ic', name: 'FROST CAPITAL', x: 560, z: 190, pw: 40, cap: true },
  { id: 'x1', name: 'ASH FIELDS', x: 120, z: 125, pw: 38 }, { id: 'x2', name: 'LAVA BAY', x: 120, z: 255, pw: 41 }, { id: 'x3', name: 'EMBER RIFT', x: 75, z: 190, pw: 44 }, { id: 'xc', name: "EMPEROR'S THRONE", x: 35, z: 190, pw: 55, cap: true },
];
for (const c of LANDS) { c.r = realmAt(c.x, c.z); c.sz = c.cap ? 1.45 : 1.1; }
const CASTLES = [...FORTS, ...LANDS];
const ROADS = [
  [[wx(49), wz(2)], [345, 85], [290, 35]], [[345, 85], [215, 85], [190, 40]], [[215, 85], [120, 125]],
  [[wx(49), wz(46)], [345, 295], [290, 345]], [[345, 295], [215, 295], [190, 340]], [[215, 295], [120, 255]],
  [[wx(79), wz(9)], [475, 125], [545, 80], [560, 190]], [[wx(79), wz(39)], [475, 255], [560, 190]],
  [[250, 190], [75, 190], [35, 190]], [[75, 190], [120, 125]], [[75, 190], [120, 255]],
];
// a coarse grid: is this spot on a road? (roads make you faster; scenery stays off them)
const ROADGRID = new Uint8Array(300 * 190), roadAt = (x, z) => ROADGRID[clamp(Math.floor(z / 2), 0, 189) * 300 + clamp(Math.floor(x / 2), 0, 299)] === 1;
for (const pts of [...PATHS.map(p => p.pts), ...ROADS]) for (let i = 1; i < pts.length; i++) {
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.ceil(dist(ax, az, bx, bz));
  for (let k = 0; k <= n; k++) { const x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n); for (let dz = -3; dz <= 3; dz += 2) for (let dx = -3; dx <= 3; dx += 2) { const cx = Math.floor((x + dx) / 2), cz = Math.floor((z + dz) / 2); if (cx >= 0 && cx < 300 && cz >= 0 && cz < 190) ROADGRID[cz * 300 + cx] = 1; } }
}
const BANK_DEP = { x: wx(4.5), z: wz(43) }, BANK_WD = { x: wx(13.5), z: wz(43) };
const INV_IN = { x: wx(13.5), z: wz(5) }, INV_OUT = { x: wx(22.5), z: wz(5) };
const TRAIN_Z = { x: wx(28), z: wz(40) };
// trees and rocks to gather from. The first four are close: workers use those.
const NODES = [
  { k: 'wood', x: wx(27), z: wz(5) }, { k: 'stone', x: wx(4), z: wz(6) }, { k: 'wood', x: wx(27), z: wz(44) }, { k: 'stone', x: wx(38), z: wz(3) },
  { k: 'stone', x: wx(38.5), z: wz(46) }, { k: 'wood', x: wx(64), z: wz(18) }, { k: 'stone', x: wx(64), z: wz(30) },
  { k: 'wood', x: 255, z: 70, rich: true }, { k: 'wood', x: 150, z: 80, rich: true }, { k: 'wood', x: 330, z: 40, rich: true },
  { k: 'stone', x: 510, z: 130, rich: true }, { k: 'stone', x: 520, z: 250, rich: true }, { k: 'stone', x: 80, z: 120, rich: true },
  { k: 'wood', x: 255, z: 320, rich: true }, { k: 'stone', x: 150, z: 310, rich: true },
];
const SPOTS = [...CASTLES.map(f => ({ x: f.x, z: f.z, r: 9 * f.sz })), { ...TRAIN_Z, r: 3 }, { ...BANK_DEP, r: 3 }, { ...BANK_WD, r: 3 }, { ...INV_IN, r: 3 }, { ...INV_OUT, r: 3 }, ...NODES.map(n => ({ x: n.x, z: n.z, r: 4 }))];
const nearPath = (x, z, m) => PATHS.some(p => projS(p, x, z).d < m);

const TYPES = {
  keep:     { name: 'KEEP',     base: 30, grow: 1.4,  max: 12, col: '#5aa9ff' },
  archer:   { name: 'TOWER',    base: 5,  grow: 1.5,  max: 8,  col: '#7ee081' },
  wall:     { name: 'WALL',     base: 10, grow: 1.5,  max: 8,  col: '#d9a35b' },
  sword:    { name: 'SWORD',    base: 8,  grow: 1.32, max: 15, col: '#ff8a3d' },
  armor:    { name: 'ARMOR',    base: 12, grow: 1.32, max: 15, col: '#9fb4d8' },
  boots:    { name: 'BOOTS',    base: 15, grow: 1.4,  max: 10, col: '#62e0c6' },
  recruit:  { name: 'ARCHERS',  base: 15, grow: 1.4,  max: 10, col: '#62c6ff' },
  cannon:   { name: 'CANNON',   base: 30, grow: 1.5,  max: 8,  col: '#ff6b6b' },
  ballista: { name: 'BALLISTA', base: 40, grow: 1.5,  max: 8,  col: '#ffb13d' },
  mine:     { name: 'GOLD MINE', base: 25, grow: 1.6, max: 6,  col: '#ffd23f' },
  barracks: { name: 'BARRACKS', base: 40, grow: 1.5,  max: 8,  col: '#8ab4ff' },
  mage:     { name: 'STORM',    base: 80, grow: 1.5,  max: 8,  col: '#b99cff' },
  bank:     { name: 'BANK',     base: 20, grow: 1.6,  max: 8,  col: '#ffd23f' },
  market:   { name: 'MARKET',   base: 60, grow: 1.6,  max: 10, col: '#b99cff' },
  camp:     { name: 'WORKERS',  base: 25, grow: 1.5,  max: 10, col: '#e8c07a' },
  lumber:   { name: 'LUMBER MILL', base: 40, grow: 1.5, max: 6, col: '#8fd37a' },
  quarry:   { name: 'QUARRY',   base: 40, grow: 1.5,  max: 6,  col: '#c9c2b6' },
};
const DEFS = [
  { id: 'keep', type: 'keep', x: 7.5, z: 24, unlock: 0 },
  { id: 't1', type: 'archer', x: 21, z: 18.3, unlock: 0 },
  { id: 'sword', type: 'sword', x: 6, z: 15, unlock: 0 },
  { id: 't2', type: 'archer', x: 21, z: 29.8, unlock: 1 },
  { id: 'w1', type: 'wall', x: 38, z: 19.5, unlock: 1 },
  { id: 'w2', type: 'wall', x: 38, z: 28.5, unlock: 2 },
  { id: 'recruit', type: 'recruit', x: 12, z: 35, unlock: 1 },
  { id: 'bank', type: 'bank', x: 9, z: 43, unlock: 1, ux: 9, uz: 46.2 },
  { id: 'armor', type: 'armor', x: 12, z: 13.5, unlock: 2 },
  { id: 'c1', type: 'cannon', x: 31.5, z: 24.1, unlock: 2 },
  { id: 'mine', type: 'mine', x: 3.5, z: 34, unlock: 3 },
  { id: 't3', type: 'archer', x: 44, z: 11.5, unlock: 3 },
  { id: 't4', type: 'archer', x: 44, z: 36.5, unlock: 3 },
  { id: 'b1', type: 'ballista', x: 29, z: 14, unlock: 4 },
  { id: 'boots', type: 'boots', x: 17.5, z: 12.5, unlock: 4 },
  { id: 'bk', type: 'barracks', x: 21, z: 38.5, unlock: 4 },
  { id: 'm1', type: 'mage', x: 57, z: 24, unlock: 5 },
  { id: 'b2', type: 'ballista', x: 29, z: 34.5, unlock: 6 },
  { id: 't5', type: 'archer', x: 60, z: 4, unlock: 6 },
  { id: 't6', type: 'archer', x: 60, z: 44, unlock: 6 },
  { id: 'w3', type: 'wall', x: 66, z: 9.5, unlock: 7 },
  { id: 'w4', type: 'wall', x: 66, z: 38.5, unlock: 7 },
  { id: 'c2', type: 'cannon', x: 46.5, z: 24, unlock: 7 },
  { id: 'm2', type: 'mage', x: 34, z: 8, unlock: 9 },
  { id: 'c3', type: 'cannon', x: 34, z: 40, unlock: 11 },
  { id: 't7', type: 'archer', x: 72, z: 24, unlock: 12 },
  { id: 'market', type: 'market', x: 18, z: 5, unlock: 3, ux: 18, uz: 9.2 },
  { id: 'camp', type: 'camp', x: 14.5, z: 29.5, unlock: 2, ux: 16, uz: 33 },
  // towns: these open around a castle once you take it
  { id: 'e_bk', type: 'barracks', x: 79, z: 17, fort: 0, unlock: 0 }, { id: 'e_mine', type: 'mine', x: 72, z: 16, fort: 0, unlock: 0 }, { id: 'e_yard', type: 'lumber', x: 73, z: 2.6, fort: 0, unlock: 0, ux: 77, uz: 2.6 },
  { id: 's_bk', type: 'barracks', x: 79, z: 31, fort: 1, unlock: 0 }, { id: 's_mine', type: 'mine', x: 72, z: 32, fort: 1, unlock: 0 }, { id: 's_yard', type: 'quarry', x: 73, z: 45.4, fort: 1, unlock: 0, ux: 77, uz: 45.4 },
  { id: 'n_bk', type: 'barracks', x: 42.5, z: 5.5, fort: 2, unlock: 0, ux: 42.5, uz: 2 }, { id: 'n_mine', type: 'mine', x: 56, z: 7, fort: 2, unlock: 0, ux: 56, uz: 3 }, { id: 'n_yard', type: 'lumber', x: 56, z: 18, fort: 2, unlock: 0, ux: 60, uz: 18 },
  { id: 'd_bk', type: 'barracks', x: 42.5, z: 42.5, fort: 3, unlock: 0, ux: 44, uz: 46 }, { id: 'd_mine', type: 'mine', x: 56, z: 41, fort: 3, unlock: 0, ux: 56, uz: 45 }, { id: 'd_yard', type: 'quarry', x: 56, z: 30, fort: 3, unlock: 0, ux: 60, uz: 30 },
];
for (const d of DEFS) { d.x = wx(d.x); d.z = wz(d.z); if (d.ux !== undefined) { d.ux = wx(d.ux); d.uz = wz(d.uz); } }
// every land you take opens a town too
for (const c of LANDS) {
  const yard = { forest: 'lumber', desert: 'mine', frost: 'quarry', fire: 'mine' }[c.r], gap = 15 * c.sz;
  const shore = c.x < 50; // the throne sits by the sea: both buildings go inland
  DEFS.push({ id: 'l_' + c.id + '_a', type: 'barracks', x: shore ? c.x + gap : c.x - gap, z: shore ? c.z - 16 : c.z + 10, land: c.id, unlock: 0 }, { id: 'l_' + c.id + '_b', type: yard, x: c.x + gap, z: shore ? c.z + 16 : c.z + 10, land: c.id, unlock: 0 });
}
const padOpen = p => p.land ? G.world[p.land] > 0 : p.fort !== undefined ? G.cap[p.fort] : p.unlock <= G.cleared;
// walls block every path through their spot; their upgrade pad sits past the wall's end
for (const d of DEFS) {
  if (d.type === 'wall') {
    let ang = 0;
    for (const p of PATHS) { const pr = projS(p, d.x, d.z); if (pr.d < 0.5) { p.walls.push({ id: d.id, s: pr.s }); ang = pathPos(p, pr.s).ang; } }
    d.rot = ang; const px = -Math.sin(ang), pz = Math.cos(ang);
    const side = pz > 0 ? 1 : -1; d.ux = d.x + px * 5.2 * side; d.uz = d.z + pz * 5.2 * side;
  } else if (d.type === 'keep') { d.ux = KEEP.x + 1; d.uz = KEEP.z + 8; }
  else if (d.ux !== undefined) continue;
  else {
    let best = null, bd = -1;
    for (const [ox, oz] of [[0, 3.4], [3.4, 0], [-3.4, 0], [0, -3.4], [2.6, 2.6], [-2.6, 2.6]]) {
      const x = d.x + ox, z = d.z + oz; let m = 1e9; for (const p of PATHS) m = Math.min(m, projS(p, x, z).d);
      if (m > 3.3) { best = [x, z]; break; } if (m > bd) { bd = m; best = [x, z]; }
    }
    d.ux = best[0]; d.uz = best[1];
  }
}
for (const p of PATHS) p.walls.sort((a, b) => a.s - b.s);

const ETYPES = {
  raider: { hp: 22,   spd: 3.3, dmg: 6,  coin: 2,  sc: 1.0,  body: '#d93a2b', helm: '#7a1d16', plume: '#ff3b2f', weapon: '#c9ccd3' },
  runner: { hp: 13,   spd: 5.2, dmg: 4,  coin: 1,  sc: 0.85, body: '#ff6a3d', helm: '#a83218', plume: '#ffb13d', weapon: '#c9ccd3' },
  shield: { hp: 58,   spd: 2.8, dmg: 8,  coin: 3,  sc: 1.05, body: '#c42f25', helm: '#5b6270', plume: '#ff3b2f', weapon: '#c9ccd3', shield: '#7a5228', armor: 0.5 },
  archer: { hp: 20,   spd: 3.0, dmg: 7,  coin: 2,  sc: 0.95, body: '#b8362b', helm: '#5e1414', plume: '#3a0b0b', weapon: '#7a4a22', ranged: 7.5 },
  brute:  { hp: 240,  spd: 2.2, dmg: 26, coin: 9,  sc: 1.7,  body: '#a3241f', helm: '#3a3f48', plume: '#f1e3c2', weapon: '#6b4a2a' },
  boss:   { hp: 1700, spd: 1.5, dmg: 55, coin: 70, sc: 3.0,  body: '#7e1424', helm: '#ffcc33', plume: '#ffcc33', weapon: '#c9ccd3', shield: '#3a2a20' },
  imp:    { hp: 150,  spd: 5.5, dmg: 0,  coin: 30, sc: 0.8,  body: '#ffcf3a', helm: '#c98a00', plume: '#fff3a8', weapon: '#ffcf3a' },
  fort:   { hp: 500,  spd: 0,   dmg: 9,  coin: 60, sc: 5.5,  body: '#5a5560', helm: '#3a3640', plume: '#a3241f', weapon: '#3a3640', ranged: 11 },
};
const ENAMES = { raider: 'raiders', runner: 'runners', shield: 'shields', archer: 'archers', brute: 'brutes', boss: 'WARLORD', imp: 'gnome' };

// ================= renderer & scene =================
const glc = document.getElementById('gl'), uic = document.getElementById('ui'), ctx = uic.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shot') });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9ed7f5');
scene.fog = new THREE.Fog('#9ed7f5', 100, 210);
const camera = new THREE.PerspectiveCamera(40, 1, 4, 420);
scene.add(new THREE.HemisphereLight('#fffaf0', '#4f7a35', 1.35));
const sun = new THREE.DirectionalLight('#fff0d0', 2.3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 52, bottom: -52, near: 1, far: 220 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const MATS = {};
const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MATS[k] || (MATS[k] = new THREE.MeshLambertMaterial({ color: c, ...o })); };
const BOX = new THREE.BoxGeometry(1, 1, 1);
function mesh(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, opt) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, opt) : color);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; return m;
}
const box = (c, x, y, z, sx, sy, sz) => mesh(BOX, c, x, y, z, sx, sy, sz);
const GEO = {
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8), cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone4: new THREE.ConeGeometry(0.5, 1, 4), cone8: new THREE.ConeGeometry(0.5, 1, 8), cone6: new THREE.ConeGeometry(0.5, 1, 6),
  sph: new THREE.IcosahedronGeometry(0.5, 1), rock: new THREE.DodecahedronGeometry(0.5, 0), prism: new THREE.CylinderGeometry(0.5, 0.5, 1, 3),
};
GEO.cone4.rotateY(Math.PI / 4);

// ---------- ground, roads, scenery ----------
const nHash = (x, z) => { const t = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return t - Math.floor(t); };
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return lerp(lerp(nHash(ix, iz), nHash(ix + 1, iz), u), lerp(nHash(ix, iz + 1), nHash(ix + 1, iz + 1), u), v); }
const fbm = (x, z) => vnoise(x, z) * 0.65 + vnoise(x * 2.3 + 9, z * 2.3 + 4) * 0.35;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const edgeOf = (x, z) => { const R = 95, qx = Math.abs(x - MAPW / 2) - (MAPW / 2 - R), qz = Math.abs(z - MAPH / 2) - (MAPH / 2 - R); return R - (Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0)); };
const clearAt = (x, z, m = 0) => !roadAt(x, z) && !DEFS.some(df => dist(x, z, df.x, df.z) < 5 + m || dist(x, z, df.ux, df.uz) < 3.6 + m) && dist(x, z, KEEP.x, KEEP.z) > 10 + m && !SPOTS.some(q => dist(x, z, q.x, q.z) < q.r + m);
const MINI = document.createElement('canvas'), MK = 2, MX0 = -60, MZ0 = -60; MINI.width = 720 * MK; MINI.height = 500 * MK;
(function buildWorld() {
  const R = seeded(11), hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const C = { g1: hex('#5fae3e'), g2: hex('#7fc850'), f1: hex('#2c7443'), f2: hex('#3f8f52'), d1: hex('#dcbf78'), d2: hex('#efd798'), i1: hex('#cfe3ee'), i2: hex('#f2f8fb'), a1: hex('#4f3a36'), a2: hex('#7a4a38'), lava: hex('#ff6a2a'), sand: hex('#ead9a3'), sea: hex('#3d9bd1'), sea2: hex('#5cb6e0') };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const g2 = MINI.getContext('2d'), img = g2.createImageData(MINI.width, MINI.height), D = img.data;
  for (let py = 0, o = 0; py < MINI.height; py++) for (let px = 0; px < MINI.width; px++, o += 4) {
    const x = px / MK + MX0, z = py / MK + MZ0, n = fbm(x * 0.03, z * 0.03), n2 = fbm(x * 0.012 + 40, z * 0.012 + 7), wob = (n2 - 0.5) * 60, grain = (nHash(px, py) - 0.5) * 7;
    let c = mix(C.g1, C.g2, sstep(0.3, 0.7, n));
    c = mix(c, mix(C.f1, C.f2, n), sstep(124, 100, z + wob));
    c = mix(c, mix(C.d1, C.d2, sstep(0.35, 0.65, vnoise(x * 0.05 + z * 0.12, z * 0.02))), sstep(256, 280, z + wob));
    c = mix(c, mix(C.i1, C.i2, n), sstep(428, 452, x + wob));
    if (x + wob < 182) { let a = mix(C.a1, C.a2, n); const crack = fbm(x * 0.07 + 3, z * 0.07 + 8); if (crack > 0.62 && crack < 0.68) a = mix(a, C.lava, 0.85); c = mix(c, a, sstep(182, 158, x + wob)); }
    const e = edgeOf(x, z) + (n2 - 0.5) * 34;
    c = mix(c, C.sand, sstep(15, 8, e));
    if (e < 6) { const deep = sstep(-6, -34, e); c = mix(mix(mix(C.sea, C.sea2, sstep(0.4, 0.7, n)), C.sea, deep), C.sand, sstep(2, 6, e) * 0.6); }
    const gr2 = e < -30 ? 0 : grain;
    D[o] = c[0] + gr2; D[o + 1] = c[1] + gr2; D[o + 2] = c[2] + gr2; D[o + 3] = 255;
  }
  g2.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(MINI); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(720, 500); geo.rotateX(-Math.PI / 2); geo.translate(MX0 + 360, 0, MZ0 + 250);
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex })); ground.receiveShadow = true; scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#3d9bd1' })); sea.position.set(MAPW / 2, -0.4, MAPH / 2); scene.add(sea);
  // roads: flat ribbons with round joints
  const ribbon = (lines, w, y, color, off) => {
    const v = [], add = (ax, az, bx, bz, cx, cz) => v.push(ax, y, az, bx, y, bz, cx, y, cz);
    for (const pts of lines) for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i]; for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, b = (k + 1) / 14 * TAU; add(x, z, x + Math.cos(b) * w / 2, z + Math.sin(b) * w / 2, x + Math.cos(a) * w / 2, z + Math.sin(a) * w / 2); }
      if (!i) continue; const [px, pz] = pts[i - 1], d = dist(px, pz, x, z), nx = -(z - pz) / d * w / 2, nz = (x - px) / d * w / 2;
      add(px + nx, pz + nz, x + nx, z + nz, x - nx, z - nz); add(px + nx, pz + nz, x - nx, z - nz, px - nx, pz - nz);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off })); m.receiveShadow = true; scene.add(m);
  };
  const lines = [...PATHS.map(p => p.pts), ...ROADS];
  ribbon(lines, 5.6, 0.04, '#b08a55', -2); ribbon(lines, 4.7, 0.05, '#d8b47a', -4);
  g2.lineCap = g2.lineJoin = 'round'; g2.strokeStyle = '#c9a56d'; g2.lineWidth = 4 * MK; g2.beginPath(); for (const pts of lines) pts.forEach((q, i) => { const X = (q[0] - MX0) * MK, Y = (q[1] - MZ0) * MK; if (i) g2.lineTo(X, Y); else g2.moveTo(X, Y); }); g2.stroke();
  // scenery, in chunks so what you can't see isn't drawn
  const buckets = new Map(), d = new THREE.Object3D();
  const put = (g, color, x, y, z, sx, sy, sz, ry = 0, shadow = true) => {
    const key = g + '|' + color + '|' + Math.floor(x / 80) + '|' + Math.floor(z / 80) + '|' + shadow; let b = buckets.get(key); if (!b) buckets.set(key, b = { g, color, shadow, list: [] });
    d.position.set(x, y, z); d.scale.set(sx, sy, sz); d.rotation.set(0, ry, 0); d.updateMatrix(); b.list.push(d.matrix.clone());
  };
  const tree = (x, z, s, a, b) => { const r = R() * 6; put('cyl8', '#7a4a2a', x, 0.5 * s, z, 0.35 * s, s, 0.35 * s, r); put('cone6', a, x, 1.9 * s, z, 2.1 * s, 2.4 * s, 2.1 * s, r); put('cone6', b, x, 3 * s, z, 1.5 * s, 1.9 * s, 1.5 * s, r); };
  const pine = (x, z, s) => { const r = R() * 6; put('cyl8', '#5a3a22', x, 0.6 * s, z, 0.3 * s, 1.2 * s, 0.3 * s, r); for (let i = 0; i < 3; i++) put('cone6', i % 2 ? '#1f6238' : '#2a7a48', x, (1.9 + i * 1.25) * s, z, (2.5 - i * 0.6) * s, 2.2 * s, (2.5 - i * 0.6) * s, r); };
  const cactus = (x, z, s) => { put('cyl8', '#4f9a4a', x, 1.1 * s, z, 0.55 * s, 2.2 * s, 0.55 * s); put('cyl8', '#4f9a4a', x + 0.55 * s, 1.3 * s, z, 0.3 * s, 1 * s, 0.3 * s); put('cyl8', '#4f9a4a', x - 0.5 * s, 1.6 * s, z, 0.3 * s, 0.9 * s, 0.3 * s); };
  const spike = (x, z, s) => { put('cone4', '#bfe6f5', x, 1.5 * s, z, 1.3 * s, 3 * s, 1.3 * s, R() * 3); put('cone4', '#e6f6fb', x + 0.8 * s, 0.8 * s, z + 0.5 * s, 0.8 * s, 1.6 * s, 0.8 * s, R() * 3); };
  const snowpine = (x, z, s) => { const r = R() * 6; put('cyl8', '#5a3a22', x, 0.6 * s, z, 0.3 * s, 1.2 * s, 0.3 * s, r); put('cone6', '#6f9aa0', x, 2 * s, z, 2.3 * s, 2.5 * s, 2.3 * s, r); put('cone6', '#f2f8fb', x, 3.2 * s, z, 1.5 * s, 1.9 * s, 1.5 * s, r); };
  const dead = (x, z, s) => { put('cyl8', '#2e2422', x, 1.2 * s, z, 0.3 * s, 2.4 * s, 0.3 * s); put('cyl8', '#2e2422', x + 0.4 * s, 2 * s, z, 0.14 * s, 1 * s, 0.14 * s); };
  const COLORS = { home: '#a9a49b', forest: '#7f8a7c', desert: '#c9a262', frost: '#dfeaf0', fire: '#3a2c2a' };
  let items = 0;
  for (let i = 0; i < 40000 && items < 3400; i++) {
    const x = R() * MAPW, z = R() * MAPH; if (edgeOf(x, z) < 14) continue; const r = realmAt(x, z), n = fbm(x * 0.04 + 5, z * 0.04 + 2), kind = R();
    if (kind < 0.12) { if (!clearAt(x, z, -2)) continue; const s = 0.4 + R() * 1.1; put('rock', COLORS[r], x, 0.2 * s, z, s, s * 0.8, s, R() * 3, s > 0.9); items++; continue; }
    const s = 0.85 + R() * 0.8;
    if (r === 'home') { if (n < 0.56 || !clearAt(x, z, 1.5)) continue; tree(x, z, s, '#2f7d3a', '#3f9a48'); }
    else if (r === 'forest') { if (n < 0.28 || !clearAt(x, z, 1.5)) continue; pine(x, z, s * 1.15); }
    else if (r === 'desert') { if (n < 0.5 || !clearAt(x, z, 1)) continue; cactus(x, z, s); }
    else if (r === 'frost') { if (n < 0.42 || !clearAt(x, z, 1.5)) continue; if (R() < 0.45) spike(x, z, s); else snowpine(x, z, s); }
    else { if (n < 0.5 || !clearAt(x, z, 1)) continue; dead(x, z, s); }
    items++;
  }
  // mountains and volcanoes out in the wild
  for (let i = 0, m = 0; i < 4000 && m < 75; i++) {
    const x = R() * MAPW, z = R() * MAPH, r = realmAt(x, z); if (r === 'home' || edgeOf(x, z) < 22) continue;
    const S = 9 + R() * 11; let ok = clearAt(x, z, S * 0.9); for (let a = 0; ok && a < 8; a++) if (roadAt(x + Math.cos(a) * S, z + Math.sin(a) * S)) ok = false; if (!ok) continue;
    if (r === 'fire') { put('cone6', '#3b2b28', x, S * 0.5, z, S * 1.5, S, S * 1.5, R() * 3, false); put('cone6', '#ff6a2a', x, S * 0.93, z, S * 0.3, S * 0.16, S * 0.3, 0, false); }
    else { const base = r === 'frost' ? '#8fa8b8' : r === 'desert' ? '#b98f55' : '#5f7a60', cap = r === 'desert' ? '#d4ac6c' : '#f4f8fa'; put('cone6', base, x, S * 0.5, z, S * 1.5, S, S * 1.5, R() * 3, false); put('cone6', cap, x, S * 0.8, z, S * 0.62, S * 0.42, S * 0.62, 0, false); }
    m++;
  }
  // flowers near home, pebbles on the home roads
  const fl = ['#fff3a8', '#ffffff', '#ff9ec7', '#c7a8ff', '#ffd23f'];
  for (let i = 0, m = 0; i < 2600 && m < 500; i++) { const x = KEEP.x - 70 + R() * 230, z = KEEP.z - 80 + R() * 160; if (realmAt(x, z) !== 'home' || !clearAt(x, z, -3)) continue; put('sph', fl[Math.floor(R() * 5)], x, 0.1, z, 0.2, 0.2, 0.2, 0, false); m++; }
  for (const p of PATHS) for (let i = 0; i < 70; i++) { const q = pathPos(p, R() * p.len), o = (R() - 0.5) * 3.6; put('rock', '#c19a62', q.x - Math.sin(q.ang) * o, 0.06, q.z + Math.cos(q.ang) * o, 0.2, 0.2, 0.2, R() * 3, false); }
  for (const b of buckets.values()) { const m = new THREE.InstancedMesh(GEO[b.g], mat(b.color), b.list.length); b.list.forEach((q, i) => m.setMatrixAt(i, q)); m.castShadow = b.shadow; m.receiveShadow = true; scene.add(m); }
})();
// clouds cover what you have not walked to yet
const SEEN_W = 24, SEEN_H = 17, SEEN_C = 30;
const cloudMesh = new THREE.InstancedMesh(GEO.sph, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#5f6c78' }), SEEN_W * SEEN_H * 3); cloudMesh.frustumCulled = false; scene.add(cloudMesh);
const cellOf = (x, z) => clamp(Math.floor((z + 60) / SEEN_C), 0, SEEN_H - 1) * SEEN_W + clamp(Math.floor((x + 60) / SEEN_C), 0, SEEN_W - 1);
function setCloud(i, on) {
  const cx = (i % SEEN_W) * SEEN_C - 60 + 15, cz = Math.floor(i / SEEN_W) * SEEN_C - 60 + 15, o = new THREE.Object3D();
  for (let k = 0; k < 3; k++) { const a = nHash(i, k) * TAU, r = nHash(k, i) * 12, sc = on && edgeOf(cx, cz) > -16 ? 34 + nHash(i + 7, k) * 22 : 0.001; o.position.set(cx + Math.cos(a) * r, 26 + k * 3, cz + Math.sin(a) * r); o.scale.set(sc, sc * 0.5, sc); o.rotation.y = a; o.updateMatrix(); cloudMesh.setMatrixAt(i * 3 + k, o.matrix); }
}
for (let i = 0; i < SEEN_W * SEEN_H; i++) setCloud(i, true);
// treasure chests hidden out in the world
const CHESTS = (() => {
  const R = seeded(77), out = []; for (let i = 0; i < 4000 && out.length < 24; i++) { const x = R() * MAPW, z = R() * MAPH; if (edgeOf(x, z) < 28 || dist(x, z, KEEP.x, KEEP.z) < 70 || !clearAt(x, z, 3) || out.some(c => dist(c.x, c.z, x, z) < 50)) continue; out.push({ x, z }); }
  return out;
})();
for (const c of CHESTS) { const g = new THREE.Group(); g.add(box('#7a4a22', 0, 0.55, 0, 1.8, 1.1, 1.2), box('#9c6b3e', 0, 1.25, 0, 1.9, 0.4, 1.3), box('#ffd23f', 0, 0.75, 0.62, 0.4, 0.5, 0.1), box('#ffd23f', 0, 0.55, 0, 1.9, 0.14, 1.25)); g.position.set(c.x, 0, c.z); scene.add(g); c.mesh = g; }

// ---------- structures ----------
function stoneOf(lv) { return lv < 3 ? ['#9c6b3e', '#7a5228'] : lv < 6 ? ['#bdb6aa', '#8f887c'] : ['#ece6d8', '#c9a94a']; }
function roofOf(lv) { return lv < 6 ? '#2f6fe0' : '#1f4fd0'; }
function addFlag(g, x, y, z, color = '#3b82f6') {
  g.add(box('#5a3a1c', x, y + 0.9, z, 0.1, 1.8, 0.1));
  const f = box(color, x + 0.45, y + 1.5, z, 0.8, 0.5, 0.05); f.userData.flag = true; g.add(f);
}
function crenels(g, cx, y, cz, w, d, color, n = 3) {
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n - 0.5; g.add(box(color, cx + t * w, y, cz - d / 2, 0.42, 0.42, 0.3), box(color, cx + t * w, y, cz + d / 2, 0.42, 0.42, 0.3), box(color, cx - w / 2, y, cz + t * d, 0.3, 0.42, 0.42), box(color, cx + w / 2, y, cz + t * d, 0.3, 0.42, 0.42)); }
}
function miniArcher(color = '#2f6fe0') {
  const g = new THREE.Group();
  g.add(box('#2b3550', -0.12, 0.25, 0, 0.18, 0.5, 0.2), box('#2b3550', 0.12, 0.25, 0, 0.18, 0.5, 0.2), box(color, 0, 0.75, 0, 0.5, 0.5, 0.36), box('#f0c08f', 0, 1.15, 0, 0.34, 0.32, 0.32), box(color, 0, 1.36, 0, 0.4, 0.14, 0.38));
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 4, 12, Math.PI), mat('#7a4a22')); bow.position.set(0.3, 0.8, 0.25); bow.rotation.set(0, Math.PI / 2, Math.PI / 2); g.add(bow);
  return g;
}
function buildStructure(p) {
  const g = new THREE.Group(), lv = p.lvl, [st, tr] = stoneOf(lv);
  g.userData.turret = null;
  switch (p.type) {
    case 'market': {
      g.add(box(st, 0, 1.1, 0, 4.4, 2.2, 3), box(tr, 0, 0.15, 0, 5, 0.3, 3.6), mesh(GEO.cone4, '#7a4fd0', 0, 3.4, 0, 5.4, 2.4, 4.2), box('#2a170a', 0, 0.8, 1.52, 1.1, 1.6, 0.05));
      for (let i = 0; i < Math.min(lv, 6); i++) g.add(mesh(GEO.cyl8, '#ffd23f', -2 + i * 0.8, 0.45 + (i % 2) * 0.1, 2.3, 0.6, 0.5 + i * 0.12, 0.6));
      if (lv >= 3) addFlag(g, 0, 4.6, 0, lv >= 6 ? '#ffcf3a' : '#b99cff');
      break;
    }
    case 'camp': {
      for (let i = 0; i < Math.min(lv + 1, 5); i++) { const a = i * 1.3, r = i ? 1.9 : 0; g.add(mesh(GEO.cone8, i % 2 ? '#c9a06a' : '#e8c07a', Math.cos(a) * r, 0.9, Math.sin(a) * r, 1.9, 1.8, 1.9)); }
      break;
    }
    case 'lumber': {
      g.add(box('#7a5228', 0, 1.1, 0, 3.4, 2.2, 2.6), mesh(GEO.cone4, '#3f8a54', 0, 3, 0, 4.2, 1.8, 3.4));
      for (let i = 0; i < Math.min(lv + 1, 5); i++) g.add(box('#9c6b3e', 2.6, 0.3 + i * 0.32, -1 + (i % 2) * 0.3, 0.4, 0.3, 2.2));
      break;
    }
    case 'quarry': {
      g.add(box('#8f887c', 0, 1, 0, 3.2, 2, 2.6), mesh(GEO.cone4, '#5b6270', 0, 2.8, 0, 4, 1.6, 3.2));
      for (let i = 0; i < Math.min(lv + 1, 5); i++) g.add(mesh(GEO.sph, '#bdb6aa', 2.6, 0.4 + i * 0.25, -1 + i * 0.5, 0.9, 0.8, 0.9));
      break;
    }
    case 'archer': {
      const h = 3 + lv * 0.35;
      g.add(box(st, 0, h / 2, 0, 2.2, h, 2.2), box(tr, 0, 0.2, 0, 2.5, 0.4, 2.5), box(st, 0, h + 0.2, 0, 2.9, 0.4, 2.9));
      g.add(box('#3a2414', 0, 0.75, 1.11, 0.7, 1.3, 0.05));
      if (lv >= 3) g.add(box(tr, 0, h * 0.6, 0, 2.3, 0.18, 2.3));
      crenels(g, 0, h + 0.6, 0, 2.6, 2.6, st);
      if (lv >= 2) { const r = mesh(GEO.cone4, roofOf(lv), 0, h + 2.2, 0, 3.6, 2 + lv * 0.12, 3.6); g.add(r); for (const s of [-1, 1]) g.add(box(tr, s * 1.2, h + 1.3, 0, 0.18, 1.4, 0.18)); }
      if (lv >= 4) addFlag(g, 0, h + 3.2 + lv * 0.12, 0, lv >= 6 ? '#ffcf3a' : '#3b82f6');
      const t = new THREE.Group(); t.position.set(0, h + 0.4, 0); t.add(miniArcher()); if (lv >= 5) { const b = miniArcher(); b.position.x = -0.6; t.add(b); } if (lv >= 7) { const b = miniArcher(); b.position.x = 0.6; t.add(b); }
      g.add(t); g.userData.turret = t; g.userData.muzzle = h + 1.3; break;
    }
    case 'ballista': {
      const h = 2.6 + lv * 0.25;
      g.add(box(st, 0, h / 2, 0, 2.1, h, 2.1), box(tr, 0, h + 0.15, 0, 2.5, 0.3, 2.5));
      g.add(box('#2a1d12', -0.4, h * 0.55, 1.06, 0.25, 0.35, 0.05), box('#2a1d12', 0.4, h * 0.55, 1.06, 0.25, 0.35, 0.05), box('#2a1d12', 0, h * 0.35, 1.06, 0.6, 0.12, 0.05));
      const t = new THREE.Group(); t.position.set(0, h + 0.5, 0);
      t.add(box('#7a4a22', 0, 0, 0, 0.35, 0.3, 2.2), box('#5a3a1c', 0, 0, 0.6, 2.6, 0.18, 0.2), box('#dfe3ea', 0, 0.22, 0.3, 0.12, 0.12, 2.2), box('#4a4f58', 0, -0.35, 0, 0.5, 0.4, 0.5));
      if (lv >= 4) t.add(box('#ffcf3a', 0, 0.02, -1.05, 0.5, 0.36, 0.2));
      g.add(t); g.userData.turret = t; g.userData.muzzle = h + 0.7; break;
    }
    case 'cannon': {
      const h = 1.4 + lv * 0.15;
      g.add(mesh(GEO.cyl12, st, 0, h / 2, 0, 3.0, h, 3.0), mesh(GEO.cyl12, tr, 0, h + 0.1, 0, 3.2, 0.25, 3.2));
      const t = new THREE.Group(); t.position.set(0, h + 0.55, 0);
      const barrel = mesh(GEO.cyl12, lv >= 6 ? '#c9a94a' : '#3a3f48', 0, 0.15, 0.7, 0.6 + lv * 0.04, 2.0, 0.6 + lv * 0.04); barrel.rotation.x = Math.PI / 2 - 0.25; t.add(barrel);
      t.add(mesh(GEO.sph, '#4a4f58', 0, 0, 0, 1.1, 0.9, 1.1), box('#6b4423', -0.55, -0.2, 0, 0.18, 0.6, 1.2), box('#6b4423', 0.55, -0.2, 0, 0.18, 0.6, 1.2));
      if (lv >= 4) { const b2 = barrel.clone(); b2.position.x = 0.5; barrel.position.x = -0.5; t.add(b2); }
      g.add(t); g.userData.turret = t; g.userData.muzzle = h + 0.8; break;
    }
    case 'mage': {
      const h = 4.5 + lv * 0.4;
      g.add(mesh(GEO.cyl8, lv >= 6 ? '#e6e0f5' : '#7b6bb5', 0, h / 2, 0, 1.9, h, 1.9), mesh(GEO.cyl8, '#5d4c99', 0, h + 0.15, 0, 2.5, 0.3, 2.5));
      for (const s of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.add(mesh(GEO.cone4, '#5d4c99', s[0] * 1.1, h + 0.9, s[1] * 1.1, 0.4, 1.4, 0.4));
      const orb = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: '#d9ccff' })); orb.position.set(0, h + 1.6, 0); orb.scale.setScalar(1 + lv * 0.06); g.add(orb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#a98bff', blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.copy(orb.position); glow.scale.setScalar(4); g.add(glow);
      g.userData.orb = orb; g.userData.muzzle = h + 1.6; break;
    }
    case 'wall': {
      const len = 4.9, hgt = lv < 2 ? 1.8 : 2.2 + lv * 0.15;
      if (lv < 2) {
        for (let i = 0; i < 10; i++) { const x = -len / 2 + (i + 0.5) * len / 10; g.add(mesh(GEO.cyl8, '#9c6b3e', x, hgt / 2, 0, 0.55, hgt, 0.55), mesh(GEO.cone8, '#d9b27a', x, hgt + 0.3, 0, 0.55, 0.6, 0.55)); }
        g.add(box('#6e4824', 0, hgt * 0.6, 0.3, len, 0.2, 0.12));
      } else {
        g.add(box(st, 0, hgt / 2, 0, len, hgt, 1.2), box(tr, 0, 0.25, 0, len + 0.2, 0.5, 1.4));
        for (let i = 0; i < 7; i++) g.add(box(st, -len / 2 + 0.3 + i * (len - 0.6) / 6, hgt + 0.25, -0.35, 0.5, 0.5, 0.4));
        for (const s of [-1, 1]) { g.add(box(st, s * (len / 2 + 0.6), (hgt + 0.8) / 2, 0, 1.5, hgt + 0.8, 1.6)); if (lv >= 5) g.add(mesh(GEO.cone4, roofOf(lv), s * (len / 2 + 0.6), hgt + 1.6, 0, 2.0, 1.6, 2.0)); }
        if (lv >= 3) for (let i = 0; i < 6; i++) g.add(mesh(GEO.cone4, '#d9dde3', -len / 2 + 0.5 + i * (len - 1) / 5, 0.5, -0.9, 0.3, 1.0, 0.3)).children;
        if (lv >= 7) addFlag(g, 0, hgt + 0.5, 0, '#ffcf3a');
      }
      g.rotation.y = -p.rot + Math.PI / 2; break;
    }
    case 'barracks': {
      g.add(box(st, 0, 1.2, 0, 4.2, 2.4, 3), box(tr, 0, 0.15, 0, 4.5, 0.3, 3.3));
      for (const sd of [-1, 1]) { const r = box(roofOf(lv), 0, 3.0, sd * 0.8, 4.8, 0.25, 2.1); r.rotation.x = sd * 0.62; g.add(r); }
      g.add(box(st, -2.0, 2.9, 0, 0.2, 1.1, 2.0), box(st, 2.0, 2.9, 0, 0.2, 1.1, 2.0));
      g.add(box('#3a2414', 0, 0.8, 1.52, 1.0, 1.6, 0.06), box('#ffd67a', -1.4, 1.4, 1.52, 0.6, 0.5, 0.05), box('#ffd67a', 1.4, 1.4, 1.52, 0.6, 0.5, 0.05));
      addFlag(g, 2.1, 2.4, 1.2); if (lv >= 4) addFlag(g, -2.1, 2.4, 1.2, '#ffcf3a');
      break;
    }
    case 'mine': {
      g.add(mesh(GEO.rock, '#8d8478', 0, 1.0, 0, 4.2, 2.6, 3.4), box('#2a1d12', 0, 0.8, 1.45, 1.4, 1.6, 0.3), box('#7a4a22', -0.8, 0.9, 1.6, 0.2, 1.8, 0.2), box('#7a4a22', 0.8, 0.9, 1.6, 0.2, 1.8, 0.2), box('#7a4a22', 0, 1.8, 1.6, 1.8, 0.2, 0.2));
      for (let i = 0; i < 4 + lv * 2; i++) { const a = i * 2.4, r = 1.2 + (i % 3) * 0.5; g.add(mesh(GEO.rock, '#ffd23f', Math.cos(a) * r, 1.4 + Math.sin(i) * 0.6, Math.sin(a) * r * 0.6, 0.45, 0.4, 0.45, { emissive: '#4a3000' })); }
      g.add(box('#6b4423', 2.4, 0.45, 1.2, 1.3, 0.7, 0.9)); for (let i = 0; i < 3; i++) g.add(mesh(GEO.rock, '#ffd23f', 2.1 + i * 0.3, 0.95, 1.2, 0.4, 0.35, 0.4, { emissive: '#4a3000' }));
      break;
    }
    case 'sword': case 'armor': case 'boots': case 'recruit': {
      const gold = lv >= 10, top = lv >= 5 ? '#e9e3d6' : '#bdb6aa';
      g.add(box(top, 0, 0.35, 0, 2.6, 0.7, 2.6), box(gold ? '#d4a017' : '#8f887c', 0, 0.75, 0, 2.2, 0.2, 2.2));
      const icon = new THREE.Group(); icon.position.set(0, 1.0, 0);
      if (p.type === 'sword') { icon.add(box(gold ? '#ffd23f' : '#dfe3ea', 0, 1.6, 0, 0.35, 2.6, 0.12), box('#c9a94a', 0, 0.35, 0, 1.2, 0.2, 0.25), box('#5a3a1c', 0, 0.0, 0, 0.18, 0.6, 0.18)); icon.rotation.z = 0.15; }
      else if (p.type === 'armor') { icon.add(box(gold ? '#ffd23f' : '#2f6fe0', 0, 1.3, 0, 1.6, 1.9, 0.25), box('#ffd23f', 0, 1.3, 0.14, 0.25, 1.4, 0.05), box('#ffd23f', 0, 1.5, 0.14, 1.0, 0.25, 0.05)); }
      else if (p.type === 'boots') { icon.add(box('#7a4a22', 0, 0.6, 0, 0.6, 1.2, 0.6), box('#7a4a22', 0, 0.15, 0.35, 0.6, 0.3, 1.2), box(gold ? '#ffd23f' : '#62e0c6', 0, 1.1, 0, 0.7, 0.2, 0.7)); for (const s of [-1, 1]) icon.add(box('#ffffff', s * 0.4, 1.0, -0.2, 0.08, 0.35, 0.7)); }
      else { g.add(mesh(GEO.cone6, '#2f6fe0', 0, 2.2, 0, 3.4, 2.8, 3.4), box('#1d3f8f', 0, 1.3, 1.25, 0.9, 1.1, 0.1)); addFlag(g, 0, 3.4, 0, gold ? '#ffcf3a' : '#3b82f6'); }
      g.add(icon); g.userData.spin = p.type !== 'recruit' ? icon : null; break;
    }
    case 'bank': {
      g.add(box('#e9e3d6', 0, 0.25, 0, 5, 0.5, 3.6), box('#d9d2c2', 0, 1.6, 0, 3.8, 2.2, 2.4), box('#ffd23f', 0, 2.95, 0, 4.8, 0.5, 3.4));
      for (const x of [-2, -0.67, 0.67, 2]) g.add(mesh(GEO.cyl8, '#ffffff', x, 1.6, 1.45, 0.42, 2.2, 0.42));
      g.add(mesh(GEO.cone4, '#d4a017', 0, 3.9, 0, 5.6, 1.5, 4.2), box('#3a2414', 0, 1.2, 1.22, 0.9, 1.5, 0.05));
      const c = mesh(GEO.cyl12, '#ffd23f', 0, 5.3, 0, 1.2, 0.22, 1.2, { emissive: '#5a3a00' }); c.rotation.x = Math.PI / 2; g.add(c); g.userData.spin = c;
      break;
    }
    case 'keep': {
      const s = 1 + Math.min(lv, 15) * 0.02, [ks, kt] = lv < 5 ? ['#c9c2b6', '#9a9284'] : lv < 10 ? ['#e2dccf', '#b3ab9c'] : ['#f2ede2', '#c9a94a'];
      g.add(box(ks, 0, 2.2, 0, 8, 4.4, 7), box(kt, 0, 0.3, 0, 8.6, 0.6, 7.6));
      crenels(g, 0, 4.65, 0, 7.6, 6.6, ks, 5);
      g.add(box(ks, 0, 4.6, -0.5, 4, 3.4, 3.6)); crenels(g, 0, 6.5, -0.5, 3.6, 3.2, ks, 3);
      g.add(mesh(GEO.cone4, roofOf(lv * 0.6), 0, 8.2, -0.5, 4.8, 3.2 + lv * 0.1, 4.6)); addFlag(g, 0, 9.6 + lv * 0.1, -0.5, '#3b82f6');
      for (const [x, z] of [[-4, -3.5], [4, -3.5], [-4, 3.5], [4, 3.5]]) {
        g.add(mesh(GEO.cyl8, ks, x, 3.0, z, 2.2, 6, 2.2), mesh(GEO.cone8, roofOf(lv * 0.6), x, 7.0, z, 2.8, 2.4 + lv * 0.08, 2.8));
        if (lv >= 4) addFlag(g, x, 8.1, z, lv >= 10 ? '#ffcf3a' : '#ff8a3d');
      }
      g.add(box('#4a2c16', 0, 1.3, 3.52, 1.8, 2.6, 0.1), box('#2a170a', 0, 2.65, 3.53, 2.0, 0.2, 0.1));
      for (const x of [-2.4, 2.4]) g.add(box('#ffd67a', x, 2.8, 3.52, 0.7, 0.9, 0.05));
      g.scale.setScalar(s); break;
    }
  }
  return g;
}

function buildFort(ours) {
  const g = new THREE.Group(), st = ours ? '#ece6d8' : '#5a5560', tr = ours ? '#c9a94a' : '#3a3640', roof = ours ? '#2f6fe0' : '#a3241f', flag = ours ? '#3b82f6' : '#ff3b2f';
  g.add(box(st, 0, 2.5, 0, 6, 5, 6), box(tr, 0, 0.3, 0, 6.6, 0.6, 6.6), box(st, 0, 6, 0, 3, 3, 3), mesh(GEO.cone4, roof, 0, 8.8, 0, 3.8, 2.6, 3.8));
  crenels(g, 0, 5.2, 0, 5.6, 5.6, st, 4); addFlag(g, 0, 10, 0, flag);
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) g.add(mesh(GEO.cyl8, st, x, 3.2, z, 1.8, 6.4, 1.8), mesh(GEO.cone8, roof, x, 7.3, z, 2.3, 2, 2.3));
  g.add(box('#2a170a', 0, 1.3, 3.02, 1.8, 2.6, 0.1));
  return g;
}
const nodeGroups = NODES.map(n => {
  const g = new THREE.Group();
  if (n.k === 'wood') for (const [x, z, sc] of [[0, 0, 1.25], [1.7, 0.9, 1], [-1.5, 1.1, 0.95], [0.3, -1.6, 1.05]]) g.add(mesh(GEO.cyl8, '#6b4a2a', x, 0.7 * sc, z, 0.6 * sc, 1.4 * sc, 0.6 * sc), mesh(GEO.cone8, '#2f8a4a', x, 2.5 * sc, z, 2.5 * sc, 2.7 * sc, 2.5 * sc));
  else for (const [x, z, sc] of [[0, 0, 2.3], [1.8, 0.8, 1.4], [-1.6, 1, 1.5], [0.4, -1.5, 1.2]]) g.add(mesh(GEO.sph, x ? '#a8a194' : '#8f887c', x, 0.45 * sc, z, sc, sc * 0.9, sc));
  g.position.set(n.x, 0, n.z); scene.add(g); return g;
});
const isOurs = c => c.fi !== undefined ? G.cap[c.fi] : G.world[c.id] > 0;
function syncForts() { for (const f of CASTLES) { const o = !!isOurs(f); if (f.mesh && f.built === o) continue; if (f.mesh) scene.remove(f.mesh); f.built = o; f.mesh = buildFort(o); f.mesh.position.set(f.x, 0, f.z); f.mesh.scale.setScalar(f.sz); scene.add(f.mesh); } }

// ---------- pad decals (cost squares on the ground) ----------
const PAD_SIZE = 3.4;
function makePad(p) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PAD_SIZE, PAD_SIZE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.07; m.renderOrder = 2; scene.add(m);
  p.padMesh = m; p.padCtx = c.getContext('2d'); p.padTex = tex; p.padKey = '';
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); }
const FONT = '"Lilita One","Arial Black",Impact,sans-serif';
const OUT = '#2a1a10';
function coinIcon(g, x, y, r, spin = 0) {
  const w = Math.abs(Math.cos(spin)) * 0.75 + 0.25;
  ell(g, x, y, r * w, r); g.fillStyle = '#e8a20c'; g.fill(); g.lineWidth = Math.max(1.5, r * 0.2); g.strokeStyle = '#7a4a00'; g.stroke();
  ell(g, x, y, r * w * 0.66, r * 0.66); g.fillStyle = '#ffd23f'; g.fill();
  if (w > 0.6) { g.fillStyle = '#c98a00'; g.font = Math.round(r * 0.9) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♛', x, y + r * 0.05); }
}
function drawPad(p, can) {
  const cost = padCost(p), left = Math.max(0, Math.ceil(cost - p.paid)), key = left + '|' + can + '|' + p.lvl;
  if (key === p.padKey) return; p.padKey = key;
  const g = p.padCtx, f = clamp(p.paid / cost, 0, 1);
  g.clearRect(0, 0, 256, 256);
  rr(g, 14, 14, 228, 228, 22); g.fillStyle = can ? 'rgba(40,120,60,0.92)' : 'rgba(30,70,40,0.88)'; g.fill();
  if (f > 0) { g.save(); rr(g, 14, 14, 228, 228, 22); g.clip(); g.fillStyle = 'rgba(255,210,60,0.45)'; g.fillRect(14, 242 - 228 * f, 228, 228 * f); g.restore(); }
  g.setLineDash([46, 26]); g.lineDashOffset = 20; g.lineWidth = 11; g.strokeStyle = '#ffffff'; rr(g, 22, 22, 212, 212, 18); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.font = '30px ' + FONT; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.5)';
  const title = (p.lvl ? '▲ ' : '') + TYPES[p.type].name + (p.lvl ? ' ' + (p.lvl + 1) : '');
  g.strokeText(title, 128, 62); g.fillStyle = '#ffffff'; g.fillText(title, 128, 62);
  const s = fmt(left), size = s.length > 3 ? 74 : 92;
  g.font = size + 'px ' + FONT; const tw = g.measureText(s).width;
  const x0 = 128 - (tw + 54) / 2;
  g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.textAlign = 'left'; g.strokeText(s, x0, 150); g.fillStyle = '#ffffff'; g.fillText(s, x0, 150);
  coinIcon(g, x0 + tw + 30, 150, 23);
  p.padTex.needsUpdate = true;
}
// the two bank squares: put in / take out
const makeZone = z => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PAD_SIZE, PAD_SIZE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(z.spot.x, 0.07, z.spot.z); m.renderOrder = 2; m.visible = false; scene.add(m);
  return { ...z, m, g: c.getContext('2d'), tex, key: '' };
};
const bankZones = [{ spot: BANK_DEP, title: 'PUT IN', col: '#ffd23f' }, { spot: BANK_WD, title: 'TAKE OUT', col: '#7ee081' }].map(makeZone);
const investZones = [{ spot: INV_IN, title: 'INVEST', col: '#b99cff' }, { spot: INV_OUT, title: 'CASH OUT', col: '#7ee081' }].map(makeZone);
const trainZone = makeZone({ spot: TRAIN_Z, title: 'TRAIN', col: '#8ab4ff' });
function drawZone(z, bank, sub) {
  const key = Math.floor(bank) + '|' + sub; if (key === z.key) return; z.key = key; const g = z.g;
  g.clearRect(0, 0, 256, 256); rr(g, 14, 14, 228, 228, 22); g.fillStyle = 'rgba(60,40,10,0.9)'; g.fill();
  g.setLineDash([46, 26]); g.lineWidth = 11; g.strokeStyle = z.col; rr(g, 22, 22, 212, 212, 18); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = z.col; g.font = '38px ' + FONT; g.fillText(z.title, 128, 72);
  g.fillStyle = '#ffffff'; g.font = '50px ' + FONT; g.fillText(fmt(bank), 128, 132); g.font = '26px ' + FONT; g.fillStyle = '#e8d5b5'; g.fillText(sub, 128, 180);
  z.tex.needsUpdate = true;
}
const GLOW = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();

// ---------- characters (instanced crowds) ----------
const PARTS = [ // name, pivot xyz, size xyz, pivot drop, color key
  ['legL', -0.16, 0.55, 0, 0.25, 0.55, 0.27, 0.275, 'legs'],
  ['legR', 0.16, 0.55, 0, 0.25, 0.55, 0.27, 0.275, 'legs'],
  ['body', 0, 0.86, 0, 0.64, 0.64, 0.44, 0, 'body'],
  ['belt', 0, 0.62, 0, 0.66, 0.12, 0.46, 0, 'legs'],
  ['head', 0, 1.38, 0, 0.44, 0.42, 0.42, 0, 'skin'],
  ['helm', 0, 1.62, 0, 0.5, 0.17, 0.48, 0, 'helm'],
  ['plume', 0, 1.79, -0.02, 0.1, 0.22, 0.38, 0, 'plume'],
  ['shield', -0.42, 0.92, 0.12, 0.1, 0.66, 0.56, 0, 'shield'],
  ['weapon', 0.4, 0.95, 0.12, 0.09, 1.05, 0.09, -0.42, 'weapon'],
];
class Crowd {
  constructor(cap) {
    this.cap = cap; this.n = 0;
    this.meshes = PARTS.map(() => { const m = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cap); m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color()); scene.add(m); return m; });
  }
  begin() { this.n = 0; }
  add(x, y, z, yaw, sc, walk, swing, col, flash, lean = 0, hideShield = false, roll = 0) {
    if (this.n >= this.cap) return; const i = this.n++;
    _e.set(lean, yaw, roll, 'YXZ'); _q.setFromEuler(_e); _b.compose(_v.set(x, y, z), _q, _s.set(sc, sc, sc));
    const legA = Math.sin(walk) * 0.7;
    for (let k = 0; k < PARTS.length; k++) {
      const P = PARTS[k]; let rx = 0, hide = false;
      if (P[0] === 'legL') rx = legA; else if (P[0] === 'legR') rx = -legA;
      else if (P[0] === 'weapon') rx = -0.25 + swing * 1.9;
      else if (P[0] === 'shield') hide = hideShield || !col.shield;
      _e.set(rx, 0, 0); _q.setFromEuler(_e); _p.compose(_v.set(P[1], P[2], P[3]), _q, _one);
      if (hide) _t.makeScale(0, 0, 0); else { _t.makeScale(P[4], P[5], P[6]); _t.setPosition(0, -P[7], 0); }
      _p.multiply(_t); _m.multiplyMatrices(_b, _p);
      this.meshes[k].setMatrixAt(i, _m);
      this.meshes[k].setColorAt(i, flash ? _white : col.c[P[8]] || _white);
    }
  }
  end() { for (const m of this.meshes) { m.count = this.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
}
const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _p = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _white = new THREE.Color('#ffffff');
const _o = new THREE.Object3D();
function palette(o) { const c = {}; for (const k in o) if (o[k]) c[k] = new THREE.Color(o[k]); return { c, shield: !!o.shield }; }
for (const k in ETYPES) { const T = ETYPES[k]; T.pal = palette({ legs: '#3a1410', body: T.body, skin: k === 'imp' ? '#9fd36b' : '#e2a56f', helm: T.helm, plume: T.plume, shield: T.shield, weapon: T.weapon }); T.r = 0.45 * T.sc; }
const ALLY_PAL = {
  follower: palette({ legs: '#22304d', body: '#2f6fe0', skin: '#f0c08f', helm: '#1f3f90', plume: '#ffd23f', weapon: '#7a4a22' }),
  soldier: palette({ legs: '#22304d', body: '#9aa6b8', skin: '#f0c08f', helm: '#cfd6e2', plume: '#3b82f6', shield: '#2f6fe0', weapon: '#e5e9f0' }),
};
const foes = new Crowd(700), allies = new Crowd(170);

// hero: unique model
const hero3 = (() => {
  const g = new THREE.Group();
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.19, 0.62, 0); legR.position.set(0.19, 0.62, 0);
  legL.add(box('#2b3550', 0, -0.31, 0, 0.28, 0.62, 0.3)); legR.add(box('#2b3550', 0, -0.31, 0, 0.28, 0.62, 0.3));
  legL.add(box('#5a3a1c', 0, -0.56, 0.06, 0.3, 0.14, 0.4)); legR.add(box('#5a3a1c', 0, -0.56, 0.06, 0.3, 0.14, 0.4));
  const body = new THREE.Group(); body.position.y = 0.62;
  body.add(box('#cfd6e2', 0, 0.38, 0, 0.78, 0.72, 0.52), box('#2f6fe0', 0, 0.38, 0.27, 0.5, 0.6, 0.04), box('#6b4423', 0, 0.06, 0, 0.82, 0.14, 0.56), box('#ffd23f', 0, 0.06, 0.29, 0.16, 0.14, 0.04));
  body.add(box('#cfd6e2', -0.5, 0.62, 0, 0.3, 0.2, 0.44), box('#cfd6e2', 0.5, 0.62, 0, 0.3, 0.2, 0.44));
  const head = new THREE.Group(); head.position.y = 0.95; body.add(head);
  head.add(box('#f0c08f', 0, 0.2, 0, 0.5, 0.46, 0.46), box('#1b0f08', -0.11, 0.24, 0.235, 0.07, 0.09, 0.02), box('#1b0f08', 0.11, 0.24, 0.235, 0.07, 0.09, 0.02));
  head.add(box('#dfe3ea', 0, 0.48, 0, 0.58, 0.2, 0.54), box('#dfe3ea', 0, 0.3, -0.24, 0.58, 0.36, 0.08));
  head.add(box('#ffd23f', 0, 0.68, 0, 0.12, 0.26, 0.5), box('#ff8a3d', 0, 0.78, -0.12, 0.1, 0.2, 0.3));
  const cape = box('#2f6fe0', 0, -0.35, 0, 0.9, 0.95, 0.06); const capeP = new THREE.Group(); capeP.position.set(0, 0.74, -0.3); capeP.add(cape); body.add(capeP);
  cape.material = mat('#2457c8');
  const swordArm = new THREE.Group(); swordArm.position.set(0.55, 0.5, 0.05); body.add(swordArm);
  swordArm.add(box('#cfd6e2', 0, -0.15, 0, 0.22, 0.4, 0.22));
  const sword = new THREE.Group(); sword.position.set(0, -0.3, 0.1); swordArm.add(sword);
  const blade = box('#eef2f7', 0, 0.75, 0, 0.12, 1.2, 0.05); sword.add(blade, box('#c9a94a', 0, 0.14, 0, 0.5, 0.1, 0.12), box('#5a3a1c', 0, -0.06, 0, 0.1, 0.32, 0.1));
  const shield = box('#2f6fe0', -0.55, 0.32, 0.12, 0.1, 0.7, 0.6); body.add(shield); body.add(box('#ffd23f', -0.61, 0.32, 0.12, 0.04, 0.26, 0.26));
  g.add(legL, legR, body);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32), new THREE.MeshBasicMaterial({ color: '#7cc8ff', transparent: true, opacity: 0.7, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  g.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
  g.scale.setScalar(1.15);
  scene.add(g);
  return { g, legL, legR, body, capeP, swordArm, blade, ring };
})();

// ---------- instanced fx pools ----------
function pool(geo, material, cap, shadow = false) { const m = new THREE.InstancedMesh(geo, material, cap); m.frustumCulled = false; m.castShadow = shadow; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; scene.add(m); return m; }
const coinGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.09, 14);
const coinMesh = pool(coinGeo, new THREE.MeshLambertMaterial({ color: '#ffc61a', emissive: '#5a3a00' }), 1800, true);
const arrowMesh = pool(new THREE.BoxGeometry(0.07, 0.07, 0.9), new THREE.MeshLambertMaterial({ color: '#f4ead2' }), 500);
const boltMesh = pool(new THREE.BoxGeometry(0.16, 0.16, 1.9), new THREE.MeshLambertMaterial({ color: '#dfe3ea' }), 60);
const ballMesh = pool(GEO.sph, new THREE.MeshLambertMaterial({ color: '#2a2d33' }), 80, true);
const zapMesh = pool(BOX, new THREE.MeshBasicMaterial({ color: '#efe6ff' }), 260);
const debris = pool(BOX, new THREE.MeshLambertMaterial({ color: '#ffffff' }), 900);
debris.setColorAt(0, new THREE.Color());
const puffs = pool(GEO.sph, new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }), 320);
puffs.setColorAt(0, new THREE.Color());
const shadowMesh = pool(new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false }), 700);
const ringPool = Array.from({ length: 18 }, () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return { m, life: 0 }; });
const rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })); rangeRing.rotation.x = -Math.PI / 2; rangeRing.position.y = 0.09; rangeRing.visible = false; scene.add(rangeRing);
const warnArrows = PATHS.map(p => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const c = mesh(GEO.cone4, '#ff3b2f', 0, 0.3, i * 1.3, 1.2, 1.0, 0.6); c.rotation.x = Math.PI / 2; c.castShadow = false; g.add(c); } g.visible = false; scene.add(g); return g; });

// ================= audio =================
const AU = {
  c: null, muted: false, last: {},
  init() { if (this.c) { if (this.c.state === 'suspended') this.c.resume(); return; } try { this.c = new (window.AudioContext || window.webkitAudioContext)(); this.m = this.c.createGain(); this.m.gain.value = 0.55; this.m.connect(this.c.destination); const n = this.c.sampleRate; this.nb = this.c.createBuffer(1, n, n); const d = this.nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } catch (e) { this.c = null; } },
  ok(k, gap) { if (!this.c || this.muted || SIM) return false; const t = this.c.currentTime; if (this.last[k] && t - this.last[k] < gap) return false; this.last[k] = t; return true; },
  tone(f0, f1, d, type, v, dl = 0) { const c = this.c, t = c.currentTime + dl, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g); g.connect(this.m); o.start(t); o.stop(t + d + 0.03); },
  noise(d, v, f, type = 'lowpass', dl = 0) { const c = this.c, t = c.currentTime + dl, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.nb; fl.type = type; fl.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(fl); fl.connect(g); g.connect(this.m); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.03); },
  play(k) {
    switch (k) {
      case 'shoot': if (this.ok(k, 0.07)) { this.tone(1100, 420, 0.07, 'triangle', 0.04); this.noise(0.04, 0.035, 3500, 'highpass'); } break;
      case 'swing': if (this.ok(k, 0.12)) { this.noise(0.12, 0.12, 2200, 'bandpass'); } break;
      case 'hit': if (this.ok(k, 0.05)) this.tone(240, 110, 0.06, 'square', 0.03); break;
      case 'die': if (this.ok(k, 0.05)) { this.noise(0.1, 0.09, 1200); this.tone(380, 90, 0.12, 'sine', 0.07); } break;
      case 'coin': if (this.ok(k, 0.045)) { const p = 1 + Math.random() * 0.12; this.tone(1320 * p, 1320 * p, 0.05, 'square', 0.022); this.tone(1980 * p, 1980 * p, 0.09, 'square', 0.02, 0.04); } break;
      case 'drop': if (this.ok(k, 0.06)) this.tone(700 + Math.random() * 500, 1500, 0.05, 'triangle', 0.035); break;
      case 'build': if (this.ok(k, 0.1)) { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.14, 'triangle', 0.09, i * 0.07)); this.noise(0.3, 0.14, 500); } break;
      case 'boom': if (this.ok(k, 0.09)) { this.noise(0.45, 0.28, 380); this.tone(130, 40, 0.35, 'sine', 0.26); } break;
      case 'thunk': if (this.ok(k, 0.1)) { this.tone(180, 60, 0.15, 'square', 0.06); this.noise(0.08, 0.1, 900); } break;
      case 'zap': if (this.ok(k, 0.1)) { this.tone(1900, 180, 0.22, 'sawtooth', 0.045); this.noise(0.18, 0.07, 5000, 'highpass'); } break;
      case 'horn': if (this.ok(k, 1)) { this.tone(110, 98, 1.3, 'sawtooth', 0.1); this.tone(165, 147, 1.3, 'sawtooth', 0.05); } break;
      case 'wall': if (this.ok(k, 0.15)) { this.noise(0.14, 0.12, 300); this.tone(90, 60, 0.12, 'sine', 0.1); } break;
      case 'hurt': if (this.ok(k, 0.25)) { this.tone(300, 150, 0.12, 'sawtooth', 0.06); } break;
      case 'wave': if (this.ok(k, 0.5)) { this.tone(392, 392, 0.12, 'triangle', 0.1); this.tone(587, 587, 0.25, 'triangle', 0.1, 0.12); } break;
      case 'clear': if (this.ok(k, 0.5)) [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.18, 'square', 0.035, i * 0.08)); break;
      case 'over': if (this.ok(k, 1)) [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.3, 'triangle', 0.12, i * 0.22)); break;
      case 'tap': if (this.ok(k, 0.05)) this.tone(700, 900, 0.05, 'triangle', 0.06); break;
    }
  }
};

// ================= game state =================
let G = null, best = 0;
try { best = +localStorage.getItem('emberkeep.best') || 0; } catch (e) {}
// crowns: earned each run, spent on permanent upgrades (kept in this browser)
const META_DEFS = [
  { id: 'gold', name: 'START GOLD', desc: '+15 coins each try', col: '#ffd23f' },
  { id: 'power', name: 'HERO POWER', desc: 'Hero hits 12% harder', col: '#ff8a3d' },
  { id: 'keep', name: 'STRONG KEEP', desc: 'Keep has 20% more health', col: '#7ee081' },
  { id: 'luck', name: 'LUCKY LOOT', desc: 'Enemies drop 10% more', col: '#62c6ff' },
];
let META = { crowns: 0, gold: 0, power: 0, keep: 0, luck: 0 };
try { Object.assign(META, JSON.parse(localStorage.getItem('emberkeep.meta') || '{}')); } catch (e) {}
const saveMeta = () => { try { localStorage.setItem('emberkeep.meta', JSON.stringify(META)); } catch (e) {} writeSave(); };
// the run is saved here and on the PC (server.mjs), so it survives a closed app or a new Wi-Fi address
const NOSAVE = AUTO || SIM || Q.has('selftest');
let SAVE = null;
function writeSave() {
  if (NOSAVE) return;
  if (G && G.state !== 'title') {
    const over = G.state === 'over', lv = {}; for (const p of G.pads) lv[p.id] = p.lvl;
    SAVE = { cleared: over ? G.checkpoint : G.cleared, checkpoint: G.checkpoint, coins: over ? 15 * META.gold : Math.floor(G.coins), bank: Math.floor(G.bank), lv, cap: G.cap, empire: G.empire, raidAfter: G.raidAfter, kills: G.kills, invest: Math.floor(G.invest), wood: Math.floor(G.wood), stone: Math.floor(G.stone), troops: Math.floor(G.troops), world: G.world, wdmg: G.wdmg, goalI: G.goalI, seenMap: G.seenMap, hx: Math.round(G.hero.x), hz: Math.round(G.hero.z), seen: G.seen, chests: G.chests };
  }
  const blob = JSON.stringify({ ts: Date.now(), v: 5, best, meta: META, save: SAVE });
  try { localStorage.setItem('emberkeep.save', blob); } catch (e) {}
  fetch('save', { method: 'POST', body: blob, keepalive: true }).catch(() => {});
}
function applySave(v) {
  G.cleared = G.wave = v.cleared; G.checkpoint = v.checkpoint; G.coins = v.coins; G.bank = v.bank; G.cap = v.cap || G.cap; G.empire = v.empire || 0; G.raidAfter = v.raidAfter || 0; G.kills = v.kills || 0; G.runStart = G.wave;
  G.invest = v.invest || 0; G.wood = v.wood || 0; G.stone = v.stone || 0; G.troops = v.troops || 0; G.world = v.world || {}; G.wdmg = v.wdmg || {}; G.goalI = v.goalI || 0; G.seenMap = !!v.seenMap; G.chests = v.chests || []; G.seen = v.seen || []; freshClouds();
  if (v.hx !== undefined && edgeOf(v.hx, v.hz) > 10) { G.hero.x = v.hx; G.hero.z = v.hz; G.cam.x = v.hx; G.cam.z = v.hz; }
  for (const p of G.pads) {
    p.lvl = v.lv[p.id] ?? p.lvl; p.shown = padOpen(p) || p.lvl > 0; p.appear = p.shown ? 1 : 0;
    if (p.type === 'wall' && p.lvl) { p.maxHp = p.hp = towerStats(p).hp; p.broken = false; }
    if (p.lvl) rebuild(p);
  }
  fixKeep(); G.loot = []; G.hero.maxHp = G.hero.hp = heroStats().hp; G.preview = buildWave(G.wave + 1); syncForts();
}
function fixKeep() { const k = G.padMap.keep; k.maxHp = keepMax(k.lvl); k.hp = k.maxHp; }
async function loadAll() {
  if (NOSAVE) return;
  let a = null, b = null;
  try { a = JSON.parse(localStorage.getItem('emberkeep.save')); } catch (e) {}
  try { const r = await Promise.race([fetch('save'), new Promise((_, no) => setTimeout(no, 1500))]); if (r.ok) b = await r.json(); } catch (e) {}
  const u = !a ? b : !b ? a : (b.ts > a.ts ? b : a); if (!u) return;
  if ((u.v || 0) < 5) { try { localStorage.setItem('emberkeep.save.v' + (u.v || 3) + '.backup', JSON.stringify(u)); } catch (e) {} }
  if (!u.v) { try { if (!localStorage.getItem('emberkeep.save.v3')) localStorage.setItem('emberkeep.save.v3', JSON.stringify(u)); } catch (e) {} } // spare copy of the old save
  Object.assign(META, u.meta || {}); best = Math.max(best, u.best || 0);
  if (u.save) { SAVE = u.save; applySave(SAVE); }
}
const metaCost = l => 4 + l * 4;
let shopRects = [];
const padCost = p => { const T = TYPES[p.type]; return Math.max(1, Math.round(T.base * Math.pow(T.grow, p.type === 'keep' ? p.lvl - 1 : p.lvl))); };
const keepMax = l => Math.round(700 * Math.pow(1.38, l - 1) * (1 + 0.2 * META.keep));
const hpMult = n => Math.pow(1.165, n - 1) * (1 + 0.02 * (n - 1));
const coinMult = n => 1 + 0.11 * (n - 1);
function heroStats() {
  const L = G.lv;
  return { dmg: 20 * Math.pow(1.3, L('sword')) * (1 + 0.12 * META.power) * (G.fury > 0 ? 2 : 1), hp: Math.round(140 * Math.pow(1.28, L('armor'))), spd: 8.8 + 0.4 * L('boots'), magnet: 2.6 + 0.3 * L('boots'), rate: 1 / (0.55 * Math.pow(0.97, L('sword'))), reach: G.fury > 0 ? 3.7 : 2.5 };
}
function towerStats(p) {
  const L = p.lvl;
  switch (p.type) {
    case 'archer': return { dmg: 10 * Math.pow(1.52, L - 1), rate: 1.05 + 0.12 * L, range: 14 + 0.6 * L, shots: L >= 7 ? 3 : L >= 4 ? 2 : 1 };
    case 'ballista': return { dmg: 34 * Math.pow(1.52, L - 1), rate: 0.5 + 0.06 * L, range: 20 + 0.6 * L };
    case 'cannon': return { dmg: 26 * Math.pow(1.55, L - 1), rate: 0.42 + 0.05 * L, range: 16 + 0.5 * L, rad: 2.6 + 0.15 * L, barrels: L >= 4 ? 2 : 1 };
    case 'mage': return { dmg: 24 * Math.pow(1.55, L - 1), rate: 0.55 + 0.05 * L, range: 17 + 0.6 * L, chain: 3 + L };
    case 'keep': return { dmg: 8 * Math.pow(1.4, L - 1), rate: 1.2 + 0.06 * L, range: 16, shots: 1 + Math.floor(L / 4) };
    case 'wall': return { hp: Math.round(320 * Math.pow(1.72, L - 1)), spike: L >= 3 ? 6 * Math.pow(1.5, L - 1) : 0 };
    case 'barracks': return { n: Math.min(8, L + 1), dmg: 9 * Math.pow(1.5, L - 1), hp: Math.round(90 * Math.pow(1.55, L - 1)) };
    case 'recruit': return { n: L, dmg: 7 * Math.pow(1.3, L - 1), rate: 1.1, range: 9 };
    case 'mine': return { pay: Math.round(4 * L * coinMult(G.wave + 1)) };
    case 'bank': return { cap: Math.round(150 * Math.pow(2.5, L - 1)), rate: 1 + L * 0.5 };
    case 'market': return { rate: 8 + 2 * L };
    case 'camp': return { n: L, load: 1 + Math.floor(L / 2) };
    case 'lumber': case 'quarry': return { pay: 6 * L };
  }
  return {};
}

function newGame() {
  if (G) { for (const p of G.pads) { if (p.mesh) scene.remove(p.mesh); if (p.padMesh) { scene.remove(p.padMesh); p.padTex.dispose(); } } }
  G = {
    state: 'title', t: 0, coins: 15 * META.gold, combo: 0, comboT: 0, comboPop: 0, earned: 0, wave: 0, cleared: 0, kills: 0,
    waveState: 'prep', next: 8, queue: [], spawnT: 0, waveTotal: 0, waveDone: 0, preview: null,
    hero: { x: KEEP.x + 6, z: KEEP.z + 3, face: 0, walk: 0, vx: 0, vz: 0, moving: false, cd: 0, swing: 0, hp: 140, maxHp: 140, dead: 0, padT: 0, padId: null, drainT: 0, dropT: 0, hurtT: 0, regenT: 0, lagX: 0, lagZ: 0 },
    pads: [], enemies: [], soldiers: [], followers: [], arrows: [], bolts: [], balls: [], zaps: [], parts: [], puffs: [], nums: [], loot: [], drops: [],
    bank: 0, bankT: 0, bankFull: false, invest: 0, wood: 0, stone: 0, troops: 0, world: {}, wdmg: {}, goalI: 0, goalT: 0, seenMap: false, map: null, workers: [], zoneT: 0, gatherT: 0, seen: [], chests: [], seenT: 0, away: false, realm: 'home', target: null, trainT: 0, bkTop: null, checkpoint: 0, runKills: 0, runStart: 0, raid: null, cap: [false, false, false, false], empire: 0, raidAfter: 0, fury: 0, sureNew: 0,
    shake: 0, slow: 1, slowT: 0, coinPulse: 0, banner: null, toasts: [], flash: 0, tut: 0, moved: 0, paused: false, overT: 0, aiT: 0, bossRef: null,
    cam: { x: KEEP.x + 12, z: KEEP.z },
  };
  G.lv = id => G.padMap[id] ? G.padMap[id].lvl : 0;
  G.pads = DEFS.map(d => ({ ...d, lvl: d.type === 'keep' ? 1 : 0, paid: 0, pop: 0, cd: rnd(0, 1), aim: 0, hp: 0, maxHp: 0, broken: false, shown: d.unlock === 0 && d.fort === undefined, appear: d.unlock === 0 && d.fort === undefined ? 1 : 0, mesh: null }));
  G.padMap = {}; for (const p of G.pads) G.padMap[p.id] = p; // pad pictures are made when first shown
  const k = G.padMap.keep; k.maxHp = keepMax(1); k.hp = k.maxHp; rebuild(k);
  const hs = heroStats(); G.hero.maxHp = G.hero.hp = hs.hp;
  // starter coins on the ground: teach "walk to collect"
  for (let i = 0; i < 9; i++) G.loot.push({ x: wx(15) + i * 0.9 + rnd(-0.3, 0.3), y: 0.05, z: wz(21) + Math.sin(i) * 0.9, vx: 0, vy: 0, vz: 0, st: 1, t: -99, spin: rnd(0, 6), v: 1 });
  G.preview = buildWave(1); syncForts(); freshClouds();
}
function freshClouds() { for (let i = 0; i < SEEN_W * SEEN_H; i++) setCloud(i, !G.seen.includes(i)); cloudMesh.instanceMatrix.needsUpdate = true; reveal(KEEP.x + 30, KEEP.z, 150); for (const c of CASTLES) if (isOurs(c)) reveal(c.x, c.z, 90); for (const c of CHESTS) c.mesh.visible = !G.chests.includes(CHESTS.indexOf(c)); }
function reveal(x, z, r) { let ch = false; for (let i = 0; i < SEEN_W * SEEN_H; i++) { if (G.seen.includes(i)) continue; const cx = (i % SEEN_W) * SEEN_C - 45, cz = Math.floor(i / SEEN_W) * SEEN_C - 45; if (dist(x, z, cx, cz) < r) { G.seen.push(i); setCloud(i, false); ch = true; } } if (ch) cloudMesh.instanceMatrix.needsUpdate = true; }
const isSeen = (x, z) => G.seen.includes(cellOf(x, z));
// the keep fell: buildings stay, coins on you are gone, back to the last checkpoint
function retry() {
  for (const k of ['enemies', 'arrows', 'bolts', 'balls', 'zaps', 'loot', 'drops', 'queue', 'soldiers']) G[k] = [];
  G.raid = null; G.bossRef = null; G.map = null; G.coins = 15 * META.gold; G.wave = G.cleared = G.checkpoint; G.runStart = G.wave; G.runKills = 0; G.combo = 0; G.fury = 0;
  G.waveState = 'prep'; G.next = 15; G.preview = buildWave(G.wave + 1); G.state = 'play'; G.slow = 1; G.slowT = 0;
  for (const p of G.pads) if (p.type === 'wall' && p.lvl) { p.broken = false; p.hp = p.maxHp = towerStats(p).hp; rebuild(p); }
  fixKeep(); const h = G.hero; h.x = KEEP.x + 6; h.z = KEEP.z + 3; h.dead = 0; h.maxHp = h.hp = heroStats().hp;
  writeSave();
}

// ================= effects =================
const COL = {}; const col = c => COL[c] || (COL[c] = new THREE.Color(c));
function burst(x, y, z, n, cols, sp = 6, size = 0.18, life = 0.7) { for (let i = 0; i < n && G.parts.length < 880; i++) { const a = rnd(0, TAU), v = rnd(sp * 0.3, sp); G.parts.push({ x, y, z, vx: Math.cos(a) * v, vy: rnd(sp * 0.4, sp * 1.1), vz: Math.sin(a) * v, life: rnd(life * 0.6, life), max: life, size: rnd(size * 0.6, size), c: col(pick(cols)), rx: rnd(0, 6), ry: rnd(0, 6) }); } }
function puff(x, y, z, n, c = '#ffffff', size = 0.6, up = 1.5) { for (let i = 0; i < n && G.puffs.length < 310; i++) G.puffs.push({ x: x + rnd(-0.3, 0.3), y: y + rnd(0, 0.3), z: z + rnd(-0.3, 0.3), vx: rnd(-1, 1), vy: rnd(0.3, up), vz: rnd(-1, 1), life: rnd(0.45, 0.8), max: 0.8, size: rnd(size * 0.6, size), c: col(c) }); }
function ring(x, z, r, c = '#ffffff', life = 0.4) { const R = ringPool.find(q => q.life <= 0); if (!R) return; R.life = life; R.max = life; R.r = r; R.m.position.set(x, 0.12, z); R.m.material.color.set(c); R.m.visible = true; }
function num(x, y, z, v, c = '#fff', size = 26) { if (G.nums.length > 70) G.nums.shift(); G.nums.push({ x: x + rnd(-0.3, 0.3), y, z, v, c, size, life: 0.8 }); }
function toast(text, c = '#ffd23f') { G.toasts.push({ text, c, life: 2.4 }); if (G.toasts.length > 3) G.toasts.shift(); }
function banner(text, sub = '', c = '#ffd23f', life = 2.2) { G.banner = { text, sub, c, life, max: life }; }
function shake(v) { G.shake = Math.max(G.shake, v); }
function dropCoins(x, z, n) {
  n = Math.max(1, Math.round(n)); let v = 1;
  if (G.loot.length + n > 1500) { v = Math.ceil(n / 6); n = Math.ceil(n / v); }
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(1, 3.2); G.loot.push({ x, y: 0.8, z, vx: Math.cos(a) * s, vy: rnd(5, 8), vz: Math.sin(a) * s, st: 0, t: 0, spin: rnd(0, 6), v }); }
}

// ================= waves =================
function buildWave(n) {
  let paths = PATHS.filter((p, i) => p.from <= n && !G.cap[i]); if (!paths.length) paths = PATHS.filter(p => p.from <= n);
  const q = [];
  const total = Math.min(240, Math.round(10 + n * 6.8));
  const types = ['raider']; if (n >= 2) types.push('runner'); if (n >= 3) types.push('shield'); if (n >= 5) types.push('archer');
  let made = 0, sq = 0;
  while (made < total) {
    const size = Math.min(total - made, irnd(4, Math.min(26, 5 + n)));
    const t = sq === 0 ? 'raider' : pick(types), p = paths[sq % paths.length];
    const lead = n >= 4 && Math.random() < 0.45 ? Math.min(1 + Math.floor(n / 6), 4) : 0;
    for (let b = 0; b < lead; b++) q.push({ t: 'brute', p, d: b === 0 ? Math.max(1.6, 5 - n * 0.1) : 0.6, off: (b % 3 - 1) * 1.0 });
    for (let i = 0; i < size; i++) q.push({ t: Math.random() < 0.12 && types.length > 1 ? pick(types) : t, p, d: i === 0 && !lead ? (sq === 0 ? 0.5 : Math.max(1.6, 5 - n * 0.1)) : (i % 3 === 0 ? 0.42 : 0.04), off: (i % 3 - 1) * 0.95 });
    made += size; sq++;
  }
  if (n % 5 === 0) for (let b = 0; b < Math.floor(n / 10) + 1; b++) q.splice(Math.floor(q.length * (0.5 + b * 0.2)), 0, { t: 'boss', p: pick(paths), d: 2, off: 0 });
  if (n >= 2 && Math.random() < 0.8) q.splice(irnd(3, q.length - 1), 0, { t: 'imp', p: pick(paths), d: 0.3, off: 0 });
  const counts = {}; for (const e of q) counts[e.t] = (counts[e.t] || 0) + 1;
  return { q, counts, paths, n };
}
function startWave() {
  G.wave++; const w = G.preview && G.preview.n === G.wave ? G.preview : buildWave(G.wave);
  G.queue = w.q.slice(); G.spawnT = 0.3; G.waveTotal = G.queue.filter(e => e.t !== 'imp').length; G.waveDone = 0; G.waveState = 'fight';
  if (w.counts.boss) { banner('BOSS WAVE ' + G.wave, 'A Warlord is coming!', '#ff4d3d', 2.6); AU.play('horn'); }
  else { banner('WAVE ' + G.wave, G.waveTotal + ' enemies incoming', '#ffd23f', 1.8); AU.play('wave'); }
}
function spawnEnemy(q) {
  const T = ETYPES[q.t], m = hpMult(G.wave) * (1 + 0.15 * G.empire);
  const e = { t: q.t, T, p: q.p, s: q.p.start + rnd(-0.5, 0.5), dir: 1, off: q.off + rnd(-0.15, 0.15), hp: T.hp * m, max: T.hp * m, spd: T.spd * 1.45 * rnd(0.95, 1.05), walk: rnd(0, 6), flash: 0, atk: rnd(0.2, 0.8), swing: 0, alive: true, x: 0, z: 0, yaw: 0, coin: T.coin * coinMult(G.wave), dmg: T.dmg * Math.pow(1.1, G.wave - 1), fight: null, kb: 0 };
  if (q.t === 'boss') { G.bossRef = e; shake(0.6); }
  const pp = pathPos(e.p, e.s); e.x = pp.x; e.z = pp.z;
  G.enemies.push(e);
}
function waveClear() {
  G.cleared = G.wave; G.waveState = 'prep'; G.next = 15; G.preview = buildWave(G.wave + 1); G.preview.n = G.wave + 1;
  let mine = 0; for (const p of G.pads) if (p.type === 'mine' && p.lvl) mine += towerStats(p).pay;
  const forts = G.cap.filter(Boolean).length * Math.round(12 * coinMult(G.wave));
  const landCoins = worldPay();
  const bonus = Math.round(3 + G.wave * 1.5) + mine + forts + landCoins;
  if (G.lv('market') && G.invest >= 1) { const add = Math.ceil(G.invest * towerStats(G.padMap.market).rate / 100); G.invest += add; toast('Investments grew +' + fmt(add), '#b99cff'); }
  if (G.lv('bank') && G.bank >= 1) { const st = towerStats(G.padMap.bank), add = Math.min(st.cap - G.bank, Math.ceil(G.bank * st.rate / 100)); if (add > 0) { G.bank += add; toast('Bank paid you +' + fmt(add), '#ffd23f'); } }
  if (G.wave % 5 === 0 && G.wave > G.checkpoint) { G.checkpoint = G.wave; toast('CHECKPOINT! If you lose, you restart here', '#7ee081'); }
  banner('WAVE ' + G.wave + ' CLEARED!', '+' + bonus + ' coins' + (mine ? ' (mine +' + mine + ')' : ''), '#7ee081', 2.2);
  AU.play('clear');
  dropCoins(KEEP.x + 3, KEEP.z + 4, bonus);
  for (const p of G.pads) if (p.type === 'wall' && p.lvl > 0 && p.broken) { p.broken = false; p.hp = p.maxHp; rebuild(p); }
  for (const p of G.pads) if (p.type === 'wall' && p.lvl > 0) p.hp = p.maxHp;
  const k = G.padMap.keep; k.hp = Math.min(k.maxHp, k.hp + k.maxHp * 0.2);
  const h = G.hero; h.hp = h.maxHp;
  for (const p of G.pads) if (!p.shown && padOpen(p)) { p.shown = true; p.appear = 0; toast('NEW: ' + TYPES[p.type].name + '!', TYPES[p.type].col); }
  if (PATHS.some(p => p.from === G.wave + 1 && p.from > 2)) toast('NEW ENEMY PATH!', '#ff6b6b');
  if (AUTO || SIM) botWorld();
  checkGoals(); writeSave();
}

// ================= raids: walk up to an enemy castle and the fight starts =================
function guard(f, t, a, r) {
  const T = ETYPES[t], m = Math.pow(hpMult(f.pw + 1), 0.75) * (t === 'fort' ? (f.cap ? 2.4 : 1) : 0.7), x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
  return { t, T, p: f.path || PATHS[0], s: (f.path || PATHS[0]).start, dir: 1, off: 0, hp: T.hp * m, max: T.hp * m, spd: T.spd * rnd(0.95, 1.05), walk: rnd(0, 6), flash: 0, atk: rnd(0.2, 0.8), swing: 0, alive: true, x, z, yaw: 0, coin: T.coin * coinMult(f.pw + 1), dmg: T.dmg * 0.7 * Math.pow(1.06, f.pw), fight: null, kb: 0, free: true, stat: t === 'fort' };
}
const dangerOf = c => { const d = c.pw - G.cleared; return d <= -3 ? ['EASY', '#7ee081'] : d <= 2 ? ['FAIR', '#ffd23f'] : d <= 8 ? ['HARD', '#ffb13d'] : ['DEADLY', '#ff6b4a']; };
function startRaid(f) {
  const e = guard(f, 'fort', 0, 0); G.enemies.unshift(e); G.bossRef = e; const h = G.hero;
  G.raid = { f, e, left: Math.min(40, 8 + Math.floor(f.pw * 0.6) + (f.cap ? 10 : 0)), spawnT: 0.2, endT: null };
  for (const k of G.soldiers) k.target = null;
  // your troops march in with you
  const st = G.bkTop ? towerStats(G.bkTop) : { hp: 90 };
  for (let i = 0, n = Math.min(40, G.troops); i < n; i++) G.soldiers.push({ x: h.x + rnd(-5, 5), z: h.z + rnd(-5, 5), hp: st.hp, max: st.hp, alive: true, cd: 0, target: null, walk: 0, yaw: 0, respawn: 0, slot: G.soldiers.length, swing: 0, army: true });
  banner(f.name, 'Break the castle! Walk away to leave.', '#ff8a7a', 2); AU.play('horn'); shake(0.5);
}
function updateRaid(dt) {
  const R = G.raid; if (!R) return;
  if (R.endT !== null) { R.endT -= dt; if (R.endT <= 0) endRaid(); return; }
  if (G.hero.dead > 0) { toast('The attack failed. Grow stronger and come back!', '#ff8a7a'); endRaid(); return; }
  if (dist(G.hero.x, G.hero.z, R.f.x, R.f.z) > 55) { toast('You left the fight.', '#ffffff'); endRaid(); return; }
  R.spawnT -= dt;
  if (R.spawnT <= 0 && R.left > 0 && G.enemies.filter(e => e.free).length < 12) {
    const n = Math.min(R.left, irnd(2, 4)), types = ['raider', 'raider', 'shield', 'archer']; if (R.f.pw >= 8) types.push('brute');
    for (let i = 0; i < n; i++) G.enemies.push(guard(R.f, pick(types), rnd(0, TAU), 6 * R.f.sz));
    R.left -= n; R.spawnT = 3; puff(R.f.x, 0.5, R.f.z, 6, '#8a7d70', 1.4);
  }
}
function endRaid() {
  for (const e of G.enemies) if (e.free) e.alive = false; G.enemies = G.enemies.filter(e => e.alive);
  G.soldiers = G.soldiers.filter(k => !k.army);
  G.raid = null; G.bossRef = null; writeSave();
}
function captureFort(e) {
  const R = G.raid, f = R.f; if (f.fi !== undefined) G.cap[f.fi] = true; else G.world[f.id] = 1;
  R.endT = 3; R.left = 0; syncForts(); reveal(f.x, f.z, 90);
  for (const p of G.pads) if (p.fort === f.fi && f.fi !== undefined || p.land === f.id) { p.shown = true; p.appear = 0; }
  for (const g of G.enemies) if (g.free && g.alive && g !== e) kill(g);
  for (const c of G.loot) c.rush = true;
  const crowns = f.cap ? 12 : 4, loot = 15 + f.pw * 3; META.crowns += crowns; G.wood += loot; G.stone += loot; shake(1.2); G.flash = 0.6; G.slow = 0.4; G.slowT = 0.8;
  banner(f.cap ? 'CAPITAL TAKEN!' : 'CASTLE TAKEN!', '+' + crowns + ' crowns  ·  +' + loot + ' wood and stone  ·  a new town opens here', '#7ee081', 3); AU.play('clear');
  burst(f.x, 6, f.z, 60, ['#ffd23f', '#3b82f6', '#ffffff'], 10, 0.35, 1.2);
  if (f.fi !== undefined && G.cap.every(Boolean)) { META.crowns += 20; toast('HOME VALE IS FREE! +20 crowns', '#ffd23f'); }
  if (G.target && G.target.c === f) G.target = null;
  G.preview = buildWave(G.cleared + 1); saveMeta();
  BOTLOG.push('TOOK ' + f.name + ' w' + G.cleared + ' t' + Math.floor(G.t));
}

// ================= combat =================
const aimY = e => 0.95 * e.T.sc;
function hurt(e, d, kind) {
  if (!e.alive) return;
  if (kind === 'arrow' && e.T.armor) d *= e.T.armor;
  d *= 1 + 0.1 * G.cap.filter(Boolean).length + 0.1 * LANDS.filter(n => n.cap && G.world[n.id]).length;
  let crit = false; if ((kind === 'arrow' || kind === 'sword') && Math.random() < 0.12) { d *= 2; crit = true; }
  e.hp -= d; e.flash = 0.09;
  if (e.hp <= 0 && kind === 'sword') { G.combo++; G.comboT = 1.8; G.comboPop = 1; if (G.combo % 10 === 0) { dropCoins(G.hero.x, G.hero.z, 2 + G.combo / 5); toast('COMBO x' + G.combo + '! Bonus coins', '#ffb13d'); } if (G.combo % 25 === 0) { G.fury = 6; banner('FURY!', 'Double damage, longer reach', '#ff8a3d', 1.4); AU.play('horn'); } }
  num(e.x, aimY(e) + 1.1 * e.T.sc, e.z, fmt(Math.max(1, d)), crit ? '#ffe14a' : '#ffffff', crit ? 34 : kind === 'sword' ? 28 : 22);
  AU.play('hit');
  if (e.hp <= 0) kill(e);
}
function kill(e) {
  e.alive = false; G.kills++; G.runKills++; if (e.t !== 'imp') G.waveDone++;
  const big = e.t === 'boss' || e.t === 'fort', y = aimY(e);
  burst(e.x, y, e.z, big ? 50 : 10, [e.T.body, e.T.helm, '#3a1410', '#e2a56f'], big ? 9 : 5, big ? 0.4 : 0.2);
  puff(e.x, 0.4, e.z, big ? 14 : 3, '#e8dcc8', big ? 1.6 : 0.6);
  dropCoins(e.x, e.z, e.coin * (1 + 0.1 * META.luck)); AU.play('die');
  if (e.t === 'fort') captureFort(e);
  else if (big) { shake(1.2); G.slow = 0.3; G.slowT = 0.9; G.flash = 0.6; banner('WARLORD DEFEATED!', '+' + Math.round(e.coin) + ' coins', '#ffd23f', 2); }
  if (e.t === 'imp') toast('GOLD GNOME! +' + Math.round(e.coin), '#ffd23f');
  if (G.bossRef === e) G.bossRef = null;
}
function fireArrow(sx, sy, sz, e, dmg, mesh = 'arrow') {
  const d = dist(sx, sz, e.x, e.z);
  G.arrows.push({ sx, sy, sz, e, tx: e.x, ty: aimY(e), tz: e.z, k: 0, dur: Math.max(0.12, d / 26), arc: Math.min(3, d * 0.12), dmg, x: sx, y: sy, z: sz, px: sx, py: sy, pz: sz });
}
function firstIn(x, z, range, skip) {
  let b = null, bs = -1e9;
  for (const e of G.enemies) { if (!e.alive || (skip && skip.has(e))) continue; const d = dist(x, z, e.x, e.z); if (d > range) continue; const s = e.t === 'imp' ? 1e6 - d : e.s / e.p.len * 1000 - d * 0.01; if (s > bs) { bs = s; b = e; } }
  return b;
}
function nearestIn(x, z, range, skip) { let b = null, bd = range; for (const e of G.enemies) { if (!e.alive || (skip && skip.has(e))) continue; const d = dist(x, z, e.x, e.z); if (d < bd) { bd = d; b = e; } } return b; }
function wallBlocking(e) {
  if (e.dir < 0) return null;
  for (const w of e.p.walls) { const p = G.padMap[w.id]; if (p.lvl > 0 && !p.broken && e.s >= w.s - (e.T.r + 1.0) && e.s < w.s + 0.5) return p; }
  return null;
}

// ================= pads =================
function rebuild(p) {
  if (p.mesh) { scene.remove(p.mesh); p.mesh.traverse(o => { if (o.isMesh && o.geometry !== BOX && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); }); }
  p.mesh = buildStructure(p); p.mesh.position.set(p.x, 0, p.z);
  if (p.broken) { p.mesh.rotation.z = 0.12; p.mesh.scale.y = 0.35; }
  scene.add(p.mesh);
}
function completePad(p) {
  p.lvl++; p.paid = 0; p.pop = 1; p.padKey = '';
  const T = TYPES[p.type];
  if (p.type === 'wall') { const s = towerStats(p); p.maxHp = s.hp; p.hp = s.hp; p.broken = false; }
  if (p.type === 'keep') { p.maxHp = keepMax(p.lvl); p.hp = p.maxHp; }
  if (p.type === 'armor') { const hs = heroStats(); G.hero.maxHp = hs.hp; G.hero.hp = hs.hp; }
  rebuild(p);
  burst(p.x, 1.5, p.z, 34, ['#ffd23f', '#fff3a8', T.col, '#ffffff'], 8, 0.22, 0.9);
  ring(p.x, p.z, 5, T.col, 0.5); puff(p.x, 0.3, p.z, 10, '#f0e6d2', 1.3);
  shake(0.35); AU.play('build');
  toast((p.lvl === 1 && p.type !== 'keep' ? 'BUILT ' : '') + T.name + ' LV ' + p.lvl, T.col);
  if (G.tut <= 2 && p.type === 'archer') { G.tut = 3; G.next = Math.min(G.next, 4); }
}
function padSpot(p) { return p.lvl === 0 ? { x: p.x, z: p.z } : { x: p.ux, z: p.uz }; }

// ================= update =================
const input = { joy: null, dx: 0, dz: 0 };
const keys = {};
function update(dt) {
  G.t += dt;
  const h = G.hero, hs = heroStats();
  if (h.maxHp !== hs.hp) h.maxHp = hs.hp;
  // movement
  let mx = input.dx, mz = input.dz;
  if (AUTO || SIM) { const a = aiMove(dt); mx = a.x; mz = a.z; }
  const mag = Math.hypot(mx, mz);
  if (h.dead > 0) {
    h.dead -= dt; h.moving = false;
    if (h.dead <= 0) { h.x = KEEP.x + 5; h.z = KEEP.z + 3; h.hp = h.maxHp; puff(h.x, 0.5, h.z, 8, '#cfe6ff', 1); ring(h.x, h.z, 3, '#7cc8ff'); }
  } else {
    h.moving = mag > 0.1;
    const rsp = hs.spd * (roadAt(h.x, h.z) ? 1.4 : 1.1), tvx = h.moving ? mx / mag * rsp * Math.min(1, mag) : 0, tvz = h.moving ? mz / mag * rsp * Math.min(1, mag) : 0;
    h.vx = lerp(h.vx, tvx, Math.min(1, dt * 14)); h.vz = lerp(h.vz, tvz, Math.min(1, dt * 14));
    { const nx = clamp(h.x + h.vx * dt, 6, MAPW - 6), nz = clamp(h.z + h.vz * dt, 6, MAPH - 6); if (edgeOf(nx, nz) > 18) { h.x = nx; h.z = nz; } else if (edgeOf(nx, h.z) > 18) h.x = nx; else if (edgeOf(h.x, nz) > 18) h.z = nz; }
    for (const f of CASTLES) { const r = 4 * f.sz; if (Math.abs(h.x - f.x) < r && dist(h.x, h.z, f.x, f.z) < r) { const a = Math.atan2(h.z - f.z, h.x - f.x); h.x = f.x + Math.cos(a) * r; h.z = f.z + Math.sin(a) * r; } }
    if (dist(h.x, h.z, KEEP.x, KEEP.z) < 5.2) { const a = Math.atan2(h.z - KEEP.z, h.x - KEEP.x); h.x = KEEP.x + Math.cos(a) * 5.2; h.z = KEEP.z + Math.sin(a) * 5.2; }
    if (h.moving) { h.face = Math.atan2(h.vx, h.vz); h.walk += dt * 13; G.moved += hs.spd * dt * Math.min(1, mag); if (G.tut === 0 && G.moved > 6) G.tut = 1; }
    h.lagX = lerp(h.lagX, -h.vx * 0.04, Math.min(1, dt * 6)); h.lagZ = lerp(h.lagZ, -h.vz * 0.04, Math.min(1, dt * 6));
    // regen
    h.regenT += dt; if (h.regenT > 2.5 && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.06 * dt);
    // sword
    h.cd -= dt; h.swing = Math.max(0, h.swing - dt * 3.2);
    const tgt = nearestIn(h.x, h.z, hs.reach + 0.6) || (G.raid && G.raid.e.alive && dist(h.x, h.z, G.raid.f.x, G.raid.f.z) < hs.reach + 2.4 * G.raid.f.sz ? G.raid.e : null);
    if (tgt) { if (!h.moving) h.face = Math.atan2(tgt.x - h.x, tgt.z - h.z); if (h.cd <= 0) { h.cd = 1 / hs.rate; h.swing = 1; AU.play('swing'); let n = 0; for (const e of G.enemies) if (e.alive && dist(e.x, e.z, h.x, h.z) < hs.reach + e.T.r && n++ < 8) { hurt(e, hs.dmg, 'sword'); if (e.t !== 'boss' && e.t !== 'brute' && !e.free) e.kb = 0.5; } burst(h.x + Math.sin(h.face) * 1.4, 1, h.z + Math.cos(h.face) * 1.4, 5, ['#ffffff', '#cfe6ff'], 4, 0.12, 0.3); } }
  }
  // pads: stand on one to pay coins from your stack
  let on = null;
  if (h.dead <= 0) for (const p of G.pads) { if (!p.shown || p.appear < 1 || p.lvl >= TYPES[p.type].max) continue; const s = padSpot(p); if (Math.abs(h.x - s.x) < PAD_SIZE / 2 + 0.3 && Math.abs(h.z - s.z) < PAD_SIZE / 2 + 0.3) { on = p; break; } }
  if (on && on.id === h.padId) h.padT = h.moving ? Math.min(h.padT, 0) : h.padT + dt; else { h.padId = on ? on.id : null; h.padT = 0; h.drainT = 0; h.dropT = 0; }
  if (on && !h.moving && h.padT > 0.35 && G.coins >= 1) {
    const cost = padCost(on); h.drainT += dt; h.dropT -= dt;
    while (h.dropT <= 0 && G.coins >= 1 && on.paid < cost) {
      const per = Math.max(1, Math.ceil(cost / 24)), amt = Math.min(per, Math.floor(G.coins), cost - on.paid);
      on.paid += amt; G.coins -= amt; h.dropT += Math.max(0.018, 0.075 - h.drainT * 0.03);
      const s = padSpot(on); G.drops.push({ sx: h.x, sy: 1.4 + Math.min(G.coins, 40) * 0.09, sz: h.z, tx: s.x + rnd(-0.6, 0.6), tz: s.z + rnd(-0.6, 0.6), k: 0 }); AU.play('drop');
    }
    if (on.paid >= cost) { completePad(on); h.padT = -0.8; }
  }
  // bank squares: stop on one to put coins in or take them out
  G.zoneT = h.moving ? 0 : G.zoneT + dt; const still = G.zoneT > 0.35;
  if (G.lv('market') && h.dead <= 0 && still) {
    const near = q => Math.abs(h.x - q.x) < PAD_SIZE / 2 + 0.3 && Math.abs(h.z - q.z) < PAD_SIZE / 2 + 0.3;
    G.invT = (G.invT || 0) - dt;
    if (G.invT <= 0) {
      if (near(INV_IN) && G.coins >= 1) {
        const amt = Math.min(Math.max(1, Math.ceil(G.coins / 25)), Math.floor(G.coins)); G.coins -= amt; G.invest += amt; G.invT = 0.05; AU.play('drop');
        G.drops.push({ sx: h.x, sy: 1.4 + Math.min(G.coins, 40) * 0.09, sz: h.z, tx: INV_IN.x + rnd(-0.6, 0.6), tz: INV_IN.z + rnd(-0.6, 0.6), k: 0 });
      } else if (near(INV_OUT) && G.invest >= 1) {
        const amt = Math.min(Math.max(1, Math.ceil(G.invest / 25)), Math.floor(G.invest)); G.invest -= amt; G.invT = 0.05;
        G.loot.push({ x: INV_OUT.x, y: 0.6, z: INV_OUT.z, vx: 0, vy: 0, vz: 0, st: 2, t: 0, sp: 8, spin: 0, v: amt });
      }
    }
  }
  // stop by trees or rocks to gather
  if (h.dead <= 0 && !h.moving && !G.raid) {
    const n = NODES.find(q => dist(h.x, h.z, q.x, q.z) < 4.2);
    if (n) {
      h.face = Math.atan2(n.x - h.x, n.z - h.z); G.gatherT += dt;
      if (G.gatherT >= 0.5) { G.gatherT = 0; const amt = (1 + Math.floor(G.cleared / 10)) * (n.rich ? 3 : 1); G[n.k] += amt; h.swing = 1; num(n.x, 3, n.z, '+' + amt + ' ' + n.k, n.k === 'wood' ? '#8fd37a' : '#dfe3ea', 26); burst(n.x, 1.2, n.z, 5, n.k === 'wood' ? ['#9c6b3e', '#2f8a4a'] : ['#bdb6aa', '#8f887c'], 4, 0.14, 0.4); AU.play('hit'); }
    }
  }
  // workers walk to the trees and rocks and bring it back
  const camp = G.padMap.camp, cst = camp.lvl ? towerStats(camp) : null;
  if (cst) {
    while (G.workers.length < cst.n) G.workers.push({ x: camp.x, z: camp.z, st: 0, t: 0, walk: 0, yaw: 0, node: NODES[G.workers.length % 4] });
    for (const w of G.workers) {
      const q = w.st === 0 ? w.node : camp, d = dist(w.x, w.z, q.x, q.z);
      if (d > 3) { const sp = 12 * dt; w.x += (q.x - w.x) / d * sp; w.z += (q.z - w.z) / d * sp; w.walk += dt * 12; w.yaw = Math.atan2(q.x - w.x, q.z - w.z); }
      else if (w.st === 0) { w.t += dt; if (w.t > 2.5) { w.t = 0; w.st = 1; } }
      else { G[w.node.k] += cst.load; w.st = 0; }
    }
  }
  G.goalT -= dt; if (G.goalT <= 0) { G.goalT = 0.5; checkGoals(); }
  // the wide world: new places, chests, castles you walk up to
  G.away = dist(h.x, h.z, KEEP.x, KEEP.z) > 140;
  G.seenT -= dt; if (G.seenT <= 0) { G.seenT = 0.4; reveal(h.x, h.z, 95); const r = realmAt(h.x, h.z); if (r !== G.realm) { G.realm = r; banner(REALMS[r].name, REALMS[r].sub, '#ffffff', 2.4); AU.play('wave'); } }
  CHESTS.forEach((c, i) => { if (c.mesh.visible && dist(h.x, h.z, c.x, c.z) < 3.2 && h.dead <= 0) openChest(c, i); });
  if (G.target && !G.target.c && dist(h.x, h.z, G.target.x, G.target.z) < 18) G.target = null;
  if (!G.raid && h.dead <= 0) { const c = CASTLES.find(c => !isOurs(c) && dist(h.x, h.z, c.x, c.z) < 7 + 8 * c.sz); if (c) startRaid(c); }
  if (G.bkTop && h.dead <= 0 && !h.moving && Math.abs(h.x - TRAIN_Z.x) < PAD_SIZE / 2 + 0.3 && Math.abs(h.z - TRAIN_Z.z) < PAD_SIZE / 2 + 0.3) { G.trainT -= dt; if (G.trainT <= 0) { G.trainT = 0.5; if (trainTroops()) num(TRAIN_Z.x, 2, TRAIN_Z.z, '+' + TRAIN.n + ' troops', '#8ab4ff', 26); else if (!G.trainMsg) { G.trainMsg = true; toast('Need ' + TRAIN.wood + ' wood and ' + TRAIN.stone + ' stone', '#ffffff'); } } } else G.trainMsg = false;
  if (G.lv('bank') && h.dead <= 0) {
    const st = towerStats(G.padMap.bank), near = q => Math.abs(h.x - q.x) < PAD_SIZE / 2 + 0.3 && Math.abs(h.z - q.z) < PAD_SIZE / 2 + 0.3;
    G.bankT -= dt;
    if (near(BANK_DEP) && G.bank >= st.cap && !G.bankFull) { G.bankFull = true; toast('Bank is full. Upgrade it to hold more!', '#ffd23f'); }
    if (!near(BANK_DEP)) G.bankFull = false;
    if (G.bankT <= 0) {
      if (near(BANK_DEP) && still && G.coins >= 1 && G.bank < st.cap) {
        const amt = Math.min(Math.max(1, Math.ceil(G.coins / 25)), Math.floor(G.coins), st.cap - G.bank); G.coins -= amt; G.bank += amt; G.bankT = 0.05; AU.play('drop');
        G.drops.push({ sx: h.x, sy: 1.4 + Math.min(G.coins, 40) * 0.09, sz: h.z, tx: BANK_DEP.x + rnd(-0.6, 0.6), tz: BANK_DEP.z + rnd(-0.6, 0.6), k: 0 });
      } else if (near(BANK_WD) && still && G.bank >= 1) {
        const amt = Math.min(Math.max(1, Math.ceil(G.bank / 25)), Math.floor(G.bank)); G.bank -= amt; G.bankT = 0.05;
        G.loot.push({ x: BANK_WD.x, y: 0.6, z: BANK_WD.z, vx: 0, vy: 0, vz: 0, st: 2, t: 0, sp: 8, spin: 0, v: amt });
      }
    }
  }
  updateRaid(dt); G.fury = Math.max(0, G.fury - dt);
  // range preview
  G.rangeOf = on && on.lvl > 0 ? on : null;
  // followers trail the hero and shoot
  const nf = G.lv('recruit') ? towerStats(G.padMap.recruit).n : 0;
  while (G.followers.length < nf) G.followers.push({ x: h.x, z: h.z, walk: 0, yaw: 0, cd: rnd(0, 1), swing: 0 });
  G.followers.forEach((f, i) => {
    const row = Math.floor(i / 3) + 1, colm = (i % 3) - 1, back = h.face + Math.PI;
    const tx = h.x + Math.sin(back) * row * 1.2 + Math.cos(back) * colm * 1.1, tz = h.z + Math.cos(back) * row * 1.2 - Math.sin(back) * colm * 1.1;
    const d = dist(f.x, f.z, tx, tz);
    if (d > 0.15) { const sp = Math.min(d, (hs.spd + 2) * dt); f.x += (tx - f.x) / d * sp; f.z += (tz - f.z) / d * sp; f.walk += dt * 12; f.yaw = Math.atan2(tx - f.x, tz - f.z); }
    if (d > 25) { f.x = tx; f.z = tz; }
    f.cd -= dt; f.swing = Math.max(0, f.swing - dt * 4);
    const st = towerStats(G.padMap.recruit), e = nearestIn(f.x, f.z, st.range);
    if (e) { f.yaw = Math.atan2(e.x - f.x, e.z - f.z); if (f.cd <= 0) { f.cd = 1 / st.rate; f.swing = 1; fireArrow(f.x, 1.2, f.z, e, st.dmg); AU.play('shoot'); } }
  });
  // towers
  for (const p of G.pads) {
    p.pop = Math.max(0, p.pop - dt * 2); if (p.shown && p.appear < 1) p.appear = Math.min(1, p.appear + dt * 2);
    if (!p.lvl) continue;
    const s = towerStats(p);
    if (p.type === 'archer' || p.type === 'keep') {
      p.cd -= dt; const e = firstIn(p.x, p.z, s.range);
      if (e) p.aim = Math.atan2(e.x - p.x, e.z - p.z);
      if (e && p.cd <= 0) { p.cd = 1 / s.rate; const used = new Set(); const top = p.type === 'keep' ? 6 : (p.mesh.userData.muzzle || 4); for (let i = 0; i < s.shots; i++) { const t = i ? (firstIn(p.x, p.z, s.range, used) || e) : e; used.add(t); fireArrow(p.x + rnd(-0.4, 0.4), top, p.z + rnd(-0.4, 0.4), t, s.dmg); } AU.play('shoot'); }
    } else if (p.type === 'ballista') {
      p.cd -= dt; const e = firstIn(p.x, p.z, s.range); if (e) p.aim = Math.atan2(e.x - p.x, e.z - p.z);
      if (e && p.cd <= 0) {
        p.cd = 1 / s.rate; const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        G.bolts.push({ x: p.x, z: p.z, y: p.mesh.userData.muzzle, vx: dx / d * 34, vz: dz / d * 34, life: (s.range + 5) / 34, dmg: s.dmg, hit: new Set() }); AU.play('thunk');
      }
    } else if (p.type === 'cannon') {
      p.cd -= dt; const e = firstIn(p.x, p.z, s.range); if (e) p.aim = Math.atan2(e.x - p.x, e.z - p.z);
      if (e && p.cd <= 0) {
        p.cd = 1 / s.rate; const dur = 0.85, stop = e.fight || wallBlocking(e);
        for (let b = 0; b < s.barrels; b++) {
          const pp = pathPos(e.p, e.s + (stop ? 0 : e.spd * dur * e.dir) + b * 1.2), cur = pathPos(e.p, e.s);
          G.balls.push({ sx: p.x, sy: p.mesh.userData.muzzle, sz: p.z, tx: e.free ? e.x : pp.x + (e.x - cur.x), tz: e.free ? e.z : pp.z + (e.z - cur.z), k: -b * 0.12, dur, dmg: s.dmg, rad: s.rad });
        }
        puff(p.x + Math.sin(p.aim) * 1.6, p.mesh.userData.muzzle + 0.2, p.z + Math.cos(p.aim) * 1.6, 5, '#e6e6e6', 0.8); AU.play('boom');
      }
    } else if (p.type === 'mage') {
      p.cd -= dt;
      if (p.cd <= 0) {
        let e = firstIn(p.x, p.z, s.range);
        if (e) {
          p.cd = 1 / s.rate; const used = new Set(), pts = [[p.x, p.mesh.userData.muzzle, p.z]];
          for (let i = 0; i < s.chain && e; i++) { used.add(e); pts.push([e.x, aimY(e), e.z]); hurt(e, s.dmg * Math.pow(0.88, i), 'magic'); e = nearestIn(e.x, e.z, 6, used); }
          G.zaps.push({ pts, life: 0.22, seed: Math.random() * 100 }); G.flash = Math.max(G.flash, 0.06); AU.play('zap');
        }
      }
    }
  }
  // every barracks adds soldiers, and every 3 lands you hold adds one more
  const bks = G.pads.filter(p => p.type === 'barracks' && p.lvl);
  if (bks.length) {
    G.bkTop = bks.reduce((a, b) => b.lvl > a.lvl ? b : a); const st = towerStats(G.bkTop); let n = Math.floor(landsOwned() / 3); for (const b of bks) n += towerStats(b).n;
    n = Math.min(n, 90); let have = 0; for (const k of G.soldiers) if (!k.army) have++;
    for (; have < n; have++) G.soldiers.push({ x: G.bkTop.x, z: G.bkTop.z, hp: st.hp, max: st.hp, alive: true, cd: 0, target: null, walk: 0, yaw: 0, respawn: 0, slot: G.soldiers.length, swing: 0 });
    for (const k of G.soldiers) k.max = st.hp;
  }
  // spawning
  if (G.waveState === 'fight') { G.spawnT -= dt; while (G.queue.length && G.spawnT <= 0) { spawnEnemy(G.queue.shift()); G.spawnT += G.queue.length ? G.queue[0].d : 0; } }
  // enemies
  const keep = G.padMap.keep;
  for (const e of G.enemies) {
    if (!e.alive) continue;
    e.flash -= dt; e.swing = Math.max(0, e.swing - dt * 3);
    let moving = true;
    const attack = (fn) => { moving = false; e.atk -= dt; if (e.atk <= 0) { e.atk = 1.1; e.swing = 1; fn(); } };
    if (e.kb > 0) { e.s -= e.kb * dt * 6; e.kb = Math.max(0, e.kb - dt * 3); }
    if (e.free) {
      const r = e.T.ranged, near = h.dead <= 0 && dist(e.x, e.z, h.x, h.z) < (r || 0.9 + e.T.r + 0.5);
      if (e.fight && (!e.fight.alive || dist(e.x, e.z, e.fight.x, e.fight.z) > e.T.r + 1.6)) e.fight = null;
      if (near) { e.yaw = Math.atan2(h.x - e.x, h.z - e.z); attack(() => { if (r) enemyShot(e, h.x, h.z, () => hurtHero(e.dmg)); else hurtHero(e.dmg); }); }
      else if (e.fight) { e.yaw = Math.atan2(e.fight.x - e.x, e.fight.z - e.z); attack(() => { const k = e.fight; k.hp -= e.dmg; if (k.hp <= 0) { k.alive = false; k.respawn = 3; puff(k.x, 0.5, k.z, 5); e.fight = null; } }); }
      else if (!e.stat && h.dead <= 0) { const d = dist(e.x, e.z, h.x, h.z) || 1; e.x += (h.x - e.x) / d * e.spd * dt; e.z += (h.z - e.z) / d * e.spd * dt; e.yaw = Math.atan2(h.x - e.x, h.z - e.z); e.walk += dt * e.spd * 2.4; }
      continue;
    }
    if (e.t === 'imp') {
      e.s += e.spd * dt * e.dir; if (e.dir > 0 && e.s > e.p.len * 0.55) e.dir = -1;
      if (e.s < e.p.start - 2) { e.alive = false; toast('The gold gnome got away!', '#bbbbbb'); continue; }
    } else {
      const ranged = e.T.ranged;
      const heroNear = h.dead <= 0 && dist(e.x, e.z, h.x, h.z) < (ranged || 0.9 + e.T.r + 0.5);
      if (e.fight && (!e.fight.alive || dist(e.x, e.z, e.fight.x, e.fight.z) > e.T.r + 1.6)) e.fight = null;
      const wall = wallBlocking(e) || (ranged ? wallInRange(e, ranged) : null);
      if (heroNear) {
        e.yaw = Math.atan2(h.x - e.x, h.z - e.z);
        attack(() => { if (ranged) enemyShot(e, h.x, h.z, () => hurtHero(e.dmg)); else hurtHero(e.dmg); });
      } else if (e.fight) {
        e.yaw = Math.atan2(e.fight.x - e.x, e.fight.z - e.z);
        attack(() => { const k = e.fight; k.hp -= e.dmg; burst(k.x, 1, k.z, 4, ['#ffffff', '#cfd6e2'], 3, 0.12, 0.3); if (k.hp <= 0) { k.alive = false; k.respawn = 3; puff(k.x, 0.5, k.z, 5); e.fight = null; } });
      } else if (wall) {
        attack(() => {
          const wst = towerStats(wall);
          if (ranged) enemyShot(e, wall.x, wall.z, () => damageWall(wall, e.dmg)); else damageWall(wall, e.dmg);
          if (wst.spike && !ranged) hurt(e, wst.spike, 'spike');
        });
      } else if (e.s >= e.p.len - 0.5 - e.T.r || (ranged && e.s >= e.p.len - ranged)) {
        attack(() => { if (ranged) enemyShot(e, KEEP.x, KEEP.z, () => damageKeep(e)); else damageKeep(e); });
      } else e.s += e.spd * dt;
    }
    if (moving) e.walk += dt * e.spd * 2.4;
    if (!e.alive) continue;
    const pp = pathPos(e.p, e.s), nx = pp.x - Math.sin(pp.ang) * e.off, nz = pp.z + Math.cos(pp.ang) * e.off;
    if (moving && (Math.abs(nx - e.x) + Math.abs(nz - e.z) > 0.001)) e.yaw = Math.atan2(nx - e.x, nz - e.z);
    e.x = nx; e.z = nz;
  }
  if (keep.hp <= 0 && G.state === 'play') gameOver();
  // soldiers
  const bk = G.bkTop || G.padMap.bk;
  for (const k of G.soldiers) {
    k.swing = Math.max(0, k.swing - dt * 4);
    if (!k.alive && k.army) { G.troops = Math.max(0, G.troops - 1); k.gone = true; continue; }
    if (!k.alive) { k.respawn -= dt; if (k.respawn <= 0) { k.alive = true; k.hp = k.max; k.x = bk.x; k.z = bk.z; puff(k.x, 0.4, k.z, 4); } continue; }
    const follow = G.raid || (G.away && G.waveState === 'prep'), home = follow ? { x: h.x + (k.slot % 6 - 2.5) * 1.5, z: h.z + 2 + Math.floor(k.slot / 6) * 1.3 } : { x: wx(33) + (k.slot % 8) * 1.3, z: wz(24) + (k.slot % 2 ? 2.4 : -2.4) * (1 + Math.floor(k.slot / 8) * 0.6) };
    if (k.target && (!k.target.alive || dist(k.target.x, k.target.z, home.x, home.z) > 13)) { if (k.target.fight === k) k.target.fight = null; k.target = null; }
    if (!k.target) { let b = null, bd = 12; for (const e of G.enemies) { if (!e.alive || e.t === 'imp' || (e.T.ranged && !e.stat)) continue; const d = dist(e.x, e.z, home.x, home.z) + (e.fight ? 4 : 0); if (d < bd) { bd = d; b = e; } } k.target = b; }
    const tx = k.target ? k.target.x - Math.sin(k.target.yaw) * -(k.target.T.r + 0.7) : home.x, tz = k.target ? k.target.z - Math.cos(k.target.yaw) * -(k.target.T.r + 0.7) : home.z;
    const d = dist(k.x, k.z, tx, tz);
    if (d > 60) { k.x = tx; k.z = tz; }
    if (d > 0.2) { const sp = Math.min(d, (follow ? 15 : 9) * dt); k.x += (tx - k.x) / d * sp; k.z += (tz - k.z) / d * sp; k.walk += dt * 12; k.yaw = Math.atan2(tx - k.x, tz - k.z); }
    if (k.target && dist(k.x, k.z, k.target.x, k.target.z) < k.target.T.r + 1.4) {
      if (!k.target.fight) k.target.fight = k;
      k.yaw = Math.atan2(k.target.x - k.x, k.target.z - k.z);
      k.cd -= dt; if (k.cd <= 0) { k.cd = 0.8; k.swing = 1; hurt(k.target, towerStats(bk).dmg, 'melee'); }
    }
  }
  if (G.soldiers.some(k => k.gone)) G.soldiers = G.soldiers.filter(k => !k.gone);
  // projectiles
  for (const a of G.arrows) {
    a.k += dt / a.dur; if (a.e && a.e.alive) { a.tx = a.e.x; a.ty = aimY(a.e); a.tz = a.e.z; }
    const k = Math.min(1, a.k); a.px = a.x; a.py = a.y; a.pz = a.z;
    a.x = lerp(a.sx, a.tx, k); a.z = lerp(a.sz, a.tz, k); a.y = lerp(a.sy, a.ty, k) + Math.sin(Math.PI * k) * a.arc;
    if (a.k >= 1) { a.done = true; if (a.e && a.e.alive && !a.foe) hurt(a.e, a.dmg, 'arrow'); if (a.cb) a.cb(); }
  }
  for (const b of G.bolts) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
    for (const e of G.enemies) if (e.alive && !b.hit.has(e) && dist(e.x, e.z, b.x, b.z) < e.T.r + 0.6) { b.hit.add(e); hurt(e, b.dmg, 'bolt'); burst(e.x, 1, e.z, 4, ['#ffffff', '#dfe3ea'], 4, 0.12, 0.3); }
  }
  for (const s of G.balls) {
    s.k += dt / s.dur;
    if (s.k >= 1) {
      s.done = true; shake(0.3); ring(s.tx, s.tz, s.rad, '#ffcf6a', 0.4);
      burst(s.tx, 0.4, s.tz, 16, ['#ff9b3d', '#ffd23f', '#6b4a2a', '#3a2a1a'], 7, 0.22, 0.6); puff(s.tx, 0.3, s.tz, 7, '#8a7d70', 1.2);
      for (const e of G.enemies) if (e.alive && dist(e.x, e.z, s.tx, s.tz) < s.rad + e.T.r) hurt(e, s.dmg, 'boom');
      AU.play('boom');
    }
  }
  for (const z of G.zaps) z.life -= dt;
  G.arrows = G.arrows.filter(a => !a.done); G.balls = G.balls.filter(s => !s.done); G.bolts = G.bolts.filter(b => b.life > 0); G.zaps = G.zaps.filter(z => z.life > 0);
  G.enemies = G.enemies.filter(e => e.alive);
  // coins: pop, rest, magnet to hero's stack
  for (const c of G.loot) {
    c.t += dt; c.spin += dt * 7;
    if (c.st === 0) { c.vy -= 26 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; if (c.y <= 0.05) { c.y = 0.05; if (c.vy < -3) { c.vy *= -0.35; c.vx *= 0.6; c.vz *= 0.6; } else { c.st = 1; c.t = 0; } } }
    else if (c.st === 1) { if (h.dead <= 0 && (dist(c.x, c.z, h.x, h.z) < hs.magnet || (c.t > 7 && c.t > -50) || c.rush)) { c.st = 2; c.sp = c.t > 7 ? 14 : 6; } }
    else {
      c.sp += 60 * dt; const ty = 1.4 + Math.min(G.coins, 40) * 0.09, d = Math.hypot(h.x - c.x, ty - c.y, h.z - c.z);
      if (d < 0.5 || h.dead > 0) { c.done = true; if (h.dead <= 0) { G.coins += c.v; G.coinPulse = 1; AU.play('coin'); if (G.tut === 1 && G.coins >= 5) G.tut = 2; } else { c.done = false; c.st = 1; c.t = 0; } }
      else { const m = Math.min(d, c.sp * dt); c.x += (h.x - c.x) / d * m; c.y += (ty - c.y) / d * m + Math.sin(c.t * 8) * 0; c.z += (h.z - c.z) / d * m; }
    }
  }
  G.loot = G.loot.filter(c => !c.done);
  for (const d of G.drops) d.k += dt * 3.5; G.drops = G.drops.filter(d => d.k < 1);
  // fx
  for (const p of G.parts) { p.life -= dt; p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; } p.rx += dt * 8; }
  G.parts = G.parts.filter(p => p.life > 0);
  for (const p of G.puffs) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  G.puffs = G.puffs.filter(p => p.life > 0);
  for (const n of G.nums) { n.life -= dt; n.y += dt * 2.2; } G.nums = G.nums.filter(n => n.life > 0);
  for (const t of G.toasts) t.life -= dt; G.toasts = G.toasts.filter(t => t.life > 0);
  if (G.banner) { G.banner.life -= dt; if (G.banner.life <= 0) G.banner = null; }
  for (const r of ringPool) if (r.life > 0) r.life -= dt;
  G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; G.comboPop = Math.max(0, G.comboPop - dt * 5);
  G.coinPulse = Math.max(0, G.coinPulse - dt * 4); G.flash = Math.max(0, G.flash - dt * 2);
  // wave flow
  if (G.waveState === 'prep') {
    if (!G.raid && !G.away) { if (G.tut >= 3 || G.wave > 0 || AUTO || SIM) G.next -= dt; if (G.next <= 0) startWave(); } // waves wait while you are out exploring
  }
  else if (!G.queue.length && !G.enemies.some(e => e.t !== 'imp')) waveClear();
}
function wallInRange(e, r) { for (const w of e.p.walls) { const p = G.padMap[w.id]; if (p.lvl > 0 && !p.broken && e.s < w.s && w.s - e.s < r) return p; } return null; }
function enemyShot(e, tx, tz, cb) { G.arrows.push({ sx: e.x, sy: 1.1, sz: e.z, e: null, tx, ty: 1, tz, k: 0, dur: Math.max(0.15, dist(e.x, e.z, tx, tz) / 22), arc: 1.2, dmg: 0, x: e.x, y: 1.1, z: e.z, px: e.x, py: 1, pz: e.z, foe: true, cb }); }
function hurtHero(d) {
  const h = G.hero; if (h.dead > 0) return;
  h.hp -= d; h.regenT = 0; h.hurtT = 0.15; AU.play('hurt');
  num(h.x, 2.6, h.z, '-' + fmt(d), '#ff5a4a', 24);
  if (h.hp <= 0) { h.dead = 2.5; h.hp = 0; puff(h.x, 0.5, h.z, 10, '#dddddd', 1.2); toast('Hero down! Back in a moment...', '#ff8a7a'); shake(0.5); }
}
function damageWall(w, d) {
  w.hp -= d; burst(w.x, 1.2, w.z, 4, ['#b9b2a8', '#9c6b3e'], 4, 0.16, 0.4); AU.play('wall');
  if (w.hp <= 0) { w.broken = true; rebuild(w); shake(0.5); puff(w.x, 0.6, w.z, 14, '#d8ccb4', 1.6); toast('A wall fell!', '#ff9b6b'); }
}
function damageKeep(e) {
  const k = G.padMap.keep; k.hp -= e.dmg; shake(e.t === 'boss' ? 0.8 : 0.2);
  burst(KEEP.x + 3.5, rnd(1, 3), KEEP.z + rnd(-2, 2), 5, ['#c9c2b6', '#9a9284', '#ffd23f'], 4, 0.18, 0.5); AU.play('wall');
}
function gameOver() {
  G.state = 'over'; G.overT = 0; G.slow = 0.3; G.slowT = 1.2; shake(1.5);
  if (G.wave > best) { best = G.wave; try { localStorage.setItem('emberkeep.best', best); } catch (e) {} }
  G.map = null; if (G.invest >= 1) { const cut = Math.ceil(G.invest * 0.25); G.invest -= cut; toast('Investments lost ' + fmt(cut), '#ff8a7a'); }
  G.earned = Math.max(1, (G.wave - G.runStart) * 2 + Math.floor(G.runKills / 40)); META.crowns += G.earned; saveMeta();
  burst(KEEP.x, 4, KEEP.z, 70, ['#c9c2b6', '#9a9284', '#ff9b3d', '#3a2a1a'], 10, 0.4, 1.2); puff(KEEP.x, 2, KEEP.z, 20, '#5a5048', 2.5, 3);
  AU.play('over');
}

// ================= world pay, chests, map =================
const landsOwned = () => LANDS.filter(n => G.world[n.id] > 0).length;
const TRAIN = { n: 5, wood: 20, stone: 10 };
function worldPay() {
  let coins = 0, wood = 0, stone = 0, troops = 1; for (const p of G.pads) if (p.type === 'barracks' && p.lvl) troops += Math.ceil(p.lvl / 2);
  for (const p of G.pads) { if (p.type === 'lumber' && p.lvl) wood += towerStats(p).pay; if (p.type === 'quarry' && p.lvl) stone += towerStats(p).pay; }
  for (const n of LANDS) {
    const lv = G.world[n.id] || 0; if (!lv) continue; const m = lv * (n.cap ? 3 : 1), k = REALMS[n.r].pay;
    if (k === 'wood') wood += 5 * m; else if (k === 'stone') stone += 5 * m; else if (k === 'troops') troops += 2 * m; else if (k === 'coins') coins += Math.round(15 * m * coinMult(G.wave));
  }
  G.wood += wood; G.stone += stone; G.troops += troops;
  toast('+' + troops + ' troops' + (wood ? '  +' + wood + ' wood' : '') + (stone ? '  +' + stone + ' stone' : ''), '#8fd37a');
  return coins;
}
function trainTroops() {
  if (G.wood < TRAIN.wood || G.stone < TRAIN.stone) return false;
  G.wood -= TRAIN.wood; G.stone -= TRAIN.stone; G.troops += TRAIN.n; AU.play('build'); return true;
}
function openChest(c, i) {
  c.mesh.visible = false; G.chests.push(i); burst(c.x, 1.2, c.z, 30, ['#ffd23f', '#fff3a8', '#9c6b3e'], 7, 0.2, 0.8); puff(c.x, 0.5, c.z, 6, '#fff3a8', 1); AU.play('clear');
  const big = 1 + G.cleared * 0.4, wood = Math.round(25 * big), crown = i % 3 === 0; dropCoins(c.x, c.z, 40 * big); G.wood += wood; G.stone += wood; if (crown) META.crowns += 2;
  toast('CHEST! +' + wood + ' wood and stone' + (crown ? ' +2 crowns' : ''), '#ffd23f'); saveMeta();
}
const mapView = () => { const a = UW / UH, D = Math.max(690 / (0.728 * a), 470 / 0.728); return { y: D * 0.93, z: D * 0.36 }; };
const MB = () => ({ close: { x: UW - 50, y: 48, r: 34 }, act: { x: UW - 190, y: UH - 78, w: 320, h: 92 } });
const inBtn = (p, b) => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2;
function closeMap() { if (G.map) G.map.closing = true; }
function travelTo(c) {
  const h = G.hero, x = c.x, z = c.z + 12 * (c.sz || 1); h.x = x; h.z = z; h.vx = h.vz = 0; G.cam.x = x; G.cam.z = z; G.realm = realmAt(x, z);
  for (const f of G.followers) { f.x = x; f.z = z; } puff(x, 0.5, z, 12, '#cfe6ff', 1.2); ring(x, z, 4, '#7cc8ff'); AU.play('tap'); G.map = null;
}
function mapTap(p) {
  const M = G.map, B = MB(); if (M.closing) return;
  if (dist(p.x, p.y, B.close.x, B.close.y) < B.close.r + 10) { closeMap(); AU.play('tap'); return; }
  const sel = M.sel;
  if (sel && inBtn(p, B.act)) {
    if (sel === KEEP || isOurs(sel)) { if (!G.raid) travelTo(sel); } else { G.target = { x: sel.x, z: sel.z, c: sel, name: sel.name }; closeMap(); AU.play('tap'); }
    return;
  }
  let best2 = null, bd = 60;
  for (const c of [KEEP, ...CASTLES]) { if (c !== KEEP && !isSeen(c.x, c.z)) continue; const s = toUI(c.x, 6, c.z), d = dist(p.x, p.y, s.x, s.y); if (d < bd) { bd = d; best2 = c; } }
  M.sel = best2; if (best2) AU.play('tap');
}
function drawMap() {
  const M = G.map, B = MB(), k = M.k; if (k < 0.5) return; ctx.globalAlpha = (k - 0.5) * 2;
  const cen = { forest: [395, 45], desert: [395, 335], frost: [505, 190], fire: [110, 60] };
  for (const r in cen) if (isSeen(cen[r][0], cen[r][1])) { const s = toUI(cen[r][0], 0, cen[r][1]); ctx.globalAlpha *= 0.75; txt(REALMS[r].name, s.x, s.y, 34, '#ffffff', 'center', 6); ctx.globalAlpha = (k - 0.5) * 2; }
  const K0 = toUI(KEEP.x, 8, KEEP.z), K = { x: K0.x, y: K0.y + 34 }; rr(ctx, K.x - 40, K.y - 16, 80, 30, 12); ctx.fillStyle = '#2f6fe0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke(); txt('HOME', K.x, K.y, 18, '#fff', 'center', 3);
  for (const c of CASTLES) {
    if (!isSeen(c.x, c.z)) continue; const s = toUI(c.x, 8, c.z), own = isOurs(c), sel = M.sel === c, w = c.cap ? 38 : 28;
    ell(ctx, s.x, s.y, sel ? w + 8 : w, sel ? w + 8 : w); ctx.fillStyle = sel ? '#ffd23f' : 'rgba(0,0,0,0)'; ctx.fill();
    ell(ctx, s.x, s.y, w, w); ctx.fillStyle = own ? '#2f6fe0' : '#d93a2b'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
    txt(own ? '★' : '⚔', s.x, s.y + 2, c.cap ? 34 : 26, '#fff', 'center', 3);
    if (!own) { const [dw, dc] = dangerOf(c); txt(dw, s.x, s.y + w + 30, 15, dc, 'center', 3); }
    txt(c.name, s.x, s.y + w + 13, 16, '#fff', 'center', 4);
  }
  const hs = toUI(G.hero.x, 6, G.hero.z), bob = Math.sin(G.t * 5) * 5; ctx.beginPath(); ctx.moveTo(hs.x, hs.y + bob); ctx.lineTo(hs.x - 16, hs.y - 26 + bob); ctx.lineTo(hs.x + 16, hs.y - 26 + bob); ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke(); txt('YOU', hs.x, hs.y - 38 + bob, 20, '#fff', 'center', 4);
  if (G.target) { const t = toUI(G.target.x, 16, G.target.z); txt('▼', t.x, t.y + bob, 32, '#ffd23f'); }
  panel(18, 16, 730, 62, 24);
  txt('COINS ' + fmt(G.coins), 40, 48, 25, '#ffd23f', 'left'); txt('WOOD ' + fmt(G.wood), 240, 48, 25, '#8fd37a', 'left'); txt('STONE ' + fmt(G.stone), 390, 48, 25, '#dfe3ea', 'left'); txt('TROOPS ' + fmt(G.troops), 560, 48, 25, '#8ab4ff', 'left');
  panel(UW - 410, 16, 310, 62, 24); txt('TAKEN ' + (landsOwned() + G.cap.filter(Boolean).length) + ' OF ' + CASTLES.length, UW - 255, 48, 28, '#ffffff');
  hudBtn(B.close.x, B.close.y, B.close.r, () => { txt('✕', 0, 2, 34, OUT, 'center', 0); });
  const cw = UW - 400, cx = 30 + cw / 2, sel = M.sel; panel(30, UH - 138, cw, 122, 22);
  if (sel === KEEP) { txt('YOUR KEEP', cx, UH - 112, 26, '#ffd23f'); txt('Waves come while you are in Home Vale.', cx, UH - 74, 23, '#fff', 'center', 4); bigBtn(B.act, '#58c26a', '#2f8f43', 'GO HOME', 34); }
  else if (sel) {
    const own = isOurs(sel), R = REALMS[sel.r], pay = R.pay; txt(sel.name + '  ·  ' + R.name, cx, UH - 112, 26, '#ffd23f');
    if (own) { txt('Yours. Build up its town when you are there.', cx, UH - 77, 23, '#fff', 'center', 4); bigBtn(B.act, '#58c26a', '#2f8f43', 'GO THERE', 34); }
    else { const [dw, dc] = dangerOf(sel); txt('Danger: ' + dw + '. Walk up to it and the fight starts.', cx, UH - 77, 23, dc, 'center', 4); bigBtn(B.act, '#8a6cff', '#4f35b8', 'SHOW THE WAY', 28, 'an arrow will guide you'); }
    txt(pay ? 'Pays ' + pay + ' every wave, and opens a town.' : 'Closes this road and opens a town.', cx, UH - 45, 21, '#e8d5b5', 'center', 4);
  } else { const g = GOALS[G.goalI]; txt('Tap a castle. Clouds hide what you have not seen yet.', cx, UH - 96, 26, '#fff'); txt(g ? 'GOAL: ' + g.t : 'You rule the whole world!', cx, UH - 54, 24, '#ffd23f'); }
  ctx.globalAlpha = 1;
}
// small round map in the corner: every station near you, even ones behind buildings
const RAD = () => ({ x: 118, y: UH - 118, r: 100 });
function drawRadar() {
  const Rd = RAD(), h = G.hero, span = 95, k = Rd.r / span;
  ctx.save(); ell(ctx, Rd.x, Rd.y, Rd.r, Rd.r); ctx.clip();
  ctx.drawImage(MINI, (h.x - span - MX0) * MK, (h.z - span - MZ0) * MK, span * 2 * MK, span * 2 * MK, Rd.x - Rd.r, Rd.y - Rd.r, Rd.r * 2, Rd.r * 2);
  const P = (x, z) => [Rd.x + (x - h.x) * k, Rd.y + (z - h.z) * k];
  for (const p of G.pads) { if (!p.shown || p.lvl >= TYPES[p.type].max) continue; const sp = padSpot(p), [x, y] = P(sp.x, sp.z), can = G.coins + p.paid >= padCost(p); ell(ctx, x, y, can ? 6 : 3.5, can ? 6 : 3.5); ctx.fillStyle = can ? '#7dff8e' : '#ffffff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = OUT; ctx.stroke(); }
  for (const c of NODES) { const [x, y] = P(c.x, c.z); rr(ctx, x - 3, y - 3, 6, 6, 1); ctx.fillStyle = c.k === 'wood' ? '#2f8a4a' : '#8f887c'; ctx.fill(); }
  for (const c of CASTLES) { if (!isSeen(c.x, c.z)) continue; const [x, y] = P(c.x, c.z); ell(ctx, x, y, 8, 8); ctx.fillStyle = isOurs(c) ? '#2f6fe0' : '#d93a2b'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke(); }
  { const [x, y] = P(KEEP.x, KEEP.z); ell(ctx, x, y, 8, 8); ctx.fillStyle = '#2f6fe0'; ctx.fill(); ctx.stroke(); }
  ctx.restore();
  ell(ctx, Rd.x, Rd.y, Rd.r, Rd.r); ctx.lineWidth = 6; ctx.strokeStyle = OUT; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#f2e2c4'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(Rd.x, Rd.y - 8); ctx.lineTo(Rd.x - 6, Rd.y + 6); ctx.lineTo(Rd.x + 6, Rd.y + 6); ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
}
// a station a building hides still gets a little sign you can read
function drawHiddenPads() {
  const tall = [{ x: KEEP.x, z: KEEP.z, r: 9, h: 14 }]; for (const p of G.pads) if (p.lvl && p.type !== 'keep' && p.mesh) tall.push({ x: p.x, z: p.z, r: 3.2, h: 8 });
  for (const c of CASTLES) tall.push({ x: c.x, z: c.z, r: 6 * c.sz, h: 13 * c.sz });
  for (const p of G.pads) {
    if (!p.shown || p.appear < 1 || p.lvl >= TYPES[p.type].max || G.hero.padId === p.id) continue; const sp = padSpot(p), s = toUI(sp.x, 0, sp.z); if (!s.ok || s.x < 0 || s.x > UW || s.y < 0 || s.y > UH) continue;
    if (!tall.some(b => Math.abs(sp.x - b.x) < b.r && sp.z < b.z && b.z - sp.z < b.r + b.h * 0.5)) continue;
    const t = TYPES[p.type].name + ' ' + fmt(Math.max(0, padCost(p) - p.paid)), can = G.coins + p.paid >= padCost(p); ctx.font = '20px ' + FONT; const w = ctx.measureText(t).width + 26;
    rr(ctx, s.x - w / 2, s.y - 17, w, 34, 12); ctx.fillStyle = can ? 'rgba(40,120,60,0.95)' : 'rgba(30,50,35,0.92)'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke(); txt(t, s.x, s.y + 1, 20, '#fff', 'center', 3);
  }
}
function drawCompass() {
  const h = G.hero, g = GOALS[G.goalI], t = G.target || (g && g.at && g.at()); if (!t || h.dead > 0 || G.raid) return; const d = dist(h.x, h.z, t.x, t.z); if (d < 16) return;
  const s = toUI(h.x, 1, h.z), a = Math.atan2((t.z - h.z) * 0.9, t.x - h.x), r = 118 + Math.sin(G.t * 5) * 7;
  ctx.save(); ctx.translate(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.85); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(-12, -22); ctx.lineTo(-4, 0); ctx.lineTo(-12, 22); ctx.closePath(); ctx.fillStyle = G.target ? '#c9b6ff' : '#ffd23f'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke(); ctx.restore();
}
// goals: always one thing to go do next
const maxedCount = () => G.pads.filter(p => p.lvl >= TYPES[p.type].max).length;
const townPads = () => G.pads.filter(p => (p.fort !== undefined || p.land) && p.lvl).length;
const capOf = id => G.world[id] > 0;
const padAt = id => () => padSpot(G.padMap[id]);
const castleAt = id => () => CASTLES.find(c => c.id === id);
const nearestFoe = (list = CASTLES) => () => { const h = G.hero; return list.filter(c => !isOurs(c)).sort((a, b) => dist(a.x, a.z, h.x, h.z) - dist(b.x, b.z, h.x, h.z))[0]; };
const nearestNode = k => () => { const h = G.hero; return NODES.filter(n => n.k === k).sort((a, b) => dist(a.x, a.z, h.x, h.z) - dist(b.x, b.z, h.x, h.z))[0]; };
const firstTown = () => { const p = G.pads.find(p => (p.fort !== undefined || p.land) && p.shown && !p.lvl); return p ? padSpot(p) : null; };
const GOALS = [
  { t: 'Build your first tower', f: () => G.lv('t1') > 0, r: { coins: 20 }, at: padAt('t1') },
  { t: 'Clear wave 3', f: () => G.cleared >= 3, r: { coins: 40 } },
  { t: 'Stop by trees and gather 10 wood', f: () => G.wood >= 10, r: { stone: 10 }, at: nearestNode('wood') },
  { t: 'Build the WORKERS camp', f: () => G.lv('camp') > 0, r: { wood: 15 }, at: padAt('camp') },
  { t: 'Build the BANK', f: () => G.lv('bank') > 0, r: { coins: 60 }, at: padAt('bank') },
  { t: 'Build the MARKET', f: () => G.lv('market') > 0, r: { coins: 100 }, at: padAt('market') },
  { t: 'Invest 200 coins at the market', f: () => G.invest >= 200, r: { crowns: 2 }, at: () => INV_IN },
  { t: 'Open the world MAP', f: () => G.seenMap, r: { wood: 20, stone: 20 } },
  { t: 'Train up to 10 troops', f: () => G.troops >= 10, r: { crowns: 2 }, at: () => TRAIN_Z },
  { t: 'Clear wave 10', f: () => G.cleared >= 10, r: { coins: 300 } },
  { t: 'Have 3 workers', f: () => G.lv('camp') >= 3, r: { wood: 40, stone: 40 }, at: padAt('camp') },
  { t: 'Capture a castle', f: () => G.cap.some(Boolean), r: { crowns: 3 }, at: nearestFoe(FORTS) },
  { t: 'Build in your new castle town', f: () => townPads() >= 1, r: { troops: 10 }, at: firstTown },
  { t: 'Take a castle in the wild', f: () => landsOwned() >= 1, r: { crowns: 3 }, at: nearestFoe(LANDS) },
  { t: 'Max out one building', f: () => maxedCount() >= 1, r: { crowns: 3 } },
  { t: 'Clear wave 20', f: () => G.cleared >= 20, r: { coins: 1000 } },
  { t: 'Build 5 things in castle towns', f: () => townPads() >= 5, r: { troops: 25 }, at: firstTown },
  { t: 'Capture all 4 home castles', f: () => G.cap.every(Boolean), r: { crowns: 8 }, at: nearestFoe(FORTS) },
  { t: 'Take the Forest Capital', f: () => capOf('fc'), r: { crowns: 5 }, at: castleAt('fc') },
  { t: 'Max out 5 buildings', f: () => maxedCount() >= 5, r: { crowns: 6 } },
  { t: 'Take 8 castles in the wild', f: () => landsOwned() >= 8, r: { troops: 50 }, at: nearestFoe(LANDS) },
  { t: 'Take the Desert Capital', f: () => capOf('dc'), r: { crowns: 8 }, at: castleAt('dc') },
  { t: 'Clear wave 30', f: () => G.cleared >= 30, r: { coins: 5000 } },
  { t: 'Take the Frost Capital', f: () => capOf('ic'), r: { crowns: 10 }, at: castleAt('ic') },
  { t: 'Max out 12 buildings', f: () => maxedCount() >= 12, r: { crowns: 12 } },
  { t: 'Clear wave 40', f: () => G.cleared >= 40, r: { coins: 20000 } },
  { t: 'Find 12 treasure chests', f: () => G.chests.length >= 12, r: { crowns: 15 } },
  { t: "Beat the Emperor's Throne", f: () => capOf('xc'), r: { crowns: 50 }, at: castleAt('xc') },
];
const rewardText = r => Object.keys(r).map(k => '+' + fmt(r[k]) + ' ' + k).join(' ');
function checkGoals() {
  const g = GOALS[G.goalI]; if (!g || G.state !== 'play' || !g.f()) return;
  const r = g.r; G.goalI++;
  if (r.coins) dropCoins(G.hero.x, G.hero.z, r.coins); if (r.wood) G.wood += r.wood; if (r.stone) G.stone += r.stone; if (r.troops) G.troops += r.troops; if (r.crowns) META.crowns += r.crowns;
  toast('GOAL DONE! ' + rewardText(r), '#ffd23f'); AU.play('clear'); saveMeta();
  if (!GOALS[G.goalI]) banner('YOU RULE THE WORLD!', 'The Emperor is beaten', '#ffd23f', 4);
}
// bot: spends wood and stone on troops, and walks out to castles it can beat
function botWorld() { while (trainTroops()); }
const botCastle = () => { const h = G.hero; if (G.waveState !== 'prep' || h.hp < h.maxHp * 0.5) return null; return CASTLES.filter(c => !isOurs(c) && c.pw <= G.cleared + 1).sort((a, b) => dist(a.x, a.z, h.x, h.z) - dist(b.x, b.z, h.x, h.z))[0]; };

// bot for ?auto / ?sim: buy the cheapest thing, otherwise fight at the front and grab coins
const BOTLOG = [];
function aiMove(dt) {
  const h = G.hero; G.aiT -= dt;
  if (G.raid && G.raid.f.pw <= G.cleared + 2 && G.waveState === 'prep') { const e = nearestIn(h.x, h.z, 60) || G.raid.e; if (!e) return { x: 0, z: 0 }; const dx = e.x - h.x, dz = e.z - h.z, d = Math.hypot(dx, dz) || 1; return d < 1 ? { x: 0, z: 0 } : { x: dx / d, z: dz / d }; }
  if (G.aiT <= 0 || !G.aiGoal) {
    G.aiT = 0.35;
    const keep = G.padMap.keep; let goal = null, bc = 1e18;
    for (const p of G.pads) {
      if (!p.shown || p.appear < 1 || p.lvl >= TYPES[p.type].max) continue;
      let c = padCost(p) - p.paid; if (p.type === 'keep' && keep.hp < keep.maxHp * 0.45) c *= 0.3; if (p.type === 'armor' && h.hp < h.maxHp * 0.4) c *= 0.6;
      if (c < bc) { bc = c; goal = p; }
    }
    if (goal && G.coins >= bc) { const s = padSpot(goal); G.aiGoal = { x: s.x, z: s.z }; }
    else {
      let c = null, cd = 1e9; for (const k of G.loot) { if (k.st !== 1) continue; const d = dist(k.x, k.z, h.x, h.z); if (d < cd) { cd = d; c = k; } }
      const front = firstIn(KEEP.x, KEEP.z, 140);
      const bc2 = botCastle();
      if (c && cd < 12) G.aiGoal = { x: c.x, z: c.z };
      else if (bc2) G.aiGoal = { x: bc2.x, z: bc2.z };
      else if (front && h.hp > h.maxHp * 0.35) G.aiGoal = { x: front.x - Math.cos(pathPos(front.p, front.s).ang) * 1.6, z: front.z - Math.sin(pathPos(front.p, front.s).ang) * 1.6 };
      else if (c) G.aiGoal = { x: c.x, z: c.z };
      else G.aiGoal = { x: wx(24), z: wz(24) };
    }
  }
  const dx = G.aiGoal.x - h.x, dz = G.aiGoal.z - h.z, d = Math.hypot(dx, dz);
  return d < 0.9 ? { x: 0, z: 0 } : { x: dx / d, z: dz / d };
}

// ================= rendering =================
let DPR = 1, CW = 0, CH = 0, S = 1, UW = 1600, UH = 900, portrait = false, quality = 1;
function resize() {
  const iw = innerWidth || 1024, ih = innerHeight || 768;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(Math.min(DPR, quality > 0 ? 1.6 : 1)); renderer.setSize(iw, ih, false);
  glc.style.width = uic.style.width = iw + 'px'; glc.style.height = uic.style.height = ih + 'px';
  CW = Math.round(iw * DPR); CH = Math.round(ih * DPR); uic.width = CW; uic.height = CH;
  S = Math.min(CW / 1600, CH / 900) * 1.0; UW = CW / S; UH = CH / S;
  camera.aspect = iw / ih; camera.fov = iw / ih < 1.4 ? 46 : 40; camera.updateProjectionMatrix();
  portrait = ih > iw * 1.05;
}
const _proj = new THREE.Vector3();
function toUI(x, y, z) { _proj.set(x, y, z).project(camera); return { x: (_proj.x * 0.5 + 0.5) * UW, y: (-_proj.y * 0.5 + 0.5) * UH, ok: _proj.z < 1 && Math.abs(_proj.x) < 1.2 && Math.abs(_proj.y) < 1.2 }; }

function syncScene(rdt) {
  const h = G.hero;
  // camera follows hero (title: slow orbit around the keep)
  if (G.state === 'title') {
    const a = G.t * 0.12; if (camera.near !== 4 || camera.far !== 420) { camera.near = 4; camera.far = 420; camera.updateProjectionMatrix(); } scene.fog.near = 100; scene.fog.far = 210; camera.position.set(KEEP.x + 14 + Math.cos(a) * 34, 32, KEEP.z + Math.sin(a) * 34); camera.lookAt(KEEP.x + 14, 0, KEEP.z);
  } else {
    const tx = clamp(h.x, 25, MAPW - 25), tz = clamp(h.z, 15, MAPH - 15);
    G.cam.x = lerp(G.cam.x, tx, Math.min(1, rdt * 4)); G.cam.z = lerp(G.cam.z, tz, Math.min(1, rdt * 4));
    const sh = G.shake > 0.02 ? G.shake : 0, f = G.map ? easeInOut(G.map.k) : 0, V = mapView();
    // high, steep camera so buildings hide less; MAP lifts it up over the whole world
    camera.position.set(lerp(G.cam.x, MAPW / 2, f) + rnd(-sh, sh) * 0.4, lerp(54, V.y, f) + rnd(-sh, sh) * 0.4, lerp(G.cam.z + 24, MAPH / 2 + V.z, f));
    camera.lookAt(lerp(G.cam.x, MAPW / 2, f), 0, lerp(G.cam.z + 1.5, MAPH / 2, f));
    const fnear = f > 0.2 ? 60 : 4, ffar = f > 0.01 ? 3200 : 420; if (camera.near !== fnear || camera.far !== ffar) { camera.near = fnear; camera.far = ffar; camera.updateProjectionMatrix(); }
    scene.fog.near = lerp(100, 2600, f); scene.fog.far = lerp(210, 3200, f);
  }
  const wide = G.state !== 'title' && G.map && G.map.k > 0.5, sc = sun.shadow.camera;
  if (wide !== !!G.sunWide) { G.sunWide = wide; const w = wide ? 400 : 62, hh = wide ? 300 : 52; sc.left = -w; sc.right = w; sc.top = hh; sc.bottom = -hh; sc.far = wide ? 900 : 220; sc.updateProjectionMatrix(); }
  if (wide) { sun.position.set(MAPW / 2 - 110, 300, MAPH / 2 - 160); sun.target.position.set(MAPW / 2, 0, MAPH / 2); }
  else { const cx = G.state === 'title' ? KEEP.x + 14 : G.cam.x, cz = G.state === 'title' ? KEEP.z : G.cam.z; sun.position.set(cx - 30, 85, cz - 40); sun.target.position.set(cx, 0, cz); }
  // hero
  const hs = heroStats(), H = hero3;
  H.g.visible = true; H.g.position.set(h.x, 0, h.z);
  if (h.dead > 0) { H.g.rotation.set(0, h.face, -Math.PI / 2 * Math.min(1, (2.5 - h.dead) * 4)); H.g.position.y = 0.3; }
  else { H.g.rotation.set(0, h.face, 0); H.g.position.y = h.moving ? Math.abs(Math.sin(h.walk)) * 0.12 : 0; }
  const la = h.moving ? Math.sin(h.walk) * 0.8 : 0; H.legL.rotation.x = la; H.legR.rotation.x = -la;
  H.body.rotation.x = h.moving ? 0.12 : 0;
  H.capeP.rotation.x = 0.2 + Math.min(0.9, Math.hypot(h.vx, h.vz) * 0.08) + Math.sin(G.t * 9) * 0.05;
  H.swordArm.rotation.x = h.swing > 0 ? -2.6 + (1 - h.swing) * 3.6 : -0.3 + Math.sin(G.t * 2) * 0.05;
  H.swordArm.rotation.z = h.swing > 0 ? -0.5 : 0;
  H.blade.material = mat(G.lv('sword') >= 10 ? '#ffd23f' : G.lv('sword') >= 5 ? '#bfe3ff' : '#eef2f7');
  H.ring.material.opacity = 0.45 + Math.sin(G.t * 4) * 0.2; H.ring.material.color.set(G.fury > 0 ? '#ff8a3d' : '#7cc8ff');
  // crowds
  foes.begin(); let si = 0;
  for (const e of G.enemies) {
    if (e.stat) continue;
    const atkLean = e.swing > 0 ? Math.sin(e.swing * Math.PI) * 0.25 : 0;
    const bob = e.walk ? Math.abs(Math.sin(e.walk)) * 0.08 * e.T.sc : 0;
    foes.add(e.x, bob, e.z, e.yaw, e.T.sc, e.walk, e.swing > 0 ? Math.sin((1 - e.swing) * Math.PI) : 0, e.T.pal, e.flash > 0, atkLean);
    if (si < 700) { _o.position.set(e.x, 0.06, e.z); _o.rotation.set(0, 0, 0); _o.scale.setScalar(e.T.sc * 1.3); _o.updateMatrix(); shadowMesh.setMatrixAt(si++, _o.matrix); }
  }
  foes.end();
  allies.begin();
  for (const f of G.followers) allies.add(f.x, 0, f.z, f.yaw, 0.85, f.walk, f.swing > 0 ? 0.3 : 0, ALLY_PAL.follower, false);
  for (const w of G.workers) allies.add(w.x, 0, w.z, w.yaw, 0.75, w.walk, 0, ALLY_PAL.follower, false);
  for (const k of G.soldiers) if (k.alive) allies.add(k.x, 0, k.z, k.yaw, 1.0, k.walk, k.swing > 0 ? Math.sin((1 - k.swing) * Math.PI) : 0, ALLY_PAL.soldier, false);
  allies.end();
  shadowMesh.count = si; shadowMesh.instanceMatrix.needsUpdate = true;
  // structures: pop, aim, idle anims
  for (const p of G.pads) {
    if (p.mesh) {
      const pop = p.pop > 0 ? easeBack(1 - p.pop) : 1;
      const base = p.type === 'keep' ? 1 + Math.min(p.lvl, 15) * 0.02 : 1;
      if (!p.broken) p.mesh.scale.set(base * (p.pop > 0 ? lerp(1.15, 1, 1 - p.pop) : 1), base * pop, base * (p.pop > 0 ? lerp(1.15, 1, 1 - p.pop) : 1));
      const u = p.mesh.userData;
      if (u.turret) u.turret.rotation.y = lerp(u.turret.rotation.y, p.aim, 0.25);
      if (u.orb) u.orb.position.y = u.muzzle + Math.sin(G.t * 3) * 0.2;
      if (u.spin) u.spin.rotation.y = G.t * 1.2;
      p.mesh.visible = p.lvl > 0;
    }
    // pad decal
    const show = p.shown && p.lvl < TYPES[p.type].max && !(p.type === 'wall' && p.broken) && G.state !== 'title';
    if (show && !p.padMesh) makePad(p);
    if (p.padMesh) p.padMesh.visible = show && p.appear > 0;
    if (show) {
      const s = padSpot(p), cost = padCost(p), can = G.coins + p.paid >= cost, on = G.hero.padId === p.id;
      p.padMesh.position.set(s.x, 0.07 + (on ? 0.02 : 0), s.z);
      const sc = (p.appear < 1 ? easeBack(p.appear) : 1) * (can ? 1 + Math.sin(G.t * 5 + p.x) * 0.035 : 1) * (on ? 1.06 : 1);
      p.padMesh.scale.setScalar(Math.max(0.01, sc));
      drawPad(p, can);
    }
  }
  const bankOn = G.lv('bank') > 0 && G.state !== 'title';
  for (const z of bankZones) { z.m.visible = bankOn; if (bankOn) drawZone(z, G.bank, 'of ' + fmt(towerStats(G.padMap.bank).cap)); }
  const invOn = G.lv('market') > 0 && G.state !== 'title';
  for (const z of investZones) { z.m.visible = invOn; if (invOn) drawZone(z, G.invest, '+' + towerStats(G.padMap.market).rate + '% a wave'); }
  trainZone.m.visible = !!G.bkTop && G.state !== 'title'; if (trainZone.m.visible) drawZone(trainZone, G.troops, TRAIN.wood + ' wood ' + TRAIN.stone + ' stone');
  // range ring for the tower you're standing on
  const rp = G.rangeOf; rangeRing.visible = !!(rp && towerStats(rp).range);
  if (rangeRing.visible) { const r = towerStats(rp).range; rangeRing.position.set(rp.x, 0.09, rp.z); rangeRing.scale.setScalar(r); }
  // incoming-path arrows during the break
  PATHS.forEach((p, i) => { const g = warnArrows[i]; const on = G.state === 'play' && G.waveState === 'prep' && !G.raid && G.preview && G.preview.paths.includes(p) && (G.tut >= 3 || G.wave > 0); g.visible = on; if (on) { const q = pathPos(p, p.start + 5 + (G.t * 6) % 3); g.position.set(q.x, 0.1, q.z); g.rotation.y = -q.ang - Math.PI / 2 + Math.PI; } });
  // coins: ground/flying + the stack on the hero's back
  let ci = 0;
  for (const c of G.loot) { if (ci >= 1700) break; _o.position.set(c.x, c.y + (c.st === 1 ? 0.12 + Math.sin(G.t * 3 + c.spin) * 0.06 : 0), c.z); _o.rotation.set(c.st === 1 ? 0.25 : c.spin, c.spin * 0.5, 0); _o.scale.setScalar(c.v > 1 ? 1.4 : 1); _o.updateMatrix(); coinMesh.setMatrixAt(ci++, _o.matrix); }
  for (const d of G.drops) { const k = d.k; _o.position.set(lerp(d.sx, d.tx, k), lerp(d.sy, 0.1, k) + Math.sin(Math.PI * k) * 2, lerp(d.sz, d.tz, k)); _o.rotation.set(k * 9, 0, 0); _o.scale.setScalar(1); _o.updateMatrix(); coinMesh.setMatrixAt(ci++, _o.matrix); }
  if (h.dead <= 0) {
    const n = Math.min(Math.floor(G.coins), 160), cols = n > 100 ? 4 : n > 50 ? 3 : n > 20 ? 2 : 1, per = Math.ceil(n / cols);
    const fy = Math.sin(h.face), fz = Math.cos(h.face), rx = Math.cos(h.face), rz = -Math.sin(h.face), bob = H.g.position.y;
    for (let i = 0; i < n && ci < 1800; i++) {
      const cI = Math.floor(i / per), row = i % per, hgt = 1.25 + row * 0.095, sway = Math.pow(row / 40, 1.6);
      const lx = (cI - (cols - 1) / 2) * 0.58, back = -0.75 - (cols > 2 ? 0.1 : 0);
      _o.position.set(h.x + rx * lx + fy * back + h.lagX * sway * 6, hgt + bob, h.z + rz * lx + fz * back + h.lagZ * sway * 6);
      _o.rotation.set(0, h.face + row * 0.3, 0); _o.scale.setScalar(1); _o.updateMatrix(); coinMesh.setMatrixAt(ci++, _o.matrix);
    }
  }
  coinMesh.count = ci; coinMesh.instanceMatrix.needsUpdate = true;
  // projectiles
  let ai = 0;
  for (const a of G.arrows) { _o.position.set(a.x, a.y, a.z); _v.set(a.x * 2 - a.px, a.y * 2 - a.py, a.z * 2 - a.pz); _o.scale.setScalar(1); _o.lookAt(_v); _o.updateMatrix(); arrowMesh.setMatrixAt(ai++, _o.matrix); }
  arrowMesh.count = ai; arrowMesh.instanceMatrix.needsUpdate = true;
  let bi = 0; for (const b of G.bolts) { _o.position.set(b.x, b.y, b.z); _v.set(b.x + b.vx, b.y, b.z + b.vz); _o.lookAt(_v); _o.updateMatrix(); boltMesh.setMatrixAt(bi++, _o.matrix); }
  boltMesh.count = bi; boltMesh.instanceMatrix.needsUpdate = true;
  let bb = 0; for (const s of G.balls) { if (s.k < 0) continue; const k = s.k; _o.position.set(lerp(s.sx, s.tx, k), lerp(s.sy, 0.3, k) + Math.sin(Math.PI * k) * 5, lerp(s.sz, s.tz, k)); _o.rotation.set(0, 0, 0); _o.scale.setScalar(0.6); _o.updateMatrix(); ballMesh.setMatrixAt(bb++, _o.matrix); }
  ballMesh.count = bb; ballMesh.instanceMatrix.needsUpdate = true;
  let zi = 0; const Rz = seeded(1);
  for (const z of G.zaps) {
    for (let i = 1; i < z.pts.length; i++) {
      const [x0, y0, z0] = z.pts[i - 1], [x1, y1, z1] = z.pts[i]; let px = x0, py = y0, pz = z0;
      for (let j = 1; j <= 4 && zi < 250; j++) {
        const t = j / 4, jx = j < 4 ? (Math.random() - 0.5) * 1.2 : 0, jy = j < 4 ? (Math.random() - 0.5) * 1.2 : 0;
        const nx = lerp(x0, x1, t) + jx, ny = lerp(y0, y1, t) + jy, nz = lerp(z0, z1, t) + jx * 0.5;
        const len = Math.hypot(nx - px, ny - py, nz - pz); _o.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2); _o.scale.set(0.12, 0.12, len); _v.set(nx, ny, nz); _o.lookAt(_v); _o.updateMatrix(); zapMesh.setMatrixAt(zi++, _o.matrix);
        px = nx; py = ny; pz = nz;
      }
    }
  }
  zapMesh.count = zi; zapMesh.instanceMatrix.needsUpdate = true;
  // particles
  let di = 0; for (const p of G.parts) { const f = p.life / p.max; _o.position.set(p.x, p.y, p.z); _o.rotation.set(p.rx, p.ry, 0); _o.scale.setScalar(p.size * Math.min(1, f * 2)); _o.updateMatrix(); debris.setMatrixAt(di, _o.matrix); debris.setColorAt(di++, p.c); }
  debris.count = di; debris.instanceMatrix.needsUpdate = true; if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
  let pu = 0; for (const p of G.puffs) { const f = p.life / p.max; _o.position.set(p.x, p.y, p.z); _o.rotation.set(0, 0, 0); _o.scale.setScalar(p.size * (1.5 - f * 0.6) * Math.min(1, f * 3)); _o.updateMatrix(); puffs.setMatrixAt(pu, _o.matrix); puffs.setColorAt(pu++, p.c); }
  puffs.count = pu; puffs.instanceMatrix.needsUpdate = true; if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true;
  for (const r of ringPool) { if (r.life <= 0) { r.m.visible = false; continue; } const f = r.life / r.max; r.m.scale.setScalar(lerp(r.r, r.r * 0.2, f)); r.m.material.opacity = f * 0.9; }
}

// ---------------- 2D overlay ----------------
function txt(s, x, y, size, fill, align = 'center', sw) {
  ctx.font = size + 'px ' + FONT; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = sw ?? Math.max(3, size * 0.2); ctx.strokeStyle = OUT; ctx.strokeText(s, x, y); ctx.fillStyle = fill; ctx.fillText(s, x, y);
}
function bar(x, y, w, h, f, c, bg = 'rgba(0,0,0,0.55)') {
  rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
  if (f > 0) { rr(ctx, x + 2, y + 2, Math.max(h - 4, (w - 4) * clamp(f, 0, 1)), h - 4, (h - 4) / 2); ctx.fillStyle = c; ctx.fill(); }
  rr(ctx, x, y, w, h, h / 2); ctx.lineWidth = 2.5; ctx.strokeStyle = OUT; ctx.stroke();
}
function panel(x, y, w, h, r = 20) { rr(ctx, x, y, w, h, r); ctx.fillStyle = 'rgba(30,20,12,0.82)'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = OUT; ctx.stroke(); }
function drawHand(x, y, sc = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.rotate(-0.35); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.lineJoin = 'round';
  rr(ctx, -9, -4, 18, 44, 9); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); rr(ctx, -20, 24, 44, 40, 16); ctx.fill(); ctx.stroke(); ctx.restore();
}
function hudBtn(x, y, r, draw, on = true) {
  ell(ctx, x, y + 3, r, r); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  ell(ctx, x, y, r, r); ctx.fillStyle = on ? '#f2e2c4' : '#9c8d76'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.save(); ctx.translate(x, y); draw(); ctx.restore();
}
const HUDB = () => ({ pause: { x: UW - 50, y: 48, r: 32 }, sound: { x: UW - 124, y: 48, r: 32 }, map: { x: UW - 215, y: 48, w: 110, h: 60 }, go: { x: UW / 2, y: UH - 70, w: 300, h: 70 }, raid: { x: UW / 2 + 340, y: UH - 70, w: 340, h: 70 } });
function bigBtn(b, top, bot, label, size, sub) {
  const pulse = 1 + Math.sin(G.t * 6) * 0.04; ctx.save(); ctx.translate(b.x, b.y); ctx.scale(pulse, pulse);
  rr(ctx, -b.w / 2, -b.h / 2 + 5, b.w, b.h, 24); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  rr(ctx, -b.w / 2, -b.h / 2, b.w, b.h, 24); const gr = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2); gr.addColorStop(0, top); gr.addColorStop(1, bot); ctx.fillStyle = gr; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
  txt(label, 0, sub ? -11 : 2, size, '#fff'); if (sub) txt(sub, 0, 20, 19, '#ffe9c9', 'center', 3); ctx.restore();
}
// what the pad you're standing on does, in plain words
function padInfo(p) {
  const n = p.lvl, a = { ...p, lvl: Math.max(1, n) }, b = { ...p, lvl: n + 1 }, sa = towerStats(a), sb = towerStats(b), up = (l, x, y) => l + ': ' + (n ? fmt(x) + ' → ' : '') + fmt(y);
  const pw = 20 * (1 + 0.12 * META.power);
  switch (p.type) {
    case 'keep': return ['Your castle. If it falls, you go back to your last checkpoint.', up('Health', keepMax(n), keepMax(n + 1))];
    case 'archer': return ['Shoots arrows at enemies on the road.', up('Damage', sa.dmg, sb.dmg)];
    case 'wall': return ['Blocks the road. Enemies stop to break it.', up('Health', sa.hp, sb.hp)];
    case 'sword': return ['Your hero hits harder and a bit faster.', up('Damage', pw * Math.pow(1.3, n), pw * Math.pow(1.3, n + 1))];
    case 'armor': return ['Your hero can take more hits.', up('Health', 140 * Math.pow(1.28, n), 140 * Math.pow(1.28, n + 1))];
    case 'boots': return ['Your hero runs faster and grabs coins from farther away.', up('Speed', 8.8 + 0.4 * n, 8.8 + 0.4 * (n + 1))];
    case 'recruit': return ['Archers who follow you and shoot what is near you.', up('Archers', n, n + 1)];
    case 'cannon': return ['Slow, big blast that hits a whole group.', up('Damage', sa.dmg, sb.dmg)];
    case 'ballista': return ['Long shot that goes through a whole line.', up('Damage', sa.dmg, sb.dmg)];
    case 'mine': return ['Pays you extra coins after every wave.', up('Pay', sa.pay, sb.pay)];
    case 'barracks': return ['Soldiers fight for you and walk with you when you explore.', up('Soldiers', sa.n, sb.n)];
    case 'mage': return ['Lightning that jumps from enemy to enemy.', up('Damage', sa.dmg, sb.dmg)];
    case 'bank': return ['Safe when you lose, but it only grows ' + sb.rate + '% a wave.', up('Holds', sa.cap, sb.cap)];
    case 'market': return ['Invest coins. They grow on their growth, with no limit. Lose a fight: -25%.', up('Growth a wave %', sa.rate, sb.rate)];
    case 'camp': return ['Workers walk out and bring back wood and stone by themselves.', up('Workers', n, n + 1)];
    case 'lumber': return ['Brings wood after every wave.', up('Wood', sa.pay, sb.pay)];
    case 'quarry': return ['Brings stone after every wave.', up('Stone', sa.pay, sb.pay)];
  }
  return ['', ''];
}
function drawUI() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, CW, CH); ctx.setTransform(S, 0, 0, S, 0, 0);
  if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + G.flash * 0.35 + ')'; ctx.fillRect(0, 0, UW, UH); }
  if (G.state === 'title') return drawTitle();
  if (G.map) { drawMap(); if (portrait) { ctx.fillStyle = 'rgba(20,12,6,0.94)'; ctx.fillRect(0, 0, UW, UH); txt('Turn your tablet sideways', UW / 2, UH / 2, 56, '#ffd23f'); } return; }
  const h = G.hero;
  // world-anchored: health bars, numbers
  for (const e of G.enemies) {
    if (e.t === 'boss' || e.stat) { const s = toUI(e.x, 2.4 * e.T.sc, e.z); if (s.ok) bar(s.x - 60, s.y, 120, 14, e.hp / e.max, '#ff4d3d'); continue; }
    if (e.hp < e.max) { const s = toUI(e.x, 2.0 * e.T.sc, e.z); if (s.ok) bar(s.x - 22 * e.T.sc, s.y, 44 * e.T.sc, 8, e.hp / e.max, '#ff4d3d'); }
  }
  for (const k of G.soldiers) if (k.alive && k.hp < k.max) { const s = toUI(k.x, 2.1, k.z); if (s.ok) bar(s.x - 20, s.y, 40, 7, k.hp / k.max, '#62c6ff'); }
  for (const p of G.pads) if (p.type === 'wall' && p.lvl && !p.broken && p.hp < p.maxHp) { const s = toUI(p.x, 3.4, p.z); if (s.ok) bar(s.x - 45, s.y, 90, 12, p.hp / p.maxHp, '#7ee081'); }
  const kp = G.padMap.keep; if (kp.hp < kp.maxHp) { const s = toUI(KEEP.x, 9, KEEP.z); if (s.ok) bar(s.x - 80, s.y, 160, 16, kp.hp / kp.maxHp, kp.hp / kp.maxHp < 0.3 ? '#ff4d3d' : '#7ee081'); }
  if (h.dead <= 0 && h.hp < h.maxHp) { const s = toUI(h.x, 3.0, h.z); if (s.ok) bar(s.x - 36, s.y, 72, 11, h.hp / h.maxHp, h.hp / h.maxHp < 0.3 ? '#ff4d3d' : '#62e07e'); }
  for (const n of G.nums) { const s = toUI(n.x, n.y, n.z); if (!s.ok) continue; ctx.globalAlpha = Math.min(1, n.life * 3); txt(n.v, s.x, s.y, n.size * (n.life > 0.6 ? 1 + (n.life - 0.6) * 2 : 1), n.c); }
  ctx.globalAlpha = 1;
  for (const n of NODES) { if (dist(n.x, n.z, h.x, h.z) > 50) continue; const s = toUI(n.x, 7, n.z); if (s.ok) txt(n.k === 'wood' ? 'WOOD' : 'STONE', s.x, s.y, 22, n.k === 'wood' ? '#8fd37a' : '#dfe3ea'); }
  for (const f of CASTLES) { if (G.raid && G.raid.f === f) continue; if (Math.abs(f.x - h.x) > 70 || Math.abs(f.z - h.z) > 60) continue; const s = toUI(f.x, 14 * f.sz, f.z); if (!s.ok) continue; if (isOurs(f)) txt(f.name + ' · YOURS', s.x, s.y, 22, '#7ee081'); else { const [dw, dc] = dangerOf(f); txt(f.name, s.x, s.y - 14, 24, '#ffd9cf'); txt(dw, s.x, s.y + 12, 22, dc); } }
  drawHiddenPads();
  if (G.state === 'play') drawCompass();
  // off-screen pads you can afford
  const cheap = G.pads.filter(p => p.shown && p.lvl < TYPES[p.type].max && G.coins + p.paid >= padCost(p)).sort((a, b) => padCost(a) - padCost(b)).slice(0, 2);
  for (const p of cheap) {
    const sp = padSpot(p), s = toUI(sp.x, 0, sp.z); if (s.ok && s.x > 30 && s.x < UW - 30 && s.y > 30 && s.y < UH - 30) continue;
    const cx = UW / 2, cy = UH / 2, a = Math.atan2(s.y - cy, s.x - cx), ex = clamp(cx + Math.cos(a) * UW, 60, UW - 60), ey = clamp(cy + Math.sin(a) * UH, 140, UH - 60);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-8, -18); ctx.lineTo(-8, 18); ctx.closePath(); ctx.fillStyle = '#7ee081'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = OUT; ctx.stroke(); ctx.restore();
  }
  if (G.combo >= 3 && h.dead <= 0) { const s = toUI(h.x, 3.6, h.z); if (s.ok) { ctx.globalAlpha = Math.min(1, G.comboT * 2); txt('x' + G.combo, s.x, s.y - 20, 40 * (1 + G.comboPop * 0.4), G.combo >= 20 ? '#ff6b4a' : '#ffb13d'); txt('COMBO', s.x, s.y + 12, 18, '#ffffff'); ctx.globalAlpha = 1; } }
  // tutorial
  if (G.state === 'play') drawTutorial();
  // HUD
  const pul = 1 + G.coinPulse * 0.12;
  panel(18, 16, 250, 64, 32);
  ctx.save(); ctx.translate(52, 48); ctx.scale(pul, pul); coinIcon(ctx, 0, 0, 21, G.t * 1.5); ctx.restore();
  txt(fmt(G.coins), 84, 49, 40 * pul, '#ffd23f', 'left');
  panel(18, 90, 250, 40, 20); txt('♜', 42, 110, 24, '#e8e0d0');
  bar(62, 100, 194, 20, kp.hp / kp.maxHp, kp.hp / kp.maxHp < 0.3 ? '#ff4d3d' : '#7ee081'); txt(fmt(Math.max(0, kp.hp)), 159, 110, 16, '#fff');
  let ly = 138;
  if (G.lv('bank')) { panel(18, ly, 250, 36, 18); coinIcon(ctx, 42, ly + 18, 12); txt('BANK ' + fmt(G.bank) + ' / ' + fmt(towerStats(G.padMap.bank).cap), 62, ly + 19, 20, '#ffd23f', 'left'); ly += 44; }
  if (G.lv('market')) { panel(18, ly, 250, 36, 18); txt('INVESTED ' + fmt(G.invest), 143, ly + 19, 20, '#b99cff'); ly += 44; }
  panel(18, ly, 250, 36, 18); txt('WOOD ' + fmt(G.wood), 28, ly + 19, 19, '#8fd37a', 'left'); txt('STONE ' + fmt(G.stone), 128, ly + 19, 19, '#dfe3ea', 'left'); ly += 44;
  panel(18, ly, 250, 36, 18); txt('TROOPS ' + fmt(G.troops), 143, ly + 19, 20, '#8ab4ff'); ly += 44;
  if (G.checkpoint) { panel(18, ly, 250, 36, 18); txt('SAFE AT WAVE ' + G.checkpoint, 143, ly + 19, 20, '#7ee081'); ly += 44; }
  const wx = UW / 2; panel(wx - 170, 14, 340, 80, 22);
  txt(G.raid ? 'ATTACK!' : G.wave ? 'WAVE ' + G.wave : 'GET READY', wx, 40, 34, G.raid ? '#ff8a7a' : '#ffffff');
  if (G.waveState === 'fight') bar(wx - 140, 62, 280, 18, G.waveTotal ? G.waveDone / G.waveTotal : 0, '#ffb13d'); else bar(wx - 140, 62, 280, 18, 1, '#7ee081');
  const B = HUDB();
  drawRadar();
  { rr(ctx, B.map.x - 55, B.map.y - 30, 110, 60, 22); ctx.fillStyle = '#58c26a'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = OUT; ctx.stroke(); txt('MAP', B.map.x, B.map.y + 2, 28, '#fff'); }
  { const g = GOALS[G.goalI]; if (g) { const gx = UW - 410; panel(gx, 88, 392, 66, 18); txt('GOAL: ' + g.t, gx + 196, 109, g.t.length > 26 ? 18 : 22, '#ffd23f', 'center', 4); txt('Reward: ' + rewardText(g.r), gx + 196, 135, 18, '#ffffff', 'center', 3); } }
  hudBtn(B.pause.x, B.pause.y, B.pause.r, () => { ctx.fillStyle = OUT; rr(ctx, -10, -12, 7, 24, 2); ctx.fill(); rr(ctx, 3, -12, 7, 24, 2); ctx.fill(); });
  hudBtn(B.sound.x, B.sound.y, B.sound.r, () => { ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-5, -5); ctx.lineTo(3, -13); ctx.lineTo(3, 13); ctx.lineTo(-5, 5); ctx.lineTo(-12, 5); ctx.closePath(); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.beginPath(); if (AU.muted) { ctx.moveTo(7, -7); ctx.lineTo(15, 7); ctx.moveTo(15, -7); ctx.lineTo(7, 7); } else ctx.arc(4, 0, 9, -0.8, 0.8); ctx.stroke(); }, !AU.muted);
  // next wave card: what's coming + GO
  if (G.waveState === 'prep' && G.state === 'play' && !G.raid && (G.tut >= 3 || G.wave > 0) && G.preview) {
    const c = G.preview.counts, parts = Object.keys(c).filter(k => k !== 'imp').map(k => (k === 'boss' ? '⚠ ' : c[k] + ' ') + ENAMES[k]);
    panel(wx - 300, 104, 600, 50, 18); txt('NEXT: ' + parts.join('  ·  '), wx, 129, 24, '#ffd9cf');
    bigBtn(B.go, '#ff7a45', '#d6402a', 'FIGHT! (' + Math.ceil(G.next) + ')', 36);
    if (G.away) { panel(wx - 300, 160, 600, 46, 16); txt('Exploring: waves wait until you go home', wx, 183, 24, '#ffffff'); }
  }
  if (G.raid && G.raid.endT === null && G.state === 'play') bigBtn(B.go, '#6b7890', '#3f4a60', 'RUN HOME', 34);
  if (G.state === 'play' && !G.raid && G.hero.padId && G.padMap[G.hero.padId]) {
    const p = G.padMap[G.hero.padId], [l1, l2] = padInfo(p);
    panel(wx - 400, 212, 800, 74, 18); txt(TYPES[p.type].name + ' — ' + l1, wx, 236, 23, TYPES[p.type].col, 'center', 4); txt(l2 + (G.hero.moving ? '   ·   STOP HERE TO BUY' : ''), wx, 265, 22, '#ffffff', 'center', 4);
  }
  if (G.bossRef && G.bossRef.alive) { txt(G.bossRef.stat ? G.raid.f.name : 'WARLORD', wx, 114, 22, '#ff8a7a'); bar(wx - 220, 128, 440, 22, G.bossRef.hp / G.bossRef.max, '#ff4d3d'); }
  G.toasts.forEach((t, i) => { const a = Math.min(1, t.life * 2), y = UH - 160 - (G.toasts.length - 1 - i) * 52; ctx.globalAlpha = a; rr(ctx, wx - 240, y - 24, 480, 46, 23); ctx.fillStyle = 'rgba(30,20,12,0.85)'; ctx.fill(); txt(t.text, wx, y, 28, t.c); ctx.globalAlpha = 1; });
  if (G.banner) {
    const b = G.banner, el = b.max - b.life, sc = el < 0.25 ? easeBack(el / 0.25) : 1, a = Math.min(1, b.life * 2.5);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(wx, UH * 0.32); ctx.scale(sc, sc);
    rr(ctx, -UW, -62, UW * 2, b.sub ? 128 : 100, 0); ctx.fillStyle = 'rgba(20,10,5,0.4)'; ctx.fill();
    txt(b.text, 0, -10, 80, b.c, 'center', 12); if (b.sub) txt(b.sub, 0, 46, 30, '#ffffff');
    ctx.restore();
  }
  if (input.joy && G.state === 'play') {
    const j = input.joy; ctx.globalAlpha = 0.55;
    ell(ctx, j.x, j.y, 70, 70); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
    ell(ctx, j.x + input.dx * 60, j.y + input.dz * 60, 32, 32); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.globalAlpha = 1;
  }
  if (G.state === 'over') drawOver();
  if (G.paused && G.state === 'play' && !G.noPauseText) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, UW, UH); txt('PAUSED', UW / 2, UH / 2 - 20, 90, '#fff'); txt('tap to keep playing', UW / 2, UH / 2 + 50, 34, '#ffd23f'); }
  if (portrait) { ctx.fillStyle = 'rgba(20,12,6,0.94)'; ctx.fillRect(0, 0, UW, UH); txt('Turn your tablet sideways', UW / 2, UH / 2, 56, '#ffd23f'); }
}
function drawTutorial() {
  const h = G.hero, hs = toUI(h.x, 0, h.z);
  if (G.tut === 0) { drawHand(hs.x + Math.sin(G.t * Math.PI) * 80, hs.y + 90, 1.1); txt('DRAG TO MOVE', hs.x, hs.y + 190, 44, '#ffffff'); }
  else if (G.tut === 1) {
    const c = G.loot.filter(c => c.st === 1).sort((a, b) => dist(a.x, a.z, h.x, h.z) - dist(b.x, b.z, h.x, h.z))[0];
    if (c) { const s = toUI(c.x, 0.5, c.z); drawHand(s.x + 10, s.y + 20 + Math.abs(Math.sin(G.t * 4)) * 14, 0.9); txt('GRAB THE COINS!', s.x, s.y - 50, 38, '#ffd23f'); }
    else G.tut = 2;
  } else if (G.tut === 2) {
    const p = G.padMap.t1; if (p.lvl) { G.tut = 3; return; }
    const s = toUI(p.x, 0, p.z); drawHand(s.x + 20, s.y + 10 + Math.abs(Math.sin(G.t * 4)) * 14, 1);
    txt(G.coins >= 5 ? 'STAND HERE TO BUILD!' : 'GRAB MORE COINS!', s.x, s.y - 90, 38, '#ffd23f');
  }
}
function drawShop(y) {
  const w = 236, hgt = 116, gap = 16, x0 = UW / 2 - (w * 4 + gap * 3) / 2; shopRects = [];
  txt('♛ ' + META.crowns + ' CROWNS — permanent upgrades', UW / 2, y - 26, 28, '#ffd23f');
  META_DEFS.forEach((d, i) => {
    const x = x0 + i * (w + gap), lv = META[d.id], c = metaCost(lv), can = META.crowns >= c;
    rr(ctx, x, y + 4, w, hgt, 18); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    rr(ctx, x, y, w, hgt, 18); ctx.fillStyle = '#3b2716'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = can ? d.col : OUT; ctx.stroke();
    txt(d.name, x + w / 2, y + 24, 24, d.col); txt('LV ' + lv, x + w / 2, y + 52, 20, '#ffffff'); txt(d.desc, x + w / 2, y + 76, 16, '#e8d5b5', 'center', 3);
    rr(ctx, x + w / 2 - 50, y + 88, 100, 26, 13); ctx.fillStyle = can ? '#3fbf55' : 'rgba(0,0,0,0.5)'; ctx.fill(); txt('♛ ' + c, x + w / 2, y + 101, 18, '#ffffff');
    shopRects.push({ x, y, w, h: hgt, id: d.id });
  });
}
function drawTitle() {
  ctx.fillStyle = 'rgba(10,6,2,0.25)'; ctx.fillRect(0, 0, UW, UH);
  const cx = UW / 2, bob = Math.sin(G.t * 2) * 6;
  ctx.save(); ctx.translate(cx, UH * 0.28 + bob); ctx.rotate(-0.03);
  ctx.font = '150px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 26; ctx.strokeStyle = OUT; ctx.strokeText('EMBER KEEP', 0, 0);
  const gr = ctx.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, '#ffe58a'); gr.addColorStop(0.5, '#ffb13d'); gr.addColorStop(1, '#e8541e'); ctx.fillStyle = gr; ctx.fillText('EMBER KEEP', 0, 0); ctx.restore();
  txt('Build your keep. Walk the world. Take every castle!', cx, UH * 0.28 + 110, 36, '#ffffff');
  const p = 1 + Math.sin(G.t * 5) * 0.06;
  ctx.save(); ctx.translate(cx, UH * 0.62); ctx.scale(p, p);
  rr(ctx, -190, -48, 380, 96, 30); const g2 = ctx.createLinearGradient(0, -48, 0, 48); g2.addColorStop(0, '#6fe07e'); g2.addColorStop(1, '#25a046'); ctx.fillStyle = g2; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = OUT; ctx.stroke();
  txt(SAVE ? 'CONTINUE' : 'TAP TO PLAY', 0, 3, 54, '#ffffff', 'center', 9); ctx.restore();
  drawHand(cx + 150, UH * 0.62 + 30 + Math.abs(Math.sin(G.t * 4)) * 14, 1);
  if (SAVE) txt('WAVE ' + (SAVE.cleared + 1) + '  ·  BEST ' + best, cx, UH * 0.72, 32, '#ffd23f');
  else if (best) txt('BEST: WAVE ' + best, cx, UH * 0.72, 32, '#ffd23f');
  if (SAVE) { panel(UW - 250, 20, 230, 56, 18); txt(G.sureNew > 0 ? 'TAP AGAIN TO WIPE' : 'NEW GAME', UW - 135, 49, G.sureNew > 0 ? 22 : 28, G.sureNew > 0 ? '#ff8a7a' : '#ffffff'); G.sureNew -= 1 / 60; }
  drawShop(UH * 0.8);
}
function drawOver() {
  const a = Math.min(1, G.overT * 1.5); ctx.fillStyle = 'rgba(15,5,2,' + 0.6 * a + ')'; ctx.fillRect(0, 0, UW, UH);
  if (G.overT < 0.6) return;
  const sc = easeBack(Math.min(1, (G.overT - 0.6) * 3));
  ctx.save(); ctx.translate(UW / 2, UH / 2 - 40); ctx.scale(sc, sc);
  rr(ctx, -330, -230, 660, 460, 40); ctx.fillStyle = '#3b2716'; ctx.fill(); ctx.lineWidth = 7; ctx.strokeStyle = OUT; ctx.stroke();
  txt('THE KEEP FELL!', 0, -165, 66, '#ff6b4a', 'center', 11);
  txt('BACK TO WAVE ' + (G.checkpoint + 1), 0, -90, 62, '#ffd23f', 'center', 10);
  txt('Made it to wave ' + G.wave + (G.wave >= best ? ' — NEW BEST!' : '  ·  best ' + best), 0, -28, 30, G.wave >= best ? '#7ee081' : '#ffffff');
  txt('+' + G.earned + ' ♛ crowns', 0, 12, 30, '#e8d5b5');
  txt('Your buildings stay. Coins on you are gone. The bank is safe.', 0, 60, 23, '#ffffff', 'center', 4);
  rr(ctx, -190, 100, 380, 90, 28); const g2 = ctx.createLinearGradient(0, 100, 0, 190); g2.addColorStop(0, '#6fe07e'); g2.addColorStop(1, '#25a046'); ctx.fillStyle = g2; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = OUT; ctx.stroke();
  txt('TRY AGAIN', 0, 146, 52, '#ffffff', 'center', 9); ctx.restore();
  if (G.overT > 1) drawShop(UH / 2 + 262);
}

// ================= input =================
const uiPt = ev => ({ x: ev.clientX * DPR / S, y: ev.clientY * DPR / S });
let joyId = null;
uic.addEventListener('pointerdown', ev => {
  ev.preventDefault(); AU.init(); if (portrait) return;
  const p = uiPt(ev);
  if (G.state === 'title' || (G.state === 'over' && G.overT > 1)) {
    for (const r of shopRects) if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) {
      const c = metaCost(META[r.id]); if (META.crowns >= c) { META.crowns -= c; META[r.id]++; saveMeta(); AU.play('build'); } else AU.play('hurt');
      return;
    }
  }
  if (G.state === 'title') {
    if (SAVE && p.x > UW - 250 && p.x < UW - 20 && p.y > 20 && p.y < 76) { if (G.sureNew > 0) { SAVE = null; newGame(); writeSave(); } else G.sureNew = 3; AU.play('tap'); return; }
    if (Math.abs(p.x - UW / 2) < 200 && Math.abs(p.y - UH * 0.62) < 60) {
      if (SAVE) { fixKeep(); G.state = 'play'; G.t = 0; G.tut = 3; G.next = 8; }
      else { newGame(); G.state = 'play'; G.t = 0; G.tut = best > 0 ? 3 : 0; if (best > 0) G.next = 8; }
      AU.play('build');
    }
    return;
  }
  if (G.map) return mapTap(p);
  if (G.state === 'over') { if (G.overT > 1 && Math.abs(p.x - UW / 2) < 200 && p.y > UH / 2 + 50 && p.y < UH / 2 + 160) { retry(); AU.play('tap'); } return; }
  if (G.paused) { G.paused = false; return; }
  const B = HUDB();
  if (dist(p.x, p.y, B.pause.x, B.pause.y) < B.pause.r + 10) { G.paused = true; AU.play('tap'); return; }
  if (dist(p.x, p.y, B.sound.x, B.sound.y) < B.sound.r + 10) { AU.muted = !AU.muted; AU.play('tap'); return; }
  const Rd = RAD(); if (inBtn(p, B.map) || dist(p.x, p.y, Rd.x, Rd.y) < Rd.r) { G.map = { k: 0, closing: false, sel: null }; G.seenMap = true; input.joy = null; joyId = null; input.dx = input.dz = 0; AU.play('tap'); return; }
  if (G.raid && G.raid.endT === null && Math.abs(p.x - B.go.x) < B.go.w / 2 && Math.abs(p.y - B.go.y) < B.go.h / 2) { endRaid(); travelTo(KEEP); AU.play('tap'); return; }
  if (G.waveState === 'prep' && !G.raid && (G.tut >= 3 || G.wave > 0) && Math.abs(p.x - B.go.x) < B.go.w / 2 && Math.abs(p.y - B.go.y) < B.go.h / 2) {
    const bonus = Math.round(Math.ceil(G.next) * 0.6 * (1 + G.wave * 0.25)); if (bonus > 0) { dropCoins(G.hero.x, G.hero.z, bonus); toast('Early fight: +' + bonus + ' coins', '#ffd23f'); }
    G.next = 0; AU.play('tap'); return;
  }
  // a first finger always takes the stick, in case iOS never sent the last finger's up
  if (joyId === null || ev.isPrimary) { joyId = ev.pointerId; input.joy = { x: p.x, y: p.y }; input.dx = input.dz = 0; try { uic.setPointerCapture(ev.pointerId); } catch (e) {} }
}, { passive: false });
uic.addEventListener('pointermove', ev => {
  if (ev.pointerId !== joyId || !input.joy) return;
  const p = uiPt(ev); let dx = (p.x - input.joy.x) / 60, dz = (p.y - input.joy.y) / 60; const m = Math.hypot(dx, dz);
  if (m > 1) { input.joy.x += (p.x - input.joy.x) * (1 - 1 / m); input.joy.y += (p.y - input.joy.y) * (1 - 1 / m); dx /= m; dz /= m; }
  input.dx = dx; input.dz = dz;
});
const endJoy = ev => { if (ev.pointerId !== joyId) return; joyId = null; input.joy = null; input.dx = input.dz = 0; };
uic.addEventListener('pointerup', endJoy); uic.addEventListener('pointercancel', endJoy);
addEventListener('keydown', ev => { keys[ev.key.toLowerCase()] = true; });
addEventListener('keyup', ev => { keys[ev.key.toLowerCase()] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.state === 'play') { G.paused = true; writeSave(); } });
addEventListener('resize', resize);
addEventListener('contextmenu', e => e.preventDefault());
// in a Safari tab, stop the page from taking the drag (that kills the touch) or zooming
document.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
const dropJoy = () => { joyId = null; input.joy = null; input.dx = input.dz = 0; };
addEventListener('blur', dropJoy); addEventListener('pagehide', dropJoy);

// ================= loop =================
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsChecked = false;
function frame(now) {
  requestAnimationFrame(frame);
  // iOS can report the new size late after a turn; a stale size makes taps miss the buttons
  if (Math.round(CW / DPR) !== (innerWidth || 1024) || Math.round(CH / DPR) !== (innerHeight || 768)) resize();
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  if (!input.joy) { const kx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), kz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0); input.dx = kx; input.dz = kz; }
  G.shake = Math.max(0, G.shake - real * 3);
  if (G.map) { G.t += real; const M = G.map; M.k = clamp(M.k + (M.closing ? -real : real) * 1.8, 0, 1); if (M.closing && M.k <= 0) G.map = null; if (!portrait) { M.f = (M.f || 0) + 1; const still = M.k >= 1; renderer.shadowMap.autoUpdate = !still || M.f % 60 === 1; if (!still || M.f % 6 === 1) { syncScene(real); renderer.render(scene, camera); } renderer.shadowMap.autoUpdate = true; drawUI(); return; } }
  if (G.slowT > 0) { G.slowT -= real; if (G.slowT <= 0) G.slow = 1; }
  if (G.state === 'title') G.t += real;
  else if (!G.paused && !portrait) {
    if (G.state === 'play') update(real * G.slow);
    else { G.overT += real; G.t += real; for (const p of G.parts) { p.life -= real; p.vy -= 18 * real; p.x += p.vx * real; p.y += p.vy * real; p.z += p.vz * real; } G.parts = G.parts.filter(p => p.life > 0); for (const p of G.puffs) { p.life -= real; p.y += p.vy * real; } G.puffs = G.puffs.filter(p => p.life > 0); }
  }
  syncScene(real);
  renderer.render(scene, camera);
  drawUI();
  // auto quality: drop shadows/resolution on slow tablets
  if (!fpsChecked && G.state === 'play') { fpsAcc += real; fpsN++; if (fpsAcc > 4) { fpsChecked = true; if (fpsN / fpsAcc < 40) { quality = 0; renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); resize(); } } }
}

function runSim() {
  newGame(); G.state = 'play'; G.tut = 3; G.next = 1;
  const log = []; const dt = 1 / 30;
  const chunk = () => {
    for (let i = 0; i < 3000 && G.t < 2700; i++) {
      if (G.state === 'over') { BOTLOG.push('LOST at w' + G.wave + ' t' + Math.floor(G.t) + ' -> back to w' + G.checkpoint + ' crowns+' + G.earned + ' caps=' + G.cap.filter(Boolean).length); retry(); }
      update(dt);
      if (Math.floor(G.t) % 60 === 0 && Math.floor(G.t - dt) % 60 !== 0) log.push(`t${Math.floor(G.t)} w${G.wave} c${Math.floor(G.coins)} keep${Math.floor(G.padMap.keep.hp)}/${G.padMap.keep.maxHp} hero${Math.floor(G.hero.hp)} ` + G.pads.filter(p => p.lvl).map(p => p.id + p.lvl).join(','));
    }
    if (G.t < 2700) return setTimeout(chunk, 0);
    const out = `SIM END wave=${G.wave} t=${Math.floor(G.t)}s kills=${G.kills} state=${G.state} checkpoint=${G.checkpoint} caps=${G.cap.filter(Boolean).length} empire=${G.empire} crowns=${META.crowns}\n` + BOTLOG.join('\n') + '\n' + log.join('\n');
    document.title = 'SIMDONE'; const pre = document.createElement('pre'); pre.id = 'sim'; pre.textContent = out; document.body.appendChild(pre);
  };
  chunk();
}

// ?selftest: real pointer events on the UI canvas, game stepped by hand (works headless)
async function selfTest() {
  const out = [], step = n => { for (let i = 0; i < n; i++) { update(1 / 30); syncScene(1 / 30); } };
  const ev = (t, x, y) => uic.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 9, bubbles: true, isPrimary: true, pointerType: 'touch' }));
  const k = S / DPR, cx = UW / 2 * k, cy = UH * 0.62 * k, tap = b => { ev('pointerdown', b.x * k, b.y * k); ev('pointerup', b.x * k, b.y * k); };
  ev('pointerdown', cx, cy); ev('pointerup', cx, cy);
  out.push('after play tap: state=' + G.state + ' tut=' + G.tut);
  const walk = (tx, tz) => { ev('pointerdown', 500, 300); for (let i = 0; i < 900; i++) { const dx = tx - G.hero.x, dz = tz - G.hero.z, d = Math.hypot(dx, dz); if (d < 0.5) break; ev('pointermove', 500 + dx / d * 60, 300 + dz / d * 60); step(1); } ev('pointerup', 500, 300); G.hero.vx = G.hero.vz = 0; };
  walk(G.loot[0].x, G.loot[0].z); walk(G.loot[G.loot.length - 1].x, G.loot[G.loot.length - 1].z); step(40);
  out.push('after coins: coins=' + G.coins + ' tut=' + G.tut);
  walk(G.padMap.t1.x, G.padMap.t1.z); step(60);
  out.push('after pad: t1 lvl=' + G.padMap.t1.lvl + ' coins=' + G.coins + ' next=' + G.next.toFixed(1));
  step(30 * 25); out.push('25s later: wave=' + G.wave + ' enemies=' + G.enemies.length + ' kills=' + G.kills + ' keep=' + Math.round(G.padMap.keep.hp));
  const calm = () => { G.enemies = []; G.queue = []; G.waveState = 'prep'; G.next = 999; };
  calm(); G.cleared = 5; G.coins = 400; for (const p of G.pads) if (p.unlock <= 5 && p.fort === undefined && !p.land) { p.shown = true; p.appear = 1; }
  walk(G.padMap.bank.x, G.padMap.bank.z); step(60); out.push('bank lvl=' + G.padMap.bank.lvl + ' coins=' + Math.round(G.coins));
  walk(BANK_DEP.x, BANK_DEP.z); step(30); out.push('put in: bank=' + Math.round(G.bank));
  // walking over a pad pays nothing, stopping pays
  { const pd = G.padMap.boots, sp = padSpot(pd), hh = G.hero; calm(); G.coins = 500; pd.paid = 0; hh.x = sp.x - 4; hh.z = sp.z; hh.padId = null; for (let i = 0; i < 24; i++) { input.dx = 1; input.dz = 0; update(1 / 30); } const walked = pd.paid; input.dx = 0; hh.x = sp.x; hh.z = sp.z; hh.vx = hh.vz = 0; const l0 = pd.lvl; for (let i = 0; i < 45; i++) { input.dx = 0; update(1 / 30); } out.push('walk over pad paid=' + walked + ' stopped lvl ' + l0 + '>' + pd.lvl); }
  // far from home the wave timer waits
  { calm(); G.next = 10; const hh = G.hero; hh.x = KEEP.x - 160; hh.z = KEEP.z; step(60); out.push('away=' + G.away + ' timer still=' + (G.next === 10)); }
  // chest, new realm banner
  { const c = CHESTS[0], hh = G.hero, w0 = G.wood; hh.x = c.x; hh.z = c.z; hh.vx = hh.vz = 0; step(10); out.push('chest opened=' + G.chests.includes(0) + ' wood+' + (G.wood - w0) + ' realm=' + G.realm); }
  // walk up to a castle: the fight starts by itself, your troops come
  { calm(); const f = FORTS[0], hh = G.hero; G.troops = 12; G.padMap.bk.lvl = 2; rebuild(G.padMap.bk); step(2); hh.x = f.x - 40; hh.z = f.z; walk(f.x - 12, f.z); step(3); out.push('raid by walking=' + !!G.raid + ' army=' + G.soldiers.filter(s => s.army).length); hh.x = KEEP.x + 15; hh.z = KEEP.z + 15; step(3); out.push('walked off: raid=' + !!G.raid + ' army=' + G.soldiers.filter(s => s.army).length); }
  { calm(); const f = FORTS[0], hh = G.hero; hh.x = f.x - 12; hh.z = f.z; step(2); renderer.render(scene, camera); drawUI(); G.raid.e.hp = 1; hh.x = f.x - 4.2; hh.z = f.z; step(40); out.push('capture: cap0=' + G.cap[0]); out.push('town open=' + G.padMap.e_bk.shown); step(120); out.push('after: raid=' + !!G.raid + ' paths=' + buildWave(6).paths.length); }
  // wild castle
  { calm(); const f = LANDS[0], hh = G.hero; hh.x = f.x; hh.z = f.z + 14; step(2); G.raid.e.hp = 1; hh.z = f.z + 4.5; step(40); out.push('wild taken=' + (G.world.f1 > 0) + ' town=' + G.padMap.l_f1_a.shown + ' lands=' + landsOwned()); step(120); G.enemies = []; }
  // map: zoom out, pick, fast travel, close
  { calm(); drawUI(); const hb = HUDB(); ev('pointerup', 500, 300); tap({ x: hb.map.x, y: hb.map.y }); out.push('map open=' + !!G.map); G.map.k = 1; syncScene(0); renderer.render(scene, camera); drawUI(); const f = LANDS[0], q = toUI(f.x, 6, f.z); tap(q); out.push('sel=' + (G.map.sel && G.map.sel.id)); tap(MB().act); out.push('travelled=' + (dist(G.hero.x, G.hero.z, f.x, f.z) < 30) + ' map closed=' + !G.map); step(2); }
  // keep falls: back to checkpoint, buildings stay
  G.checkpoint = 5; G.wave = 8; G.cleared = 7; const lv0 = G.padMap.t1.lvl; startWave(); G.padMap.keep.hp = 0; step(1); out.push('fell: state=' + G.state + ' bank=' + Math.round(G.bank));
  G.overT = 2; drawUI(); tap({ x: UW / 2, y: UH / 2 + 100 }); out.push('retry: state=' + G.state + ' wave=' + G.wave + ' t1same=' + (G.padMap.t1.lvl === lv0) + ' keep=' + G.padMap.keep.hp);
  syncScene(0); renderer.render(scene, camera); drawUI();
  // older saves load with nothing lost
  { const old = { cleared: 15, checkpoint: 15, coins: 403, bank: 2344, lv: { keep: 4, t1: 4, sword: 3, bank: 4, c1: 8, t7: 7 }, cap: [false, false, false, false], empire: 0, raidAfter: 0, kills: 1938 }; newGame(); applySave(old); out.push('v3 save: wave=' + G.wave + ' coins=' + G.coins + ' bank=' + G.bank + ' keep=' + G.lv('keep') + ' c1=' + G.lv('c1'));
    const v4 = { ...old, invest: 500, wood: 40, stone: 30, troops: 22, world: { f3: 2, fc: 1 }, wdmg: { d1: 3 }, goalI: 14, seenMap: true, cap: [true, false, false, false], lv: { ...old.lv, e_bk: 2, market: 3 } }; newGame(); applySave(v4); out.push('v4 save: invest=' + G.invest + ' troops=' + G.troops + ' f3 ours=' + isOurs(LANDS[1]) + ' goal=' + G.goalI + ' town lv=' + G.lv('e_bk') + ' wild town open=' + G.padMap.l_f3_a.shown); }
  const pre = document.createElement('pre'); pre.id = 'test'; pre.textContent = out.join(' | '); document.body.appendChild(pre); document.title = 'TESTDONE';
}
if (Q.has('shot')) window.__r = renderer;
newGame(); resize();
if (!NOSAVE) await loadAll();
if (Q.has('selftest')) setTimeout(selfTest, 300);
else if (SIM) runSim();
else {
  if (AUTO) { G.state = 'play'; G.tut = 3; G.next = 2; }
  if (AUTO && Q.has('warp')) { const end = +Q.get('warp'); while (G.t < end && G.state === 'play') update(1 / 30); }
  if (AUTO && Q.has('at')) { const [ax, az] = Q.get('at').split(',').map(Number); G.hero.x = ax; G.hero.z = az; G.cam.x = ax; G.cam.z = az; G.paused = true; G.next = 99; G.noPauseText = true; }
  if (AUTO && Q.has('raidshot')) { startRaid(FORTS[0]); for (let i = 0; i < +Q.get('raidshot'); i++) update(1 / 30); G.cam.x = G.hero.x; G.cam.z = G.hero.z; G.paused = true; G.noPauseText = true; }
  const fontReady = document.fonts && document.fonts.load ? document.fonts.load('40px "Lilita One"').catch(() => {}) : Promise.resolve();
  Promise.race([fontReady, new Promise(r => setTimeout(r, 1500))]).then(() => { last = performance.now(); requestAnimationFrame(frame); });
  window.__G = () => G;
}
