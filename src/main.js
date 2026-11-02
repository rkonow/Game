// Vanguard Shift: RTS command view + first-person possession prototype.
import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------- config
const HALF = 30;            // map spans [-HALF, HALF] on X and Z
const N = HALF * 2;         // pathfinding grid cells per side (1 unit each)
const PLAYER = 0, ENEMY = 1;
const TEAM_COLORS = [0x3fa9ff, 0xff5a3c];
const TYPES = {
  trooper: { hp: 60, speed: 4.2, range: 10, dmg: 7, rate: 0.45, radius: 0.45, acc: 0.7 },
  heavy: { hp: 150, speed: 3.0, range: 8, dmg: 18, rate: 1.1, radius: 0.6, acc: 0.8 },
};
const POSSESS_DMG = 2.0;    // damage multiplier while the player is driving the unit
const POSSESS_RATE = 0.6;   // fire-rate multiplier (lower = faster)
const EYE = 1.45;
const PLAYER_CAP = 18, ENEMY_CAP = 22;

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151c);
scene.fog = new THREE.Fog(0x10151c, 45, 120);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x30281f, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(18, 40, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 100 });
scene.add(sun);

// ground with a generated tile texture
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3542'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#303b49'; g.fillRect(4, 4, 56, 56); g.fillRect(68, 68, 56, 56);
  g.strokeStyle = '#3d4a5b'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(N / 4, N / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(N, N),
  new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x161c24 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
scene.add(outer);

// ---------------------------------------------------------------- obstacles
// [x, z, width, depth, height]; layout is mirrored so both sides are fair.
const OBSTACLE_DEFS = [
  [-10, 0, 7, 1.2, 2], [10, 0, 7, 1.2, 2],
  [0, -7, 1.2, 4, 1.8], [0, 7, 1.2, 4, 1.8],
  [-18, -10, 3, 3, 2.6], [18, 10, 3, 3, 2.6], [-18, 10, 3, 3, 2.6], [18, -10, 3, 3, 2.6],
  [-6, -14, 4, 1, 1.7], [6, 14, 4, 1, 1.7], [6, -14, 4, 1, 1.7], [-6, 14, 4, 1, 1.7],
  [-24, 0, 1.2, 9, 2.2], [24, 0, 1.2, 9, 2.2],
  [-13, -20, 1, 4, 1.8], [13, 20, 1, 4, 1.8], [13, -20, 1, 4, 1.8], [-13, 20, 1, 4, 1.8],
];
const boxes = []; // {minX,maxX,minZ,maxZ, owner?}
const staticShootables = [ground];
const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x5a6676, roughness: 0.8 });
const obstacleTopMat = new THREE.MeshStandardMaterial({ color: 0x77879a, roughness: 0.7 });
for (const [x, z, w, d, h] of OBSTACLE_DEFS) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [obstacleMat, obstacleMat, obstacleTopMat, obstacleMat, obstacleMat, obstacleMat]);
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  staticShootables.push(m);
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

// ---------------------------------------------------------------- entities
let entities = [];
const teamMats = TEAM_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2229, roughness: 0.5, metalness: 0.4 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0x88ccff, emissiveIntensity: 0.6 });

function tagMeshes(group, ent) {
  group.traverse(o => { o.userData.entity = ent; if (o.isMesh) o.castShadow = true; });
}

function makeUnit(team, type, x, z) {
  const t = TYPES[type];
  const u = {
    kind: 'unit', type, team, x, z, hp: t.hp, maxHp: t.hp, speed: t.speed, range: t.range,
    dmg: t.dmg, rate: t.rate, radius: t.radius, acc: t.acc,
    facing: team === PLAYER ? 0 : Math.PI, cool: Math.random() * t.rate,
    order: { type: 'idle' }, path: null, pathGoal: null, possessed: false, dead: false, flash: 0,
  };
  const g = new THREE.Group();
  const bodyMat = teamMats[team].clone();
  u.bodyMat = bodyMat;
  const r = t.radius;
  let body;
  if (type === 'heavy') {
    body = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, 1.1, r * 1.5), bodyMat);
    body.position.y = 0.75;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.7, 0.35), darkMat);
    pack.position.set(0, 0.95, r * 0.85);
    g.add(pack);
  } else {
    body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 1.0, 10), bodyMat);
    body.position.y = 0.7;
  }
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), bodyMat);
  head.position.y = 1.45;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.12), visorMat);
  visor.position.set(0, 1.48, -0.19);
  g.add(visor);
  const gunLen = type === 'heavy' ? 0.9 : 0.7;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(type === 'heavy' ? 0.16 : 0.1, 0.12, gunLen), darkMat);
  gun.position.set(r * 0.75, 1.0, -gunLen / 2);
  g.add(gun);
  u.muzzleOffset = { side: r * 0.75, fwd: gunLen, y: 1.0 };
  tagMeshes(g, u);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r + 0.12, r + 0.28, 28),
    new THREE.MeshBasicMaterial({ color: 0x5dff9a, transparent: true, opacity: 0.9, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false;
  ring.raycast = () => {};
  g.add(ring);
  u.ring = ring;
  u.mesh = g;
  g.position.set(x, 0, z);
  scene.add(g);
  entities.push(u);
  return u;
}

function makeBase(team, x, z) {
  const b = {
    kind: 'base', isBase: true, team, x, z, hp: 1500, maxHp: 1500, radius: 2.5, dead: false, flash: 0,
    spawnTimer: 4, spawnCount: 0,
  };
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x485566, roughness: 0.7 });
  b.bodyMat = bodyMat;
  const core = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 5), bodyMat);
  core.position.y = 1.2;
  g.add(core);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.35, 5.1), teamMats[team]);
  stripe.position.y = 1.9;
  g.add(stripe);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 2.2, 12), bodyMat);
  tower.position.y = 3.5;
  g.add(tower);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 10),
    new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], emissive: TEAM_COLORS[team], emissiveIntensity: 1.2 })
  );
  beacon.position.y = 4.9;
  g.add(beacon);
  b.beacon = beacon;
  tagMeshes(g, b);
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  g.position.set(x, 0, z);
  scene.add(g);
  b.mesh = g;
  b.box = { minX: x - 2.5, maxX: x + 2.5, minZ: z - 2.5, maxZ: z + 2.5, owner: b };
  boxes.push(b.box);
  entities.push(b);
  return b;
}

// ---------------------------------------------------------------- pathfinding grid
const blocked = new Uint8Array(N * N);
function rebuildGrid() {
  blocked.fill(0);
  const pad = 0.5;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cx = i - HALF + 0.5, cz = j - HALF + 0.5;
    for (const b of boxes) {
      if (cx > b.minX - pad && cx < b.maxX + pad && cz > b.minZ - pad && cz < b.maxZ + pad) { blocked[j * N + i] = 1; break; }
    }
  }
}
const toCell = v => Math.max(0, Math.min(N - 1, Math.floor(v + HALF)));
const cellCenter = i => i - HALF + 0.5;
const isFree = (i, j) => i >= 0 && j >= 0 && i < N && j < N && !blocked[j * N + i];

function nearestFree(i, j) {
  if (isFree(i, j)) return [i, j];
  for (let r = 1; r < 12; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (isFree(i + di, j + dj)) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; } }
    }
    if (best) return best;
  }
  return [i, j];
}

function walkable(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(d / 0.3);
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    if (!isFree(toCell(x0 + (x1 - x0) * k), toCell(z0 + (z1 - z0) * k))) return false;
  }
  return true;
}

const gScore = new Float32Array(N * N), cameFrom = new Int32Array(N * N), closed = new Uint8Array(N * N);
function findPath(sx, sz, tx, tz) {
  if (walkable(sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const [si, sj] = nearestFree(toCell(sx), toCell(sz));
  const [ti, tj] = nearestFree(toCell(tx), toCell(tz));
  const start = sj * N + si, goal = tj * N + ti;
  gScore.fill(Infinity); closed.fill(0); cameFrom.fill(-1);
  gScore[start] = 0;
  const heap = [[0, start]];
  const h = (c) => { const ci = c % N, cj = (c / N) | 0; const dx = Math.abs(ci - ti), dz = Math.abs(cj - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const push = (item) => { heap.push(item); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  let found = false;
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    if (c === goal) { found = true; break; }
    closed[c] = 1;
    const ci = c % N, cj = (c / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFree(ni, nj)) continue;
      if (di && dj && (!isFree(ci + di, cj) || !isFree(ci, cj + dj))) continue; // no corner cutting
      const n = nj * N + ni;
      const g = gScore[c] + (di && dj ? 1.414 : 1);
      if (g < gScore[n]) { gScore[n] = g; cameFrom[n] = c; push([g + h(n), n]); }
    }
  }
  if (!found) return [{ x: tx, z: tz }];
  const cells = [];
  for (let c = goal; c !== -1; c = cameFrom[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map(c => ({ x: cellCenter(c % N), z: cellCenter((c / N) | 0) }));
  const goalFree = isFree(toCell(tx), toCell(tz));
  if (goalFree) pts[pts.length - 1] = { x: tx, z: tz };
  // string-pull smoothing
  const out = [];
  let cx = sx, cz = sz, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) if (walkable(cx, cz, pts[m].x, pts[m].z)) { far = m; break; }
    out.push(pts[far]);
    cx = pts[far].x; cz = pts[far].z; k = far + 1;
  }
  return out;
}

// ---------------------------------------------------------------- geometry helpers
function segHitsBox(x0, z0, x1, z1, b) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, d, lo, hi] of [[x0, dx, b.minX, b.maxX], [z0, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let t1 = (lo - p) / d, t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
function hasLOS(a, b) {
  for (const box of boxes) {
    if (box.owner === b || box.owner === a) continue;
    if (segHitsBox(a.x, a.z, b.x, b.z, box)) return false;
  }
  return true;
}
const distTo = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) - (b.isBase ? b.radius : 0);

function resolveCollision(u) {
  for (const b of boxes) {
    const px = Math.max(b.minX, Math.min(u.x, b.maxX));
    const pz = Math.max(b.minZ, Math.min(u.z, b.maxZ));
    let dx = u.x - px, dz = u.z - pz;
    const d = Math.hypot(dx, dz);
    if (d < u.radius) {
      if (d < 1e-6) { // centre inside the box: push out along the shallowest axis
        const opts = [[u.x - b.minX, -1, 0], [b.maxX - u.x, 1, 0], [u.z - b.minZ, 0, -1], [b.maxZ - u.z, 0, 1]];
        opts.sort((p, q) => p[0] - q[0]);
        u.x += opts[0][1] * (opts[0][0] + u.radius); u.z += opts[0][2] * (opts[0][0] + u.radius);
      } else {
        u.x = px + dx / d * u.radius; u.z = pz + dz / d * u.radius;
      }
    }
  }
  const lim = HALF - u.radius;
  u.x = Math.max(-lim, Math.min(lim, u.x));
  u.z = Math.max(-lim, Math.min(lim, u.z));
}

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
const facingFor = (dx, dz) => Math.atan2(-dx, -dz);

// ---------------------------------------------------------------- effects
const tracerPool = [];
for (let i = 0; i < 80; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }));
  line.frustumCulled = false; line.visible = false;
  line.raycast = () => {};
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerIdx = 0;
function tracer(ax, ay, az, bx, by, bz, color = 0xffe08a) {
  const t = tracerPool[tracerIdx++ % tracerPool.length];
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, ax, ay, az); p.setXYZ(1, bx, by, bz); p.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.visible = true; t.life = 0.09;
}

const effects = [];
const sparkGeo = new THREE.SphereGeometry(1, 12, 8);
function burst(x, y, z, size, color) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.set(x, y, z); m.scale.setScalar(size * 0.3); m.raycast = () => {};
  scene.add(m);
  effects.push({ m, life: 0.45, max: 0.45, size });
}
function ping(x, z, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.raycast = () => {};
  scene.add(m);
  effects.push({ m, life: 0.5, max: 0.5, ring: true });
}
function updateEffects(dt) {
  for (const t of tracerPool) if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.09); if (t.life <= 0) t.line.visible = false; }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = 1 - e.life / e.max;
    if (e.ring) e.m.scale.setScalar(1 + k * 1.2);
    else e.m.scale.setScalar(e.size * (0.3 + k));
    e.m.material.opacity = Math.max(0, 1 - k);
    if (e.life <= 0) { scene.remove(e.m); e.m.material.dispose(); if (e.ring) e.m.geometry.dispose(); effects.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- audio (tiny procedural sfx)
let audio = null, noiseBuf = null;
function initAudio() {
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.3, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  } catch { audio = null; }
}
function sfx(kind, x, z) {
  if (!audio || audio.state !== 'running') return;
  let vol = 0.25;
  if (x !== undefined) {
    const d = Math.hypot(camera.position.x - x, camera.position.z - z) + (mode === 'rts' ? 0 : 0);
    vol = (mode === 'rts' ? 0.08 : 0.18) / (1 + d * 0.12);
  }
  const src = audio.createBufferSource(); src.buffer = noiseBuf;
  const f = audio.createBiquadFilter(); f.type = 'bandpass';
  const g = audio.createGain();
  const now = audio.currentTime;
  if (kind === 'shot') { f.frequency.value = 1400; src.playbackRate.value = 1.4; g.gain.setValueAtTime(vol * 1.6, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12); }
  else if (kind === 'hit') { f.frequency.value = 3200; src.playbackRate.value = 2; g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06); }
  else { f.frequency.value = 300; src.playbackRate.value = 0.6; g.gain.setValueAtTime(vol * 3, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.4); }
  src.connect(f); f.connect(g); g.connect(audio.destination);
  src.start(now); src.stop(now + 0.45);
}

// ---------------------------------------------------------------- game state
let mode = 'menu';           // 'menu' | 'rts' | 'fps' | 'over'
let selection = [];
let possessed = null;
let amoveArmed = false;
let waveTimer = 14, waveNum = 0;
let playerBase, enemyBase;
const rts = { focus: new THREE.Vector3(0, 0, 14), zoom: 26 };
const fps = { yaw: 0, pitch: 0, firing: false, bob: 0, hitMarker: 0, hurt: 0, flash: 0, stickX: 0, stickY: 0 };
let trans = null;            // camera transition
const keys = new Set();
let isTouch = false;

function setupWorld() {
  playerBase = makeBase(PLAYER, 0, 25);
  enemyBase = makeBase(ENEMY, 0, -25);
  rebuildGrid();
  const start = [['trooper', -3, 17], ['trooper', -1, 17], ['trooper', 1, 17], ['trooper', 3, 17], ['heavy', -2, 19], ['heavy', 2, 19]];
  for (const [t, x, z] of start) makeUnit(PLAYER, t, x, z);
  for (const [x, z] of [[-4, -18], [4, -18], [-2, -16], [2, -16], [0, -19]]) makeUnit(ENEMY, x === 0 ? 'heavy' : 'trooper', x, z);
}

// ---------------------------------------------------------------- orders
function liveSelection() { return selection.filter(u => !u.dead && !u.possessed); }

function formationSpots(n, x, z) {
  const spots = [];
  const spacing = 1.4;
  for (let ring = 0; spots.length < n; ring++) {
    if (ring === 0) { spots.push([x, z]); continue; }
    const count = ring * 6;
    for (let k = 0; k < count && spots.length < n; k++) {
      const a = (k / count) * Math.PI * 2;
      spots.push([x + Math.cos(a) * ring * spacing, z + Math.sin(a) * ring * spacing]);
    }
  }
  return spots;
}
function commandMove(units, x, z, type = 'move') {
  if (!units.length) return;
  const spots = formationSpots(units.length, x, z);
  // assign closest units to closest spots (greedy, good enough for a prototype)
  const sorted = [...units].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  sorted.forEach((u, i) => {
    const [sx, sz] = spots[i];
    u.order = { type, x: sx, z: sz };
    u.path = findPath(u.x, u.z, sx, sz); u.pathGoal = { x: sx, z: sz };
  });
  ping(x, z, type === 'amove' ? 0xff7a5a : 0x5dff9a);
}
function commandAttack(units, target) {
  for (const u of units) { u.order = { type: 'attack', target }; u.path = null; u.pathGoal = null; }
  ping(target.x, target.z, 0xff4444);
}

function pathTo(u, x, z) {
  if (!u.path || !u.pathGoal || Math.hypot(u.pathGoal.x - x, u.pathGoal.z - z) > 1.5) {
    u.path = findPath(u.x, u.z, x, z); u.pathGoal = { x, z };
  }
}

function moveAlong(u, dt) {
  if (!u.path || !u.path.length) return true;
  const p = u.path[0];
  const dx = p.x - u.x, dz = p.z - u.z, d = Math.hypot(dx, dz);
  const step = u.speed * dt;
  const last = u.path.length === 1;
  if (d <= Math.max(step, last ? 0.35 : 0.25)) {
    u.x = p.x; u.z = p.z; u.path.shift();
    if (!u.path.length) { u.path = null; return true; }
    return false;
  }
  u.x += dx / d * step; u.z += dz / d * step;
  u.facing = angleLerp(u.facing, facingFor(dx, dz), Math.min(1, dt * 10));
  u.moving = true;
  return false;
}

function findTarget(u, range) {
  let best = null, bs = Infinity;
  for (const e of entities) {
    if (e.dead || e.team === u.team) continue;
    const d = distTo(u, e);
    if (d > range) continue;
    const s = d + (e.isBase ? 8 : 0) + (hasLOS(u, e) ? 0 : 4);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

function muzzlePos(u) {
  const f = u.facing, m = u.muzzleOffset;
  const fx = -Math.sin(f), fz = -Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
  return { x: u.x + fx * m.fwd + rx * m.side, y: m.y, z: u.z + fz * m.fwd + rz * m.side };
}

function aiShoot(u, t) {
  u.cool = u.rate * (0.85 + Math.random() * 0.3);
  const m = muzzlePos(u);
  const hit = Math.random() < u.acc;
  const ty = t.isBase ? 1.5 : 1.0;
  let tx = t.x, tz = t.z;
  if (t.isBase) { const d = Math.hypot(u.x - t.x, u.z - t.z) || 1; tx = t.x + (u.x - t.x) / d * 2.4; tz = t.z + (u.z - t.z) / d * 2.4; }
  if (hit) {
    tracer(m.x, m.y, m.z, tx, ty, tz, u.team === PLAYER ? 0x9fdcff : 0xffb28a);
    damage(t, u.dmg, u);
  } else {
    tracer(m.x, m.y, m.z, tx + (Math.random() - 0.5) * 2.5, ty + Math.random(), tz + (Math.random() - 0.5) * 2.5, u.team === PLAYER ? 0x9fdcff : 0xffb28a);
  }
  if (Math.random() < 0.5) sfx('shot', u.x, u.z);
}

function damage(t, amount, src) {
  if (t.dead) return;
  t.hp -= amount;
  t.flash = 0.12;
  if (t.possessed) { fps.hurt = 0.5; }
  // retaliate if idle
  if (!t.isBase && !t.possessed && t.order.type === 'idle' && src && !src.dead) t.order = { type: 'attack', target: src, auto: true };
  if (t.hp <= 0) kill(t);
}

function kill(e) {
  e.dead = true;
  burst(e.x, e.isBase ? 2 : 1, e.z, e.isBase ? 6 : 1.6, e.isBase ? 0xffaa44 : 0xffcc66);
  sfx('boom', e.x, e.z);
  scene.remove(e.mesh);
  if (e.isBase) {
    const i = boxes.indexOf(e.box); if (i >= 0) boxes.splice(i, 1);
    rebuildGrid();
    endGame(e.team === ENEMY);
  }
  if (e === possessed) {
    toast('Unit lost. Returning to command.');
    rts.focus.set(e.x, 0, e.z);
    possessed = null;
    exitFPS();
  }
}

// ---------------------------------------------------------------- simulation
function updateUnit(u, dt) {
  u.cool -= dt;
  u.moving = false;
  if (u.possessed) return;
  const o = u.order;
  let target = null;
  if (o.type === 'attack') {
    if (o.target.dead) u.order = { type: 'idle' };
    else target = o.target;
  } else if (o.type === 'idle' || o.type === 'amove') {
    target = findTarget(u, u.range + 4);
  }
  if (target) {
    const d = distTo(u, target);
    if (d <= u.range && hasLOS(u, target)) {
      u.path = null; u.pathGoal = null;
      u.facing = angleLerp(u.facing, facingFor(target.x - u.x, target.z - u.z), Math.min(1, dt * 12));
      if (u.cool <= 0) aiShoot(u, target);
      return;
    }
    // automatic retaliation gives up when the attacker runs too far
    if (o.auto && d > u.range + 8) { u.order = { type: 'idle' }; return; }
    pathTo(u, target.x, target.z);
    moveAlong(u, dt);
    return;
  }
  if (o.type === 'move' || o.type === 'amove') {
    pathTo(u, o.x, o.z);
    if (moveAlong(u, dt)) u.order = { type: 'idle' };
  }
}

function separate() {
  const units = entities.filter(e => !e.dead && !e.isBase);
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
    if (d < min && d > 1e-4) {
      const push = (min - d);
      const nx = dx / d, nz = dz / d;
      const wa = a.possessed ? 0 : (b.possessed ? 1 : 0.5), wb = 1 - wa;
      a.x -= nx * push * wa; a.z -= nz * push * wa;
      b.x += nx * push * wb; b.z += nz * push * wb;
    }
  }
  for (const u of units) resolveCollision(u);
}

function updateBases(dt) {
  // player reinforcements
  if (!playerBase.dead) {
    playerBase.spawnTimer -= dt;
    if (playerBase.spawnTimer <= 0) {
      playerBase.spawnTimer = 9;
      if (countUnits(PLAYER) < PLAYER_CAP) {
        const type = (++playerBase.spawnCount % 4 === 0) ? 'heavy' : 'trooper';
        const u = makeUnit(PLAYER, type, (Math.random() - 0.5) * 3, 21.5);
        commandMove([u], (Math.random() - 0.5) * 8, 17 - Math.random() * 2);
        toast('Reinforcement ready', 1.2);
      }
    }
  }
  // enemy waves
  if (!enemyBase.dead) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveNum++;
      waveTimer = Math.max(14, 24 - waveNum);
      const n = Math.min(3 + Math.floor(waveNum * 0.8), 10);
      const spawned = [];
      for (let i = 0; i < n && countUnits(ENEMY) < ENEMY_CAP; i++) {
        spawned.push(makeUnit(ENEMY, i % 3 === 2 ? 'heavy' : 'trooper', (Math.random() - 0.5) * 8, -21 - Math.random() * 1.5));
      }
      const lane = [-14, 0, 14][waveNum % 3];
      commandMove(spawned, lane, 2, 'amove');
      spawned.forEach(u => (u.order.next = { x: 0, z: 24 }));
      if (spawned.length) toast(`Enemy wave ${waveNum} incoming`, 1.8);
    }
  }
  for (const b of [playerBase, enemyBase]) {
    if (!b.dead) b.beacon.position.y = 4.9 + Math.sin(performance.now() / 400) * 0.15;
  }
}
const countUnits = team => entities.reduce((n, e) => n + (!e.dead && !e.isBase && e.team === team ? 1 : 0), 0);

// enemy squads move in two legs: lane waypoint, then the player's base
function updateEnemyLegs() {
  for (const u of entities) {
    if (u.dead || u.isBase || u.team !== ENEMY) continue;
    if (u.order.type === 'idle' && u.lastNext) { commandMoveQuiet(u, u.lastNext.x, u.lastNext.z); u.lastNext = null; }
    if (u.order.next) { u.lastNext = u.order.next; }
  }
}
function commandMoveQuiet(u, x, z) {
  const ox = (Math.random() - 0.5) * 4, oz = (Math.random() - 0.5) * 3;
  u.order = { type: 'amove', x: x + ox, z: z + oz };
  u.path = null; u.pathGoal = null;
}

// ---------------------------------------------------------------- FPS control
const viewmodel = new THREE.Group();
{
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x5b6878, roughness: 0.45, metalness: 0.3, emissive: 0x1a2230 });
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.5), gunMat);
  gun.position.z = -0.27;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.08), visorMat);
  sight.position.set(0, 0.07, -0.18);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.07), gunMat);
  grip.position.set(0, -0.1, -0.08);
  viewmodel.add(gun, sight, grip);
  const muzzle = new THREE.Object3D(); muzzle.position.z = -0.58; viewmodel.add(muzzle);
  viewmodel.userData.muzzle = muzzle;
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  flash.position.z = -0.62; flash.visible = false; viewmodel.add(flash);
  viewmodel.userData.flash = flash;
  viewmodel.position.set(0.2, -0.2, -0.35);
  viewmodel.visible = false;
  viewmodel.traverse(o => { o.raycast = () => {}; });
  camera.add(viewmodel);
}

const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();

function possess(u) {
  if (!u || u.dead || u.isBase || u.team !== PLAYER) return;
  if (possessed && possessed !== u) { possessed.possessed = false; possessed.mesh.visible = true; possessed.order = { type: 'idle' }; }
  possessed = u;
  u.possessed = true; u.order = { type: 'idle' }; u.path = null;
  u.mesh.visible = false;
  fps.yaw = u.facing; fps.pitch = -0.05; fps.firing = false;
  if (!selection.includes(u)) selection.push(u);
  setMode('fps');
  if (!isTouch && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  toast(`Possessing ${u.type}`, 1);
}

function exitFPS() {
  if (possessed) {
    possessed.possessed = false; possessed.mesh.visible = true; possessed.order = { type: 'idle' };
    rts.focus.set(possessed.x, 0, possessed.z);
    possessed = null;
  }
  fps.firing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (mode !== 'over') setMode('rts');
}

function swapUnit() {
  const mine = entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER);
  if (mine.length < 2) { toast('No other units', 1); return; }
  const i = mine.indexOf(possessed);
  possess(mine[(i + 1) % mine.length]);
}

function rally() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 80;
  const hit = raycaster.intersectObjects(staticShootables, false)[0];
  let p = hit ? hit.point : null;
  if (!p) { toast('Aim at the ground to rally', 1); return; }
  let squad = liveSelection();
  if (!squad.length) squad = entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER && !e.possessed && Math.hypot(e.x - possessed.x, e.z - possessed.z) < 14);
  if (!squad.length) { toast('No squad nearby', 1); return; }
  commandMove(squad, p.x, p.z, 'amove');
  toast(`Squad of ${squad.length} rallying`, 1);
}

function playerShoot(u) {
  u.cool = u.rate * POSSESS_RATE;
  const spread = u.type === 'heavy' ? 0.02 : 0.01;
  raycaster.setFromCamera({ x: (Math.random() - 0.5) * spread * 2, y: (Math.random() - 0.5) * spread * 2 }, camera);
  raycaster.far = 90;
  const targets = staticShootables.concat(entities.filter(e => !e.dead && !e.possessed).map(e => e.mesh));
  const hit = raycaster.intersectObjects(targets, true)[0];
  camera.updateMatrixWorld(true);
  const mz = viewmodel.userData.muzzle.getWorldPosition(tmpV);
  const end = hit ? hit.point : raycaster.ray.at(90, new THREE.Vector3());
  tracer(mz.x, mz.y, mz.z, end.x, end.y, end.z, 0xfff2b0);
  viewmodel.userData.flash.visible = true; fps.flash = 0.045;
  viewmodel.position.z = -0.29; // recoil
  sfx('shot');
  if (hit) {
    const ent = hit.object.userData.entity;
    if (ent && ent.team !== u.team) {
      damage(ent, u.dmg * POSSESS_DMG, u);
      fps.hitMarker = 0.15;
      sfx('hit');
      burst(end.x, end.y, end.z, 0.35, 0xffe0a0);
    } else {
      burst(end.x, end.y, end.z, 0.2, 0xb0b8c4);
    }
  }
}

function updateFPS(dt) {
  const u = possessed;
  if (!u) return;
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  f += -fps.stickY; s += fps.stickX;
  const len = Math.hypot(f, s);
  if (len > 1) { f /= len; s /= len; }
  const yaw = fps.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const sp = u.speed * 1.15;
  u.x += (fx * f + rx * s) * sp * dt;
  u.z += (fz * f + rz * s) * sp * dt;
  u.facing = yaw;
  if (len > 0.1) fps.bob += dt * 9 * Math.min(1, len);
  if (fps.firing && u.cool <= 0) playerShoot(u);
}

// ---------------------------------------------------------------- camera
const dummy = new THREE.PerspectiveCamera(); // camera so lookAt faces -Z
function rtsPose() {
  const z = rts.zoom;
  dummy.position.set(rts.focus.x, z, rts.focus.z + z * 0.72);
  dummy.lookAt(rts.focus);
  return { pos: dummy.position.clone(), quat: dummy.quaternion.clone(), fov: 50 };
}
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
function fpsPose() {
  const u = possessed;
  const bob = Math.sin(fps.bob) * 0.04;
  euler.set(fps.pitch, fps.yaw, 0);
  return { pos: new THREE.Vector3(u.x, EYE + bob, u.z), quat: new THREE.Quaternion().setFromEuler(euler), fov: 72 };
}

function setMode(m) {
  const prev = mode;
  mode = m;
  document.body.classList.toggle('fps', m === 'fps');
  viewmodel.visible = m === 'fps';
  amoveArmed = false;
  updateButtons();
  if ((prev === 'rts' || prev === 'fps') && (m === 'rts' || m === 'fps')) {
    trans = { t: 0, dur: 0.65, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), fromFov: camera.fov };
  }
}

function updateCamera(dt) {
  if (mode === 'rts' || mode === 'over' || mode === 'menu') {
    const pan = rts.zoom * 1.1 * dt;
    if (mode === 'rts') {
      if (keys.has('KeyW') || keys.has('ArrowUp')) rts.focus.z -= pan;
      if (keys.has('KeyS') || keys.has('ArrowDown')) rts.focus.z += pan;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) rts.focus.x -= pan;
      if (keys.has('KeyD') || keys.has('ArrowRight')) rts.focus.x += pan;
    }
    if (mode === 'menu') { const t = performance.now() / 6000; rts.focus.set(Math.sin(t) * 6, 0, Math.cos(t) * 4 + 6); }
    rts.focus.x = Math.max(-HALF, Math.min(HALF, rts.focus.x));
    rts.focus.z = Math.max(-HALF, Math.min(HALF, rts.focus.z));
  }
  const pose = mode === 'fps' && possessed ? fpsPose() : rtsPose();
  if (trans) {
    trans.t += dt;
    const k = Math.min(1, trans.t / trans.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(trans.fromPos, pose.pos, e);
    camera.quaternion.slerpQuaternions(trans.fromQuat, pose.quat, e);
    camera.fov = trans.fromFov + (pose.fov - trans.fromFov) * e;
    if (k >= 1) trans = null;
  } else {
    camera.position.copy(pose.pos);
    camera.quaternion.copy(pose.quat);
    camera.fov = pose.fov;
  }
  camera.updateProjectionMatrix();
  // viewmodel recoil recovery and muzzle flash
  viewmodel.position.z += (-0.35 - viewmodel.position.z) * Math.min(1, dt * 18);
  fps.flash -= dt;
  if (fps.flash <= 0) viewmodel.userData.flash.visible = false;
}

// ---------------------------------------------------------------- picking
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight, behind: tmpV.z > 1 };
}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundPoint(sx, sy) {
  raycaster.setFromCamera({ x: sx / innerWidth * 2 - 1, y: -(sy / innerHeight) * 2 + 1 }, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}
function pickEntity(sx, sy) {
  let best = null, bd = Infinity;
  const tol = isTouch ? 38 : 26;
  for (const e of entities) {
    if (e.dead) continue;
    const s = toScreen(e.x, e.isBase ? 1.6 : 0.8, e.z);
    if (s.behind) continue;
    const d = Math.hypot(s.x - sx, s.y - sy) - (e.isBase ? 45 : 0);
    if (d < tol && d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------- input
const pointers = new Map();
let gesture = null;          // two-finger / middle-button pan
let boxSel = null;           // {x0,y0,x1,y1}
let lastTap = { ent: null, t: 0 };

function markTouch(on) {
  if (isTouch === on) return;
  isTouch = on;
  document.body.classList.toggle('touch', on);
  document.body.classList.toggle('desktop', !on);
}
document.body.classList.add('desktop');
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) markTouch(true);
window.addEventListener('pointerdown', e => markTouch(e.pointerType === 'touch'), true);

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  markTouch(e.pointerType === 'touch');
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType };
  pointers.set(e.pointerId, p);
  if (mode === 'rts') {
    if (e.pointerType === 'touch' && pointers.size === 2) {
      boxSel = null;
      const [a, b] = [...pointers.values()];
      gesture = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y), touch: true };
    } else if (e.button === 1) {
      gesture = { mx: e.clientX, my: e.clientY, dist: 0, touch: false };
    }
  } else if (mode === 'fps') {
    if (e.pointerType === 'touch') {
      p.look = true;
    } else if (!document.pointerLockElement) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
    } else if (e.button === 0) {
      fps.firing = true;
    }
  }
});

canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (mode === 'fps' && !isTouch && document.pointerLockElement === canvas) {
    fps.yaw -= e.movementX * 0.0024;
    fps.pitch = Math.max(-1.4, Math.min(1.4, fps.pitch - e.movementY * 0.0024));
  }
  if (!p) return;
  const px = p.x, py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (mode === 'fps' && p.look) {
    fps.yaw -= (p.x - px) * 0.006;
    fps.pitch = Math.max(-1.3, Math.min(1.3, fps.pitch - (p.y - py) * 0.006));
    return;
  }
  if (mode !== 'rts') return;
  if (gesture) {
    let mx, my, dist = 0;
    if (gesture.touch) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      mx = (a.x + b.x) / 2; my = (a.y + b.y) / 2; dist = Math.hypot(a.x - b.x, a.y - b.y);
    } else { mx = p.x; my = p.y; }
    const g0 = groundPoint(gesture.mx, gesture.my), g1 = groundPoint(mx, my);
    if (g0 && g1) { rts.focus.x -= g1.x - g0.x; rts.focus.z -= g1.z - g0.z; }
    if (gesture.touch && gesture.dist > 10 && dist > 10) rts.zoom = Math.max(12, Math.min(48, rts.zoom * gesture.dist / dist));
    gesture.mx = mx; gesture.my = my; gesture.dist = dist;
    return;
  }
  if ((p.button === 0 || p.type === 'touch') && Math.hypot(p.x - p.sx, p.y - p.sy) > 10) {
    boxSel = { x0: p.sx, y0: p.sy, x1: p.x, y1: p.y };
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (mode === 'fps') { if (e.button === 0) fps.firing = false; return; }
  if (!p || mode !== 'rts') return;
  if (gesture) { if (pointers.size === 0) gesture = null; return; }
  if (e.type === 'pointercancel') { boxSel = null; return; }
  if (boxSel) { finishBox(e.shiftKey); boxSel = null; return; }
  handleTap(p.x, p.y, { secondary: p.button === 2, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, touch: p.type === 'touch' });
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (mode === 'rts') rts.zoom = Math.max(12, Math.min(48, rts.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });

function finishBox(shift) {
  const x0 = Math.min(boxSel.x0, boxSel.x1), x1 = Math.max(boxSel.x0, boxSel.x1);
  const y0 = Math.min(boxSel.y0, boxSel.y1), y1 = Math.max(boxSel.y0, boxSel.y1);
  const picked = entities.filter(e => {
    if (e.dead || e.isBase || e.team !== PLAYER) return false;
    const s = toScreen(e.x, 0.8, e.z);
    return !s.behind && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
  });
  selection = shift ? [...new Set([...selection, ...picked])] : picked;
  updateButtons();
}

function handleTap(sx, sy, { secondary, shift, ctrl, touch }) {
  const ent = pickEntity(sx, sy);
  const gp = groundPoint(sx, sy);
  const sel = liveSelection();
  if (amoveArmed && !secondary) {
    amoveArmed = false; updateButtons();
    if (ent && ent.team === ENEMY) commandAttack(sel, ent);
    else if (gp) commandMove(sel, gp.x, gp.z, 'amove');
    return;
  }
  if (secondary) {
    if (ent && ent.team === ENEMY) commandAttack(sel, ent);
    else if (gp) commandMove(sel, gp.x, gp.z, ctrl ? 'amove' : 'move');
    return;
  }
  if (ent && ent.team === PLAYER && !ent.isBase) {
    const now = performance.now();
    if (lastTap.ent === ent && now - lastTap.t < 380) { lastTap.ent = null; possess(ent); return; }
    lastTap = { ent, t: now };
    if (shift) selection = selection.includes(ent) ? selection.filter(u => u !== ent) : [...selection, ent];
    else selection = [ent];
    updateButtons();
    return;
  }
  // touch: a tap on ground/enemy with units selected issues a command
  if (touch && sel.length) {
    if (ent && ent.team === ENEMY) commandAttack(sel, ent);
    else if (gp) commandMove(sel, gp.x, gp.z, 'move');
    return;
  }
  if (!shift) { selection = []; updateButtons(); }
}

window.addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (mode === 'rts') {
    if (e.code === 'KeyF') possessFromSelection();
    else if (e.code === 'KeyQ') selectAll();
    else if (e.code === 'KeyX') toggleAMove();
    else if (e.code === 'Escape') { amoveArmed = false; selection = []; updateButtons(); }
  } else if (mode === 'fps') {
    if (e.code === 'KeyF' || e.code === 'Tab') exitFPS();
    else if (e.code === 'KeyR') rally();
    else if (e.code === 'KeyE') swapUnit();
    else if (e.code === 'Space') fps.firing = true;
  }
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'Space') fps.firing = false;
});
window.addEventListener('blur', () => { keys.clear(); fps.firing = false; });
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('unlocked', !document.pointerLockElement);
  if (!document.pointerLockElement) fps.firing = false;
});
document.body.classList.add('unlocked');

// minimap: tap to move the camera (or right-click to send selected units)
function minimapToWorld(e) {
  const r = minimap.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width - 0.5) * N, z: ((e.clientY - r.top) / r.height - 0.5) * N };
}
minimap.addEventListener('contextmenu', e => e.preventDefault());
minimap.addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (mode !== 'rts') return;
  const w = minimapToWorld(e);
  if (e.button === 2) commandMove(liveSelection(), w.x, w.z);
  else rts.focus.set(w.x, 0, w.z);
});

// touch joystick
const stick = document.getElementById('stick'), knob = document.getElementById('knob');
let stickId = null;
function stickUpdate(e) {
  const r = stick.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  fps.stickX = dx / max; fps.stickY = dy / max;
}
stick.addEventListener('pointerdown', e => { e.preventDefault(); stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch { /* ignore */ } stickUpdate(e); });
stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickUpdate(e); });
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; fps.stickX = fps.stickY = 0; knob.style.transform = ''; };
stick.addEventListener('pointerup', stickEnd);
stick.addEventListener('pointercancel', stickEnd);

// buttons
const $ = id => document.getElementById(id);
const btnFire = $('btnFire');
btnFire.addEventListener('pointerdown', e => { e.preventDefault(); try { btnFire.setPointerCapture(e.pointerId); } catch { /* ignore */ } fps.firing = true; });
btnFire.addEventListener('pointerup', () => { fps.firing = false; });
btnFire.addEventListener('pointercancel', () => { fps.firing = false; });
// Fire button doubles as an aim pad: dragging while holding it turns the view
btnFire.addEventListener('pointermove', e => {
  if (!fps.firing || !e.buttons) return;
  fps.yaw -= e.movementX * 0.005;
  fps.pitch = Math.max(-1.3, Math.min(1.3, fps.pitch - e.movementY * 0.005));
});

function tapButton(el, fn) {
  el.addEventListener('click', e => { e.preventDefault(); fn(); });
}
tapButton($('btnAll'), selectAll);
tapButton($('btnAMove'), toggleAMove);
tapButton($('btnPossess'), possessFromSelection);
tapButton($('btnExit'), exitFPS);
tapButton($('btnSwap'), swapUnit);
tapButton($('btnRally'), rally);
tapButton($('btnStart'), startGame);
tapButton($('btnRestart'), () => location.reload());

function selectAll() {
  const mine = entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER);
  selection = (liveSelection().length === mine.length) ? [] : mine;
  updateButtons();
}
function toggleAMove() {
  if (!liveSelection().length) { toast('Select units first', 1); return; }
  amoveArmed = !amoveArmed; updateButtons();
  if (amoveArmed) toast(isTouch ? 'Tap a destination' : 'Click a destination', 1);
}
function possessFromSelection() {
  const sel = liveSelection();
  if (sel.length) { possess(sel[0]); return; }
  // nothing selected: take the unit closest to the camera focus
  const mine = entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER);
  if (!mine.length) { toast('No units left', 1); return; }
  mine.sort((a, b) => Math.hypot(a.x - rts.focus.x, a.z - rts.focus.z) - Math.hypot(b.x - rts.focus.x, b.z - rts.focus.z));
  possess(mine[0]);
}
function updateButtons() {
  selection = selection.filter(u => !u.dead);
  const n = liveSelection().length;
  $('selInfo').textContent = n ? `${n} selected` : 'No units selected';
  $('btnAMove').classList.toggle('armed', amoveArmed);
}

let toastTimer = 0;
function toast(msg, secs = 2) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastTimer = secs;
}

function startGame() {
  initAudio();
  if (audio && audio.resume) audio.resume();
  $('menu').classList.add('hidden');
  setMode('rts');
  rts.focus.set(0, 0, 14);
  rts.zoom = camera.aspect < 1 ? 40 : 26; // portrait phones need a wider view
  selection = entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER);
  updateButtons();
  toast(isTouch ? 'Double-tap a soldier to take control' : 'Double-click a soldier (or press F) to take control', 3);
}

function endGame(won) {
  if (mode === 'over') return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (possessed) { possessed.possessed = false; possessed.mesh.visible = true; possessed = null; }
  setMode('over');
  document.body.classList.remove('fps');
  $('overTitle').textContent = won ? 'Victory' : 'Defeat';
  $('overText').textContent = won ? `Enemy command post destroyed after ${waveNum} waves.` : `Your command post fell during wave ${waveNum}.`;
  setTimeout(() => $('over').classList.remove('hidden'), 900);
}

// ---------------------------------------------------------------- HUD drawing
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio, 2);
  overlay.width = w * dpr; overlay.height = h * dpr;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function drawOverlay() {
  octx.clearRect(0, 0, innerWidth, innerHeight);
  for (const e of entities) {
    if (e.dead || e.possessed) continue;
    const selected = selection.includes(e);
    if (mode === 'menu') continue;
    const show = selected || e.hp < e.maxHp || e.isBase;
    if (!show) continue;
    const s = toScreen(e.x, e.isBase ? 5.8 : 2.0, e.z);
    if (s.behind || s.x < -50 || s.x > innerWidth + 50 || s.y < -20 || s.y > innerHeight + 20) continue;
    if (mode === 'fps' && Math.hypot(e.x - camera.position.x, e.z - camera.position.z) > 40) continue;
    const w = e.isBase ? 70 : 30, h = e.isBase ? 7 : 4;
    const k = Math.max(0, e.hp / e.maxHp);
    octx.fillStyle = 'rgba(0,0,0,.65)';
    octx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, h + 2);
    octx.fillStyle = e.team === PLAYER ? (k > 0.35 ? '#46e08a' : '#f0c040') : '#ff5a3c';
    octx.fillRect(s.x - w / 2, s.y, w * k, h);
  }
  if (boxSel) {
    octx.strokeStyle = '#5dff9a'; octx.lineWidth = 1.5;
    octx.fillStyle = 'rgba(93,255,154,.12)';
    const x = Math.min(boxSel.x0, boxSel.x1), y = Math.min(boxSel.y0, boxSel.y1);
    const w = Math.abs(boxSel.x1 - boxSel.x0), h = Math.abs(boxSel.y1 - boxSel.y0);
    octx.fillRect(x, y, w, h); octx.strokeRect(x, y, w, h);
  }
  if (mode === 'fps' && fps.hitMarker > 0) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    octx.strokeStyle = '#ffffff'; octx.lineWidth = 2;
    octx.beginPath();
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { octx.moveTo(cx + a * 7, cy + b * 7); octx.lineTo(cx + a * 14, cy + b * 14); }
    octx.stroke();
  }
}

function drawMinimap() {
  const W = minimap.width, s = W / N;
  const X = x => (x + HALF) * s;
  mctx.fillStyle = '#0d131a'; mctx.fillRect(0, 0, W, W);
  mctx.fillStyle = '#4b5666';
  for (const b of boxes) if (!b.owner) mctx.fillRect(X(b.minX), X(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
  for (const e of entities) {
    if (e.dead) continue;
    mctx.fillStyle = e.team === PLAYER ? (selection.includes(e) ? '#9dffc4' : '#3fa9ff') : '#ff5a3c';
    if (e.isBase) mctx.fillRect(X(e.x) - 6, X(e.z) - 6, 12, 12);
    else { const r = e.possessed ? 4 : 2.2; mctx.beginPath(); mctx.arc(X(e.x), X(e.z), r, 0, Math.PI * 2); mctx.fill(); }
  }
  mctx.strokeStyle = 'rgba(255,255,255,.7)'; mctx.lineWidth = 1;
  if (mode === 'fps' && possessed) {
    const x = X(possessed.x), z = X(possessed.z), a = fps.yaw;
    mctx.beginPath();
    mctx.moveTo(x, z);
    mctx.lineTo(x + (-Math.sin(a - 0.5)) * 22, z + (-Math.cos(a - 0.5)) * 22);
    mctx.moveTo(x, z);
    mctx.lineTo(x + (-Math.sin(a + 0.5)) * 22, z + (-Math.cos(a + 0.5)) * 22);
    mctx.stroke();
  } else {
    const vw = rts.zoom * camera.aspect * 0.75, vh = rts.zoom * 0.75;
    mctx.strokeRect(X(rts.focus.x - vw / 2), X(rts.focus.z - vh / 2), vw * s, vh * s);
  }
}

function updateHud(dt) {
  const pb = Math.max(0, Math.round(playerBase.hp / playerBase.maxHp * 100));
  const eb = Math.max(0, Math.round(enemyBase.hp / enemyBase.maxHp * 100));
  $('status').textContent = `Base ${pb}%  ·  Enemy post ${eb}%  ·  Army ${countUnits(PLAYER)} vs ${countUnits(ENEMY)}  ·  Wave ${waveNum + 1} in ${Math.ceil(waveTimer)}s`;
  if (possessed) {
    const k = Math.max(0, possessed.hp / possessed.maxHp);
    $('fpsHpFill').style.width = `${k * 100}%`;
    $('fpsHpText').textContent = `${possessed.type.toUpperCase()}  ${Math.ceil(possessed.hp)} / ${possessed.maxHp}  ·  x${POSSESS_DMG} damage`;
  }
  $('vignette').style.opacity = Math.min(1, fps.hurt * 2);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
}

// ---------------------------------------------------------------- main loop
setupWorld();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'rts' || mode === 'fps') {
    if (mode === 'fps') updateFPS(dt);
    for (const e of entities) if (!e.dead && !e.isBase) updateUnit(e, dt);
    separate();
    updateEnemyLegs();
    updateBases(dt);
    entities = entities.filter(e => !e.dead);
    selection = selection.filter(e => !e.dead);
  }
  for (const e of entities) {
    if (e.isBase) { e.bodyMat.emissive.setHex(e.flash > 0 ? 0x552211 : 0); e.flash -= dt; continue; }
    e.mesh.position.set(e.x, e.moving ? Math.abs(Math.sin(now / 90)) * 0.05 : 0, e.z);
    e.mesh.rotation.y = e.facing;
    e.ring.visible = selection.includes(e) && mode !== 'fps';
    e.bodyMat.emissive.setHex(e.flash > 0 ? 0xffffff : 0);
    e.bodyMat.emissiveIntensity = e.flash > 0 ? 0.6 : 0;
    e.flash -= dt;
  }
  fps.hitMarker -= dt;
  fps.hurt = Math.max(0, fps.hurt - dt);
  updateEffects(dt);
  updateCamera(dt);
  if (mode !== 'menu') updateHud(dt); else if (toastTimer > 0) toastTimer -= dt;
  renderer.render(scene, camera);
  drawOverlay();
  drawMinimap();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hook for automated smoke tests
window.__game = { get mode() { return mode; }, get entities() { return entities; }, get selection() { return selection; }, possess, exitFPS, startGame, commandMove, get possessed() { return possessed; }, fps };
