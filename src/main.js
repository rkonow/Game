// Fowl Play: ducks vs hens. RTS command view + first-person possession prototype.
//
// One loop: the three capture points can only be taken by a soldier you are
// controlling in first person. Points pay command points, which you spend in
// the command view on new soldiers. Hold all three and the enemy post's shield
// drops so your army can destroy it.
import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------- config
const HALF = 30;            // map spans [-HALF, HALF] on X and Z
const N = HALF * 2;         // pathfinding grid cells per side (1 unit each)
const PLAYER = 0, ENEMY = 1;
const TEAM_COLORS = [0x3fa9ff, 0xff5a3c];
const TYPES = {
  trooper: { hp: 60, speed: 4.2, range: 10, dmg: 7, rate: 0.45, radius: 0.45, acc: 0.7, ability: 'Egg bomb', abilityCd: 6 },
  heavy: { hp: 150, speed: 3.0, range: 8, dmg: 18, rate: 1.1, radius: 0.6, acc: 0.8, ability: 'Honk shield', abilityCd: 12 },
  sniper: { hp: 45, speed: 3.4, range: 16, dmg: 38, rate: 2.2, radius: 0.45, acc: 0.85, ability: 'Scope', abilityCd: 0 },
  elite: { hp: 450, speed: 4.4, range: 11, dmg: 12, rate: 0.25, radius: 0.75, acc: 0.8, ability: '', abilityCd: 0 },
};
const COSTS = { trooper: 20, heavy: 35, sniper: 30 };
const POSSESS_DMG = 2.0;    // damage multiplier while you drive the unit
const POSSESS_RATE = 0.6;   // fire-rate multiplier (lower = faster)
const EYE = 1.45;
const PLAYER_CAP = 20, ENEMY_CAP = 22;
const RELINK_CD = 5;        // wait after your soldier dies
const CP_BASE = 1, CP_PER_POINT = 1.5, CP_MAX = 200, CP_START = 40;
const POINT_DEFS = [['A', -17, 0], ['B', 0, 0], ['C', 17, 0]];
const POINT_R = 3;

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');
const $ = id => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8ff);
scene.fog = new THREE.Fog(0x9fd8ff, 60, 150);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5a7a35, 1.25));
const sun = new THREE.DirectionalLight(0xfff4dc, 1.9);
sun.position.set(18, 40, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 100 });
scene.add(sun);

// small canvas textures so everything stays procedural
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const grassTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#6fbf4a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#7ccb54'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#5fae3d' : '#8bd862';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 3 + Math.random() * 3);
  }
}, N / 4, N / 4);
const hayTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#e8c35a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = Math.random() < 0.5 ? '#c9a03c' : '#f6d878'; g.lineWidth = 1.5;
    const x = Math.random() * w, y = Math.random() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + Math.random() * 8, y + (Math.random() - 0.5) * 4); g.stroke();
  }
  g.fillStyle = '#a5532c'; g.fillRect(0, 18, w, 4); g.fillRect(0, 42, w, 4); // twine
});
const plankTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#a8703f'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = x % 32 ? '#b47c49' : '#9c6637'; g.fillRect(x, 0, 15, h); g.fillStyle = '#6e4423'; g.fillRect(x + 15, 0, 1, h); }
  g.fillStyle = '#5a3a1e'; g.fillRect(0, 12, w, 3); g.fillRect(0, 48, w, 3);
});

const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x5c9e3c }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
scene.add(outer);
const noRay = o => { o.raycast = () => {}; return o; };

// dirt lanes from barn to barn, and the duck pond
for (const x of [-17, 0, 17]) {
  const lane = noRay(new THREE.Mesh(new THREE.PlaneGeometry(4.5, 44), new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 1, transparent: true, opacity: 0.55 })));
  lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.01, 0);
  lane.receiveShadow = true;
  scene.add(lane);
}
{
  const pond = noRay(new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshStandardMaterial({ color: 0x4aa8e0, roughness: 0.15, metalness: 0.1 })));
  pond.rotation.x = -Math.PI / 2; pond.scale.set(1.5, 1, 1); pond.position.set(-21, 0.015, 26);
  scene.add(pond);
  const mud = noRay(new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 })));
  mud.rotation.x = -Math.PI / 2; mud.scale.set(1.6, 1, 1); mud.position.set(21, 0.015, -26);
  scene.add(mud);
}
// scenery outside the play area: trees, sunflowers, a wooden border fence
{
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 6), crownGeo = new THREE.IcosahedronGeometry(1.8, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4f2a }), crownMat = new THREE.MeshStandardMaterial({ color: 0x3f9a3a, flatShading: true });
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), headGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 10);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a8a2a }), petalMat = new THREE.MeshStandardMaterial({ color: 0xffcc1a, emissive: 0x332200 });
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = 34 + Math.random() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < 32) continue;
    const s = 0.8 + Math.random() * 0.8;
    const t = noRay(new THREE.Mesh(trunkGeo, trunkMat)); t.position.set(x, 1 * s, z); t.scale.setScalar(s);
    const c = noRay(new THREE.Mesh(crownGeo, crownMat)); c.position.set(x, 2.8 * s, z); c.scale.setScalar(s); c.castShadow = true;
    scene.add(t, c);
  }
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1, x = side * (31 + Math.random() * 2), z = -28 + (i / 46) * 56;
    const st = noRay(new THREE.Mesh(stemGeo, stemMat)); st.position.set(x, 0.8, z);
    const hd = noRay(new THREE.Mesh(headGeo, petalMat)); hd.position.set(x, 1.65, z); hd.rotation.x = Math.PI / 2 - 0.3; hd.rotation.z = side * 0.4;
    scene.add(st, hd);
  }
  const railMat = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 });
  for (const [x, z, w, d] of [[0, -30.3, 61, 0.15], [0, 30.3, 61, 0.15], [-30.3, 0, 0.15, 61], [30.3, 0, 0.15, 61]]) {
    for (const y of [0.4, 0.85]) { const r = noRay(new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), railMat)); r.position.set(x, y, z); scene.add(r); }
  }
}

// ---------------------------------------------------------------- obstacles: hay bales and fences
// [x, z, width, depth, height]; layout is mirrored so both sides are fair.
const OBSTACLE_DEFS = [
  [-10, 0, 5, 1.2, 2], [10, 0, 5, 1.2, 2],
  [0, -7, 1.2, 4, 1.8], [0, 7, 1.2, 4, 1.8],
  [-18, -10, 3, 3, 2.6], [18, 10, 3, 3, 2.6], [-18, 10, 3, 3, 2.6], [18, -10, 3, 3, 2.6],
  [-6, -14, 4, 1, 1.7], [6, 14, 4, 1, 1.7], [6, -14, 4, 1, 1.7], [-6, 14, 4, 1, 1.7],
  [-25, 0, 1.2, 9, 2.2], [25, 0, 1.2, 9, 2.2],
  [-13, -20, 1, 4, 1.8], [13, 20, 1, 4, 1.8], [13, -20, 1, 4, 1.8], [-13, 20, 1, 4, 1.8],
];
const boxes = []; // {minX,maxX,minZ,maxZ, owner?}
const staticShootables = [ground];
const hayMat = new THREE.MeshStandardMaterial({ map: hayTex, roughness: 1 });
const hayTopMat = new THREE.MeshStandardMaterial({ color: 0xf0d070, roughness: 1 });
const plankMat = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 });
const barnRedMat = new THREE.MeshStandardMaterial({ color: 0xc8402c, roughness: 0.8 });
for (const [x, z, w, d, h] of OBSTACLE_DEFS) {
  const fence = Math.min(w, d) <= 1;          // thin ones are wooden fences
  const shed = w === 3 && d === 3;            // square ones are little red sheds
  const mats = fence ? plankMat : shed ? [barnRedMat, barnRedMat, hayTopMat, barnRedMat, barnRedMat, barnRedMat] : [hayMat, hayMat, hayTopMat, hayMat, hayMat, hayMat];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  staticShootables.push(m);
  if (shed) { // pointy roof and a white door (decor only)
    const roof = noRay(new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x6b3a2a, flatShading: true })));
    roof.position.set(x, h + 0.7, z); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    const door = noRay(new THREE.Mesh(new THREE.PlaneGeometry(1, 1.6), new THREE.MeshStandardMaterial({ color: 0xffffff })));
    door.position.set(x, 0.8, z + (z > 0 ? -1.51 : 1.51)); if (z > 0) door.rotation.y = Math.PI;
    scene.add(roof, door);
  } else if (!fence) { // a smaller bale stacked on top
    const top = noRay(new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.6, d * 0.9), [hayMat, hayMat, hayTopMat, hayMat, hayMat, hayMat]));
    top.position.set(x + w * 0.12, h + 0.3, z); top.castShadow = true;
    scene.add(top);
  }
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

// ---------------------------------------------------------------- capture points: nests with a giant egg
const NEUTRAL_COLOR = 0xfff6e0;
const points = POINT_DEFS.map(([name, x, z]) => {
  const g = new THREE.Group();
  const disc = noRay(new THREE.Mesh(new THREE.CircleGeometry(POINT_R, 40), new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.18, depthWrite: false })));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
  const rim = noRay(new THREE.Mesh(new THREE.RingGeometry(POINT_R - 0.15, POINT_R, 48), new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.8, depthWrite: false })));
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.04;
  const arc = noRay(new THREE.Mesh(new THREE.RingGeometry(POINT_R + 0.1, POINT_R + 0.45, 48, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  arc.rotation.x = -Math.PI / 2; arc.position.y = 0.05;
  const nest = noRay(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.35, 8, 20), new THREE.MeshStandardMaterial({ map: hayTex, roughness: 1 })));
  nest.rotation.x = -Math.PI / 2; nest.position.y = 0.25; nest.castShadow = true;
  const eggMat = new THREE.MeshStandardMaterial({ color: NEUTRAL_COLOR, roughness: 0.35, emissive: 0x111111 });
  const flag = noRay(new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), eggMat)); // the egg
  flag.scale.set(1, 1.35, 1); flag.position.y = 1.0; flag.castShadow = true;
  g.add(disc, rim, arc, nest, flag);
  g.position.set(x, 0, z);
  scene.add(g);
  return { name, x, z, owner: null, prog: 0, disc, rim, arc, flag, lastArc: -2 };
});
const pointColor = p => (p.owner === PLAYER ? TEAM_COLORS[PLAYER] : p.owner === ENEMY ? TEAM_COLORS[ENEMY] : NEUTRAL_COLOR);
const playerPointCount = () => points.filter(p => p.owner === PLAYER).length;

// ---------------------------------------------------------------- entities: ducks vs hens
let entities = [];
const teamMats = TEAM_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3a24, roughness: 0.5, metalness: 0.3 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc340, emissive: 0x7a4a00, roughness: 0.35, metalness: 0.5 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0xfff07a, emissive: 0xffd000, emissiveIntensity: 0.5 });
const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 });
const beakMat = new THREE.MeshStandardMaterial({ color: 0xffb21f, roughness: 0.5 });
const combMat = new THREE.MeshStandardMaterial({ color: 0xe0242a, roughness: 0.6 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
const bucketMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.35, metalness: 0.7 });
const strawMat = new THREE.MeshStandardMaterial({ color: 0xe6c66a, roughness: 1 });
const BODY_COLORS = [0xffd84a, 0xf6f2ea];      // ducks are yellow, hens are white
const NAMES = [
  { trooper: 'Duck', heavy: 'Goose', sniper: 'Heron' },
  { trooper: 'Hen', heavy: 'Turkey', sniper: 'Pigeon', elite: 'Big Rooster' },
];
const nameOf = u => NAMES[u.team][u.type];
const sphere = new THREE.SphereGeometry(1, 14, 10);

function tagMeshes(group, ent) {
  group.traverse(o => { o.userData.entity = ent; if (o.isMesh) o.castShadow = true; });
}
function blob(mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(sphere, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m;
}

function makeUnit(team, type, x, z) {
  const t = TYPES[type];
  const u = {
    kind: 'unit', type, team, x, z, hp: t.hp, maxHp: t.hp, speed: t.speed, range: t.range,
    dmg: t.dmg, rate: t.rate, radius: t.radius, acc: t.acc,
    facing: team === PLAYER ? 0 : Math.PI, cool: Math.random() * t.rate, abilityCd: 0, armorT: 0,
    order: { type: 'idle' }, path: null, pathGoal: null, possessed: false, dead: false, flash: 0,
    elite: type === 'elite',
  };
  const g = new THREE.Group();
  const bodyMat = type === 'elite' ? goldMat.clone() : new THREE.MeshStandardMaterial({ color: type === 'heavy' && team === PLAYER ? 0xf2f2f2 : type === 'sniper' && team === PLAYER ? 0x9fb8d0 : type === 'heavy' ? 0x8a5a3a : type === 'sniper' ? 0x8e95a8 : BODY_COLORS[team], roughness: 0.7 });
  u.bodyMat = bodyMat;
  const r = t.radius;
  const tall = type === 'heavy' || type === 'sniper';   // geese, herons, turkeys, pigeons stretch their necks
  // body, tail, wings, feet
  g.add(blob(bodyMat, r * 1.15, 0.5, r * 1.45, 0, 0.62, 0));
  const tail = blob(bodyMat, r * 0.5, 0.22, 0.35, 0, 0.82, r * 1.25); tail.rotation.x = -0.6; g.add(tail);
  if (team === ENEMY && type === 'heavy') { // turkey fan
    for (let k = -2; k <= 2; k++) { const f = blob(k % 2 ? combMat : bodyMat, 0.18, 0.55, 0.05, k * 0.22, 1.2, r * 1.3); f.rotation.z = -k * 0.3; g.add(f); }
  }
  g.add(blob(bodyMat, 0.12, 0.32, r * 0.9, -r * 1.05, 0.68, 0.05), blob(bodyMat, 0.12, 0.32, r * 0.9, r * 1.05, 0.68, 0.05));
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.3), orangeMat); f.position.set(s * 0.18, 0.03, -0.08); g.add(f); }
  // neck + head
  const headY = tall ? 1.5 : 1.3, headZ = -r * 0.75;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, headY - 0.75, 8), bodyMat);
  neck.position.set(0, (headY + 0.75) / 2, headZ * 0.85); g.add(neck);
  g.add(blob(bodyMat, 0.27, 0.26, 0.28, 0, headY, headZ));
  for (const s of [-1, 1]) g.add(blob(eyeMat, 0.05, 0.06, 0.05, s * 0.17, headY + 0.07, headZ - 0.18));
  if (team === PLAYER) { // flat duck bill
    const bill = blob(type === 'sniper' ? beakMat : orangeMat, 0.15, 0.06, type === 'sniper' ? 0.42 : 0.24, 0, headY - 0.04, headZ - 0.32); g.add(bill);
  } else { // pointy beak, comb and wattle
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), beakMat); beak.rotation.x = -Math.PI / 2; beak.position.set(0, headY - 0.02, headZ - 0.33); g.add(beak);
    for (let k = -1; k <= 1; k++) g.add(blob(combMat, 0.06, type === 'elite' ? 0.2 : 0.12, 0.07, 0, headY + 0.27 + (k ? 0 : 0.04), headZ + k * 0.1));
    g.add(blob(combMat, 0.05, 0.09, 0.05, 0, headY - 0.18, headZ - 0.22));
  }
  // team bandana so sides read at a glance from above
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.06, 6, 14), teamMats[team]);
  band.rotation.x = Math.PI / 2; band.position.set(0, 0.95, headZ * 0.8); g.add(band);
  // hats
  if (type === 'heavy') {
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 12), bucketMat); bucket.position.set(0, headY + 0.27, headZ + 0.02); g.add(bucket);
  } else if (type === 'sniper') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.04, 16), strawMat); brim.position.set(0, headY + 0.23, headZ);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 12), strawMat); crown.position.set(0, headY + 0.34, headZ);
    g.add(brim, crown);
  } else if (type === 'elite') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.2, 5, 1, true), goldMat); crown.position.set(0, headY + 0.5, headZ); g.add(crown);
  }
  // corn blaster: green tube with a yellow hopper
  const gunLen = { heavy: 0.9, elite: 1.0, sniper: 1.4 }[type] || 0.7;
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, gunLen, 8), darkMat);
  gun.rotation.x = Math.PI / 2; gun.position.set(r * 0.85, 0.95, -gunLen / 2);
  const hopper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.16), visorMat); hopper.position.set(r * 0.85, 1.07, -0.1);
  g.add(gun, hopper);
  u.muzzleOffset = { side: r * 0.85, fwd: gunLen, y: 0.95 };
  if (type === 'elite') g.scale.setScalar(1.3);
  tagMeshes(g, u);
  const ring = noRay(new THREE.Mesh(
    new THREE.RingGeometry(r + 0.12, r + 0.28, 28),
    new THREE.MeshBasicMaterial({ color: 0x2dff7a, transparent: true, opacity: 0.95, depthWrite: false })
  ));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.visible = false;
  g.add(ring);
  u.ring = ring;
  u.mesh = g;
  g.position.set(x, 0, z);
  scene.add(g);
  entities.push(u);
  return u;
}

// bases: the duck barn (blue) and the hen coop (red), with a golden egg on the roof
function makeBase(team, x, z) {
  const b = {
    kind: 'base', isBase: true, team, x, z, hp: 1500, maxHp: 1500, radius: 2.5, dead: false, flash: 0,
    shield: team === ENEMY,
  };
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: team === PLAYER ? 0x4f86c6 : 0xc8402c, roughness: 0.8 });
  b.bodyMat = bodyMat;
  const trim = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const core = new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 5), bodyMat);
  core.position.y = 1.4;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 5.4, 3, 1, false, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a3326, flatShading: true }));
  roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.position.y = 3.75; roof.scale.set(1, 1, 1.45);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2, 1.9, 0.1), trim);
  door.position.set(0, 0.95, team === PLAYER ? -2.52 : 2.52);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 0.12), bodyMat);
  cross.position.copy(door.position); cross.rotation.z = 0.7;
  const cross2 = cross.clone(); cross2.rotation.z = -0.7;
  const beacon = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xffd34a, emissive: 0xffa000, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 }));
  beacon.scale.set(0.5, 0.65, 0.5);
  beacon.position.y = 4.9;
  g.add(core, roof, door, cross, cross2, beacon);
  b.beacon = beacon;
  tagMeshes(g, b);
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  if (b.shield) { // a giant eggshell dome
    const sh = noRay(new THREE.Mesh(
      new THREE.SphereGeometry(4.4, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
    ));
    sh.scale.set(1, 1.3, 1);
    sh.position.y = 0.8;
    sh.add(noRay(new THREE.Mesh(
      new THREE.SphereGeometry(4.42, 14, 8),
      new THREE.MeshBasicMaterial({ color: 0xd8b98a, wireframe: true, transparent: true, opacity: 0.3, depthWrite: false })
    )));
    g.add(sh);
    b.shieldMesh = sh;
  }
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
  if (isFree(toCell(tx), toCell(tz))) pts[pts.length - 1] = { x: tx, z: tz };
  const out = []; // string-pull smoothing
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
    const dx = u.x - px, dz = u.z - pz;
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
for (let i = 0; i < 90; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = noRay(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 })));
  line.frustumCulled = false; line.visible = false;
  scene.add(line);
  tracerPool.push({ line, life: 0, max: 0.09 });
}
let tracerIdx = 0;
function tracer(ax, ay, az, bx, by, bz, color = 0xffe08a, life = 0.09) {
  const t = tracerPool[tracerIdx++ % tracerPool.length];
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, ax, ay, az); p.setXYZ(1, bx, by, bz); p.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.visible = true; t.life = life; t.max = life;
}

const effects = [];
const sparkGeo = new THREE.SphereGeometry(1, 12, 8);
function burst(x, y, z, size, color) {
  const m = noRay(new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })));
  m.position.set(x, y, z); m.scale.setScalar(size * 0.3);
  scene.add(m);
  effects.push({ m, life: 0.45, max: 0.45, size });
}
function ping(x, z, color, size = 1, life = 0.5) {
  const m = noRay(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.09, z);
  scene.add(m);
  effects.push({ m, life, max: life, ring: true, size });
}
// visible bullets: corn kernels (ducks), seeds (hens), gold (rooster). Purely visual unless onArrive is given.
const bulletGeo = new THREE.BoxGeometry(0.06, 0.06, 0.55);
const bulletMats = {
  corn: new THREE.MeshBasicMaterial({ color: 0xfff07a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  seed: new THREE.MeshBasicMaterial({ color: 0xfff4ea, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  gold: new THREE.MeshBasicMaterial({ color: 0xffc340, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
};
const bullets = [];
for (let i = 0; i < 220; i++) {
  const m = noRay(new THREE.Mesh(bulletGeo, bulletMats.corn));
  m.visible = false; m.frustumCulled = false;
  scene.add(m);
  bullets.push({ m, active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, went: 0, speed: 0, onArrive: null });
}
let bulletIdx = 0;
function shootBullet(from, to, kind, speed, onArrive, scale = 1) {
  const b = bullets[bulletIdx++ % bullets.length];
  if (b.active && b.onArrive) b.onArrive(); // pool wrapped: settle the old one now
  b.active = true; b.m.visible = true; b.m.material = bulletMats[kind];
  b.from.copy(from); b.dir.subVectors(to, from); b.dist = b.dir.length(); b.dir.normalize();
  b.went = 0; b.speed = speed; b.onArrive = onArrive || null;
  b.m.position.copy(from); b.m.lookAt(to); b.m.scale.set(scale, scale, scale * Math.min(1.6, speed / 90));
}
function updateBullets(dt) {
  for (const b of bullets) {
    if (!b.active) continue;
    b.went += b.speed * dt;
    if (b.went >= b.dist) {
      b.active = false; b.m.visible = false;
      const f = b.onArrive; b.onArrive = null; if (f) f();
    } else b.m.position.copy(b.from).addScaledVector(b.dir, b.went);
  }
}

// little bits that fly and bounce: popcorn shells, dust, hay
const debris = [];
const debrisGeo = new THREE.IcosahedronGeometry(1, 0);
const debrisMats = {};
function debrisMat(c) { return debrisMats[c] || (debrisMats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); }
function spawnDebris(pos, vel, color, size = 0.05, life = 0.9) {
  const m = noRay(new THREE.Mesh(debrisGeo, debrisMat(color)));
  m.position.copy(pos); m.scale.setScalar(size);
  scene.add(m);
  debris.push({ m, v: vel, life, spin: (Math.random() - 0.5) * 20 });
  if (debris.length > 160) { const d = debris.shift(); scene.remove(d.m); }
}
function impactPuff(p, color, n = 5) {
  for (let i = 0; i < n; i++) spawnDebris(p, new THREE.Vector3((Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 4), color, 0.035 + Math.random() * 0.03, 0.5 + Math.random() * 0.3);
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    d.v.y -= 14 * dt;
    d.m.position.addScaledVector(d.v, dt);
    if (d.m.position.y < 0.03) { d.m.position.y = 0.03; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; }
    d.m.rotation.x += d.spin * dt; d.m.rotation.y += d.spin * 0.7 * dt;
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
}

// floating damage numbers (first person only)
const dmgNums = [];
function dmgNumber(p, amount, crit) {
  dmgNums.push({ x: p.x, y: p.y + 0.3, z: p.z, text: String(Math.round(amount)), life: 0.8, crit, dx: (Math.random() - 0.5) * 30 });
  if (dmgNums.length > 40) dmgNums.shift();
}

const feathersList = [];
const featherGeo = new THREE.PlaneGeometry(0.16, 0.32);
function feathers(x, z, color, n) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
  for (let i = 0; i < n; i++) {
    const m = noRay(new THREE.Mesh(featherGeo, mat));
    m.position.set(x + (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.6);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(m);
    feathersList.push({ m, mat, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 5, spin: (Math.random() - 0.5) * 10, life: 1.6 + Math.random() * 0.8 });
  }
}
function updateEffects(dt) {
  for (let i = feathersList.length - 1; i >= 0; i--) {
    const f = feathersList[i];
    f.life -= dt;
    f.vy = Math.max(-1.2, f.vy - 9 * dt); f.vx *= 1 - dt * 2; f.vz *= 1 - dt * 2; // flutter down
    f.m.position.x += f.vx * dt; f.m.position.y = Math.max(0.05, f.m.position.y + f.vy * dt); f.m.position.z += f.vz * dt;
    f.m.rotation.x += f.spin * dt; f.m.rotation.z += f.spin * 0.6 * dt;
    if (f.life <= 0) { scene.remove(f.m); feathersList.splice(i, 1); }
  }
  for (const t of tracerPool) if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / t.max); if (t.life <= 0) t.line.visible = false; }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = 1 - e.life / e.max;
    if (e.ring) e.m.scale.setScalar(e.size * (1 + k * 1.2));
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
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.8, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
  } catch { audio = null; }
}
function sfx(kind, x, z) {
  if (!audio || audio.state !== 'running') return;
  let vol = 0.25;
  if (x !== undefined) {
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    vol = (mode === 'rts' ? 0.08 : 0.18) / (1 + d * 0.12);
  }
  const now = audio.currentTime;
  if (kind === 'quack' || kind === 'bawk' || kind === 'honk') {
    // a nasal sawtooth through a formant filter, pitch falling: quack / bawk / honk
    const base = kind === 'quack' ? 420 : kind === 'bawk' ? 700 : 260;
    const reps = kind === 'bawk' ? 2 : 1;
    for (let r = 0; r < reps; r++) {
      const t0 = now + r * 0.13;
      const o = audio.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * 0.55, t0 + 0.16);
      const bp = audio.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = kind === 'honk' ? 900 : 1500; bp.Q.value = 3;
      const og = audio.createGain();
      const v = x === undefined ? 0.22 : vol * 4;
      og.gain.setValueAtTime(0.001, t0); og.gain.exponentialRampToValueAtTime(v, t0 + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t0 + (kind === 'honk' ? 0.3 : 0.18));
      o.connect(bp); bp.connect(og); og.connect(audio.destination); o.start(t0); o.stop(t0 + 0.32);
    }
    return;
  }
  if (kind === 'beep' || kind === 'chime') {
    const o = audio.createOscillator(); const og = audio.createGain();
    o.frequency.setValueAtTime(kind === 'chime' ? 660 : 880, now);
    if (kind === 'chime') o.frequency.setValueAtTime(990, now + 0.1);
    og.gain.setValueAtTime(0.08, now); og.gain.exponentialRampToValueAtTime(0.001, now + (kind === 'chime' ? 0.3 : 0.12));
    o.connect(og); og.connect(audio.destination); o.start(now); o.stop(now + 0.32);
    return;
  }
  const src = audio.createBufferSource(); src.buffer = noiseBuf;
  const f = audio.createBiquadFilter(); f.type = 'bandpass';
  const g = audio.createGain();
  let len = 0.5;
  if (kind === 'pop') { f.frequency.value = 1900 + Math.random() * 500; src.playbackRate.value = 1.6 + Math.random() * 0.3; g.gain.setValueAtTime(vol * 1.3, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.07); len = 0.1; }
  else if (kind === 'blast') { f.type = 'lowpass'; f.frequency.value = 900; src.playbackRate.value = 0.8; g.gain.setValueAtTime(vol * 3.2, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.28); len = 0.3; }
  else if (kind === 'crack') { f.frequency.value = 2600; src.playbackRate.value = 1.1; g.gain.setValueAtTime(vol * 3, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.35); len = 0.4; }
  else if (kind === 'shot') { f.frequency.value = 1400; src.playbackRate.value = 1.4; g.gain.setValueAtTime(vol * 1.6, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12); }
  else if (kind === 'hit') { f.frequency.value = 3200; src.playbackRate.value = 2; g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06); }
  else if (kind === 'whoosh') {
    f.type = 'lowpass'; f.frequency.setValueAtTime(200, now); f.frequency.exponentialRampToValueAtTime(2400, now + 0.7);
    src.playbackRate.value = 0.7; g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(0.35, now + 0.5); g.gain.exponentialRampToValueAtTime(0.001, now + 0.9); len = 1;
  } else { f.frequency.value = 300; src.playbackRate.value = 0.6; g.gain.setValueAtTime(vol * 3, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.5); }
  src.connect(f); f.connect(g); g.connect(audio.destination);
  src.start(now); src.stop(now + len);
}

// ---------------------------------------------------------------- game state
let mode = 'menu';           // 'menu' | 'rts' | 'fps' | 'over'
let selection = [];
let possessed = null;
let amoveArmed = false;
let waveTimer = 16, waveNum = 0;
let eliteTimer = 75, eliteWarned = false;
let playerBase, enemyBase;
const grenades = [];
const game = { cp: CP_START, relink: 0, slowmo: 0, time: 0 };
const rts = { focus: new THREE.Vector3(0, 0, 14), zoom: 26 };
const fps = {
  yaw: 0, pitch: 0, firing: false, bob: 0, hitMarker: 0, killMarker: 0, hurt: 0, flash: 0, stickX: 0, stickY: 0, scoped: false,
  recoil: 0, vmKick: 0, shake: 0, bloom: 0, vx: 0, vz: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0,
};
// first-person guns (you only): fast and punchy. Damage already includes the hero bonus.
const GUNS = {
  trooper: { rate: 0.09, dmg: 6, spread: 0.012, pellets: 1, kick: 0.010, shake: 0.025, speed: 120, sound: 'pop' },
  heavy: { rate: 0.55, dmg: 10, spread: 0.065, pellets: 7, kick: 0.05, shake: 0.14, speed: 95, sound: 'blast' },
  sniper: { rate: 0.85, dmg: 65, spread: 0.025, pellets: 1, kick: 0.07, shake: 0.08, speed: 220, sound: 'crack' },
  elite: { rate: 0.12, dmg: 8, spread: 0.015, pellets: 1, kick: 0.012, shake: 0.03, speed: 120, sound: 'pop' },
};
let trans = null;            // camera transition
// Tactics mode: plan with the game paused, then ROUND_TIME seconds of live combat.
const ROUND_TIME = 20;
const tac = { on: false, phase: 'plan', round: 0, t: 0, hero: null, tool: 'move', rallyUsed: false };
const keys = new Set();
let isTouch = false;

function setupWorld() {
  playerBase = makeBase(PLAYER, 0, 25);
  enemyBase = makeBase(ENEMY, 0, -25);
  rebuildGrid();
  const start = [['trooper', -3, 17], ['trooper', 3, 17], ['trooper', -1, 17], ['trooper', 1, 17], ['heavy', -2, 19], ['sniper', 2, 19]];
  for (const [t, x, z] of start) makeUnit(PLAYER, t, x, z);
  for (const [x, z, t] of [[-4, -18, 'trooper'], [4, -18, 'trooper'], [-2, -16, 'trooper'], [2, -16, 'sniper'], [0, -19, 'heavy']]) makeUnit(ENEMY, t, x, z);
}

// ---------------------------------------------------------------- radio alerts (with optional "Drop in" action)
const radioEl = $('radio');
const radioGate = {};
function radio(msg, kind = '', opts = {}) {
  const now = performance.now();
  const key = opts.key || msg;
  if (opts.gap && radioGate[key] > now) return;
  radioGate[key] = now + (opts.gap || 0) * 1000;
  const d = document.createElement('div');
  if (kind) d.className = kind;
  const span = document.createElement('span'); span.textContent = msg; d.appendChild(span);
  if (opts.dropAt && !tac.on) {
    const b = document.createElement('button');
    b.textContent = 'Drop in ▶';
    tapButton(b, () => { dropInNear(opts.dropAt.x, opts.dropAt.z); d.remove(); });
    d.appendChild(b);
  }
  radioEl.appendChild(d);
  while (radioEl.children.length > 4) radioEl.removeChild(radioEl.firstChild);
  const life = opts.dropAt && !tac.on ? 7000 : 4500;
  setTimeout(() => d.classList.add('fade'), life);
  setTimeout(() => d.remove(), life + 700);
  if (kind === 'warn') sfx('beep');
}

// ---------------------------------------------------------------- orders
function liveSelection() { return selection.filter(u => !u.dead && !u.possessed); }
const playerUnits = () => entities.filter(e => !e.dead && !e.isBase && e.team === PLAYER);

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
function commandMove(units, x, z, type = 'move', quiet = false) {
  if (!units.length) return;
  const spots = formationSpots(units.length, x, z);
  const sorted = [...units].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  sorted.forEach((u, i) => {
    const [sx, sz] = spots[i];
    u.order = { type, x: sx, z: sz };
    u.path = findPath(u.x, u.z, sx, sz); u.pathGoal = { x: sx, z: sz };
  });
  if (!quiet) ping(x, z, type === 'amove' ? 0xff7a5a : 0x5dff9a);
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
    let s = d + (e.isBase ? 8 : 0) + (hasLOS(u, e) ? 0 : 4);
    if (u.elite && e.possessed) s -= 12; // the enemy elite hunts your soldier
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

function muzzlePos(u) {
  const f = u.facing, m = u.muzzleOffset, sc = u.elite ? 1.3 : 1;
  const fx = -Math.sin(f), fz = -Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
  return { x: u.x + (fx * m.fwd + rx * m.side) * sc, y: m.y * sc, z: u.z + (fz * m.fwd + rz * m.side) * sc };
}

function aiShoot(u, t) {
  // ducks/hens/rooster fire 3-round bursts, others single shots (same damage per second as before)
  const burstN = u.type === 'trooper' || u.elite ? 3 : 1;
  if (!u.burstLeft) u.burstLeft = burstN;
  u.burstLeft--;
  u.cool = u.burstLeft ? 0.09 : u.rate * burstN * (0.85 + Math.random() * 0.3);
  const m = muzzlePos(u);
  const hit = Math.random() < u.acc;
  const ty = t.isBase ? 1.5 : 1.0;
  let tx = t.x, tz = t.z;
  if (t.isBase) { const d = Math.hypot(u.x - t.x, u.z - t.z) || 1; const r = t.shield ? 4.4 : 2.4; tx = t.x + (u.x - t.x) / d * r; tz = t.z + (u.z - t.z) / d * r; }
  const kind = u.elite ? 'gold' : u.team === PLAYER ? 'corn' : 'seed';
  const from = new THREE.Vector3(m.x, m.y, m.z);
  const speed = u.type === 'sniper' ? 110 : 60;
  if (hit) {
    const dmg = u.dmg;
    shootBullet(from, new THREE.Vector3(tx, ty, tz), kind, speed, () => { if (!t.dead) damage(t, dmg, u); });
    if (u.type === 'sniper') tracer(m.x, m.y, m.z, tx, ty, tz, u.team === PLAYER ? 0xfff07a : 0xffffff, 0.2);
  } else {
    const miss = new THREE.Vector3(tx + (Math.random() - 0.5) * 2.5, ty + (Math.random() - 0.3) * 1.2, tz + (Math.random() - 0.5) * 2.5);
    miss.sub(from).multiplyScalar(1.6).add(from); miss.y = Math.max(0, miss.y);
    shootBullet(from, miss, kind, speed);
  }
  if (Math.random() < 0.6) sfx(u.type === 'heavy' ? 'blast' : 'pop', u.x, u.z);
}

let shieldToast = 0;
function damage(t, amount, src) {
  if (t.dead || amount <= 0) return;
  if (t.isBase && t.shield) {
    if (Math.random() < 0.3) burst(t.x + (Math.random() - 0.5) * 6, 1 + Math.random() * 3, t.z + (Math.random() - 0.5) * 6, 0.4, 0xffa080);
    if (src && src.possessed && performance.now() > shieldToast) { shieldToast = performance.now() + 3000; toast('Eggshell shield! Hold all 3 nests to crack it', 1.5); }
    return;
  }
  if (t.armorT > 0) amount *= 0.5;
  t.hp -= amount;
  t.flash = 0.12;
  if (t.possessed) { fps.hurt = 0.5; fps.shake = Math.min(0.3, fps.shake + 0.06); }
  if (t === playerBase) radio('Our barn is under attack!', 'warn', { key: 'base', gap: 10, dropAt: playerBase });
  if (!tac.on && !t.isBase && !t.possessed && t.order.type === 'idle' && src && src.kind === 'unit' && !src.dead) t.order = { type: 'attack', target: src, auto: true };
  if (t.hp <= 0) kill(t, src);
}

const cap = s => s[0].toUpperCase() + s.slice(1);
function kill(e, src) {
  e.dead = true;
  burst(e.x, e.isBase ? 2 : 1, e.z, e.isBase ? 6 : 1.2, e.isBase ? 0xffaa44 : 0xffffff);
  feathers(e.x, e.z, e.isBase ? 0xffe6a0 : e.elite ? 0xffc340 : e.team === PLAYER ? 0xffd84a : 0xffffff, e.isBase ? 40 : 14);
  sfx(e.isBase ? 'boom' : e.team === PLAYER ? 'quack' : 'bawk', e.x, e.z);
  scene.remove(e.mesh);
  if (e.isBase) {
    const i = boxes.indexOf(e.box); if (i >= 0) boxes.splice(i, 1);
    rebuildGrid();
    endGame(e.team === ENEMY);
    return;
  }
  if (e.team === ENEMY && !tac.on) {
    game.cp = Math.min(CP_MAX, game.cp + 3);
    if (e.elite) { game.cp = Math.min(CP_MAX, game.cp + 40); radio('The Big Rooster is plucked! +40 corn', 'good'); }
  }
  if (tac.on) {
    if (e === possessed) { radio(`Your hero ${nameOf(e).toLowerCase()} got cooked. Watch the rest of the round.`, 'warn'); rts.focus.set(e.x, 0, e.z); possessed = null; exitFPS(); }
    if (!countUnits(ENEMY)) endGame(true, `Every hen plucked in ${tac.round} round${tac.round === 1 ? '' : 's'}.`);
    else if (!countUnits(PLAYER)) endGame(false, `Your flock was wiped out in round ${tac.round}.`);
    return;
  }
  if (e.team === PLAYER && e === possessed) {
    game.relink = RELINK_CD;
    radio(`Your ${nameOf(e).toLowerCase()} got cooked. Drop in again in ${RELINK_CD}s.`, 'warn');
    rts.focus.set(e.x, 0, e.z);
    possessed = null;
    exitFPS();
  }
}

// ---------------------------------------------------------------- simulation
function updateUnit(u, dt) {
  u.cool -= dt;
  u.abilityCd -= dt;
  u.armorT -= dt;
  u.moving = false;
  if (u.possessed) return;
  const o = u.order;
  if (o.type === 'bomb') { // walk until in throwing range, then lob an egg bomb
    if (Math.hypot(o.x - u.x, o.z - u.z) <= 10) { throwEgg(u, o.x, o.z); u.order = { type: 'idle' }; }
    else { pathTo(u, o.x, o.z); moveAlong(u, dt); }
    return;
  }
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
    if (o.auto && d > u.range + 8) { u.order = { type: 'idle' }; return; }
    if (tac.on && o.type === 'idle') return; // in tactics, idle means hold this spot
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

const countUnits = team => entities.reduce((n, e) => n + (!e.dead && !e.isBase && e.team === team ? 1 : 0), 0);

// capture: only your possessed soldier captures for you; any enemy soldier captures for them
function updatePoints(dt) {
  for (const p of points) {
    const inside = e => !e.dead && !e.isBase && Math.hypot(e.x - p.x, e.z - p.z) < POINT_R;
    const you = possessed && inside(possessed);
    const foes = entities.filter(e => e.team === ENEMY && inside(e)).length;
    const before = p.prog;
    p.contested = you && foes > 0;
    if (!p.contested) {
      if (you) p.prog = Math.min(1, p.prog + dt / 3);
      else if (foes) p.prog = Math.max(-1, p.prog - dt * Math.min(0.4, 0.12 * foes));
    }
    p.capturing = you && !p.contested && p.prog < 1;
    // ownership flips at the ends, and is lost when the bar crosses the middle
    if (p.prog >= 1 && p.owner !== PLAYER) {
      p.owner = PLAYER; sfx('chime'); burst(p.x, 1, p.z, 3, TEAM_COLORS[PLAYER]);
      radio(`Nest ${p.name} is ours! +${CP_PER_POINT} corn/s`, 'good');
      onPointsChanged();
    } else if (p.prog <= -1 && p.owner !== ENEMY) {
      p.owner = ENEMY;
      radio(`The hens stole nest ${p.name}`, 'warn', { dropAt: p });
      onPointsChanged();
    } else if ((p.owner === PLAYER && p.prog <= 0) || (p.owner === ENEMY && p.prog >= 0)) {
      p.owner = null; onPointsChanged();
    }
    if (p.owner === PLAYER && foes && !you && p.prog < before) {
      radio(`Hens are pecking at nest ${p.name}!`, 'warn', { key: 'atk' + p.name, gap: 9, dropAt: p });
    }
    // visuals
    const col = pointColor(p);
    p.rim.material.color.setHex(col); p.flag.material.color.setHex(col); p.disc.material.color.setHex(col);
    p.disc.material.opacity = p.capturing ? 0.22 + Math.sin(game.time * 8) * 0.06 : 0.12;
    p.flag.position.y = 1.0 + (p.capturing ? Math.abs(Math.sin(game.time * 10)) * 0.25 : 0);
    p.flag.scale.set(1 + Math.abs(p.prog) * 0.25, 1.35 + Math.abs(p.prog) * 0.35, 1 + Math.abs(p.prog) * 0.25);
    const k = Math.abs(p.prog);
    if (Math.abs(k - p.lastArc) > 0.01) {
      p.lastArc = k;
      p.arc.geometry.dispose();
      p.arc.geometry = new THREE.RingGeometry(POINT_R + 0.1, POINT_R + 0.45, 48, 1, Math.PI / 2, Math.max(0.001, k * Math.PI * 2));
    }
    p.arc.material.color.setHex(p.prog >= 0 ? TEAM_COLORS[PLAYER] : TEAM_COLORS[ENEMY]);
    p.arc.visible = k > 0.01;
  }
}

function onPointsChanged() {
  if (tac.on) return; // tactics wins by holding nests at the end of a round
  const all = playerPointCount() === points.length;
  if (all && enemyBase.shield) {
    enemyBase.shield = false; enemyBase.shieldMesh.visible = false;
    burst(enemyBase.x, 2, enemyBase.z, 5, 0xffa080);
    radio('All 3 nests are ours: the eggshell cracked! Raid the coop!', 'good');
    commandMove(playerUnits().filter(e => !e.possessed), enemyBase.x, enemyBase.z + 6, 'amove', true);
    toast('Shell cracked! Raid the hen coop', 2.5);
  } else if (!all && !enemyBase.shield && !enemyBase.dead) {
    enemyBase.shield = true; enemyBase.shieldMesh.visible = true;
    radio('We lost a nest: the coop is shelled up again', 'warn');
  }
}

function spawnPlayer(type) {
  const u = makeUnit(PLAYER, type, (Math.random() - 0.5) * 3, 21.5);
  commandMove([u], (Math.random() - 0.5) * 8, 17 - Math.random() * 2, 'move', true);
  return u;
}

function buy(type) {
  if (mode !== 'rts' || tac.on) return;
  if (countUnits(PLAYER) >= PLAYER_CAP) { toast('The flock is full', 1); return; }
  if (game.cp < COSTS[type]) { toast(`${NAMES[PLAYER][type]} costs ${COSTS[type]} corn`, 1); return; }
  game.cp -= COSTS[type];
  const u = spawnPlayer(type);
  selection = [...liveSelection(), u];
  updateButtons();
  ping(u.x, u.z, 0x5dff9a);
}

function updateBases(dt) {
  if (!enemyBase.dead) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveNum++;
      waveTimer = Math.max(16, 26 - waveNum);
      const n = Math.min(3 + Math.floor(waveNum * 0.7), 9);
      // send the wave at a point the enemy doesn't own yet, preferring yours
      const targets = points.filter(p => p.owner !== ENEMY);
      const pt = (targets.find(p => p.owner === PLAYER) || targets[Math.floor(Math.random() * targets.length)] || points[waveNum % 3]);
      const spawned = [];
      for (let i = 0; i < n && countUnits(ENEMY) < ENEMY_CAP; i++) {
        const type = i % 4 === 3 ? 'sniper' : i % 3 === 2 ? 'heavy' : 'trooper';
        spawned.push(makeUnit(ENEMY, type, (Math.random() - 0.5) * 8, -21 - Math.random() * 1.5));
      }
      commandMove(spawned, pt.x, pt.z, 'amove', true);
      spawned.forEach(u => (u.order.point = pt));
      if (spawned.length) radio(`Hen wave ${waveNum} is heading for nest ${pt.name}`, 'warn', { dropAt: pt });
    }
    eliteTimer -= dt;
    const eliteAlive = entities.some(e => e.elite && !e.dead);
    if (!eliteAlive && eliteTimer <= 5 && !eliteWarned) { eliteWarned = true; radio('The Big Rooster wakes up in 5s!', 'warn'); }
    if (eliteTimer <= 0) {
      eliteTimer = 90; eliteWarned = false;
      if (!eliteAlive) {
        const e = makeUnit(ENEMY, 'elite', 0, -20);
        e.order = { type: 'amove', x: 0, z: 0 };
        radio('The Big Rooster is out. It hunts YOUR duck!', 'warn', { dropAt: { x: 0, z: 0 } });
      }
    }
    enemyBase.shieldMesh.material.opacity = 0.13 + Math.sin(game.time * 3) * 0.04;
  }
  for (const b of [playerBase, enemyBase]) if (!b.dead) b.beacon.position.y = 4.9 + Math.sin(game.time * 2.5) * 0.15;
}

let eliteRetarget = 0;
function updateEnemyOrders(dt) {
  eliteRetarget -= dt;
  for (const u of entities) {
    if (u.dead || u.isBase || u.team !== ENEMY) continue;
    if (u.elite) {
      if (eliteRetarget <= 0 && u.order.type !== 'attack') {
        const t = possessed || playerUnits()[0] || playerBase;
        u.order = { type: 'amove', x: t.x, z: t.z }; u.path = null; u.pathGoal = null;
      }
      continue;
    }
    if (u.order.point) u.homePoint = u.order.point;
    // squads sit on their point until it's theirs, then push on to your post
    if (u.order.type === 'idle' && u.homePoint) {
      const p = u.homePoint;
      if (p.owner === ENEMY) {
        u.homePoint = null;
        u.order = { type: 'amove', x: (Math.random() - 0.5) * 6, z: 22 }; u.path = null; u.pathGoal = null;
      } else if (Math.hypot(u.x - p.x, u.z - p.z) > POINT_R - 0.5) {
        u.order = { type: 'amove', x: p.x + (Math.random() - 0.5) * 2, z: p.z + (Math.random() - 0.5) * 2, point: p }; u.path = null; u.pathGoal = null;
      }
    }
  }
  if (eliteRetarget <= 0) eliteRetarget = 1.5;
}

function explode(x, z, r, dmg, src) {
  burst(x, 0.8, z, r * 0.9, 0xffaa55);
  burst(x, 0.4, z, r * 0.5, 0xffffff);
  sfx('boom', x, z);
  for (const e of entities) {
    if (e.dead || (src && e.team === src.team)) continue;
    const d = Math.hypot(e.x - x, e.z - z) - (e.isBase ? e.radius : 0);
    if (d < r) damage(e, dmg * (1 - Math.max(0, d) / r * 0.5), src);
  }
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t += dt;
    g.vel.y -= 20 * dt;
    g.pos.addScaledVector(g.vel, dt);
    g.mesh.position.copy(g.pos);
    const inBox = (!g.noBox || g.vel.y < 0) && boxes.some(b => g.pos.y < 2 && g.pos.x > b.minX && g.pos.x < b.maxX && g.pos.z > b.minZ && g.pos.z < b.maxZ);
    if (g.pos.y <= 0.15 || inBox || g.t > 2) {
      scene.remove(g.mesh);
      explode(g.pos.x, g.pos.z, 3.4, 60, g.src);
      grenades.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- FPS control
const viewmodel = new THREE.Group();
{
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.45, emissive: 0x0f2a10 });
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 10), gunMat);
  gun.rotation.x = Math.PI / 2;
  gun.position.z = -0.27;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.08), visorMat);
  sight.position.set(0, 0.07, -0.18);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.1), visorMat); // corn hopper
  grip.position.set(0, 0.07, -0.05); viewmodel.add(grip);
  const wing = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xffd84a, roughness: 0.7 })); // your feathery wing
  wing.scale.set(0.05, 0.045, 0.14); wing.position.set(0.03, -0.07, 0.0); wing.rotation.x = 0.3;
  viewmodel.userData.wing = wing;
  viewmodel.add(gun, sight, wing);
  const muzzle = new THREE.Object3D(); muzzle.position.z = -0.58; viewmodel.add(muzzle);
  viewmodel.userData.muzzle = muzzle;
  const flash = new THREE.Group();
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let k = 0; k < 3; k++) { // a star of crossed quads
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), flashMat); q.rotation.z = k * Math.PI / 3; flash.add(q);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  flash.add(core);
  flash.position.z = -0.62; flash.visible = false; viewmodel.add(flash);
  viewmodel.userData.flash = flash;
  viewmodel.position.set(0.22, -0.22, -0.35);
  viewmodel.scale.setScalar(0.8);
  viewmodel.visible = false;
  viewmodel.traverse(noRay);
  camera.add(viewmodel);
}


const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();

function possess(u) {
  if (!u || u.dead || u.isBase || u.team !== PLAYER) return;
  if (tac.on) {
    if (tac.phase === 'plan') { tac.hero = u; selection = [u]; updateButtons(); toast(`★ ${nameOf(u)} is your hero this round`, 1.2); return; }
    if (u !== tac.hero) { toast('Only your ★ hero can be played this round', 1.2); return; }
  }
  if (game.relink > 0) { toast(`Drop in again in ${Math.ceil(game.relink)}s`, 1.2); return; }
  const swap = mode === 'fps';
  if (possessed && possessed !== u) { possessed.possessed = false; possessed.mesh.visible = true; possessed.order = { type: 'idle' }; }
  possessed = u;
  u.possessed = true; u.order = { type: 'idle' }; u.path = null;
  u.mesh.visible = false;
  fps.yaw = u.facing; fps.pitch = -0.05; fps.firing = false; setScoped(false);
  fps.vx = fps.vz = fps.recoil = fps.bloom = 0; fps.lastYaw = fps.yaw; fps.lastPitch = fps.pitch;
  viewmodel.userData.wing.material.color.copy(u.bodyMat.color);
  if (!selection.includes(u)) selection.push(u);
  game.slowmo = swap ? 0.6 : 1.3;
  setMode('fps', swap ? 3 : 9);
  sfx('whoosh');
  if (!isTouch && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  toast(`You are a ${nameOf(u)} · ${TYPES[u.type].ability} (Q)`, 1.2);
  sfx('quack');
}

function dropInNear(x, z) {
  const mine = playerUnits();
  if (!mine.length) { toast('No birds left', 1); return; }
  mine.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  possess(mine[0]);
}

function exitFPS() {
  if (possessed) {
    possessed.possessed = false; possessed.mesh.visible = true; possessed.order = { type: 'idle' };
    rts.focus.set(possessed.x, 0, possessed.z);
    possessed = null;
  }
  fps.firing = false; setScoped(false);
  if (document.pointerLockElement) document.exitPointerLock();
  if (mode !== 'over') setMode('rts');
}

function swapUnit() {
  if (tac.on) { toast('One hero per round', 1); return; }
  const mine = playerUnits();
  if (mine.length < 2) { toast('No other birds', 1); return; }
  const i = mine.indexOf(possessed);
  possess(mine[(i + 1) % mine.length]);
}

function rally() {
  if (tac.on && tac.rallyUsed) { toast('Radio call already used this round', 1); return; }
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 80;
  const hit = raycaster.intersectObjects(staticShootables, false)[0];
  if (!hit) { toast('Aim at the ground to rally', 1); return; }
  let squad = liveSelection();
  if (!squad.length) squad = playerUnits().filter(e => !e.possessed && Math.hypot(e.x - possessed.x, e.z - possessed.z) < 14);
  if (!squad.length) { toast('No squad nearby', 1); return; }
  commandMove(squad, hit.point.x, hit.point.z, 'amove');
  if (tac.on) tac.rallyUsed = true;
  radio(`${squad.length} birds waddling to where you aimed`, 'good');
}

function setScoped(on) {
  fps.scoped = on;
  document.body.classList.toggle('scoped', on);
  viewmodel.visible = mode === 'fps' && !on;
}

function useAbility() {
  const u = possessed;
  if (!u) return;
  if (u.type === 'sniper') { setScoped(!fps.scoped); return; }
  if (u.abilityCd > 0) { toast(`${TYPES[u.type].ability} ready in ${Math.ceil(u.abilityCd)}s`, 0.8); return; }
  u.abilityCd = TYPES[u.type].abilityCd;
  if (u.type === 'trooper') {
    camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone().addScaledVector(dir, 0.6);
    const mesh = noRay(new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xfff6e0 }))); mesh.scale.set(0.12, 0.16, 0.12);
    scene.add(mesh);
    grenades.push({ pos, vel: dir.multiplyScalar(15).add(new THREE.Vector3(0, 4, 0)), t: 0, mesh, src: u });
  } else if (u.type === 'heavy') {
    u.armorT = 5; sfx('honk'); toast('HONK! Half damage for 5s', 1);
  }
}

function playerShoot(u) {
  const gun = GUNS[u.type];
  u.cool += gun.rate; if (u.cool < 0) u.cool = 0; // keeps the fire rate exact at any frame rate
  camera.updateMatrixWorld(true);
  const targets = staticShootables.concat(entities.filter(e => !e.dead && !e.possessed).map(e => e.mesh));
  const mz = fps.scoped ? camera.position.clone().add(new THREE.Vector3(0, -0.15, 0)) : viewmodel.userData.muzzle.getWorldPosition(new THREE.Vector3());
  const spreadBase = fps.scoped ? 0.0008 : gun.spread * (1 + fps.bloom * 1.5);
  let hits = 0, killed = false;
  for (let i = 0; i < gun.pellets; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spreadBase;
    raycaster.setFromCamera({ x: Math.cos(a) * r, y: Math.sin(a) * r }, camera);
    raycaster.far = 120;
    const hit = raycaster.intersectObjects(targets, true)[0];
    const end = hit ? hit.point.clone() : raycaster.ray.at(120, new THREE.Vector3());
    const ent = hit && hit.object.userData.entity;
    const enemy = ent && ent.team !== u.team ? ent : null;
    if (enemy) {
      let dmg = gun.dmg;
      const crit = u.type === 'sniper' && !enemy.isBase && hit.point.y > 1.25 * (enemy.elite ? 1.3 : 1);
      if (crit) { dmg *= 2.5; toast('Beak shot!', 0.6); }
      const wasShielded = enemy.isBase && enemy.shield;
      damage(enemy, dmg, u);
      if (!wasShielded) dmgNumber(end, dmg, crit);
      if (enemy.dead) killed = true;
      hits++;
      if (!enemy.isBase && !enemy.dead) { // knockback
        const k = Math.min(0.35, dmg * 0.012);
        enemy.x += raycaster.ray.direction.x * k; enemy.z += raycaster.ray.direction.z * k;
      }
    }
    // the bullet you see; impact effects when it lands
    const surf = !hit ? null : enemy ? (enemy.isBase ? 0xffe6a0 : 'feather') : hit.object === ground ? 0x6b8f3a : 0xe8c35a;
    const team = enemy && !enemy.isBase ? enemy.team : null;
    shootBullet(mz, end, 'corn', gun.speed, surf === null ? null : () => {
      if (surf === 'feather') { feathers(end.x, end.z, team === ENEMY ? 0xffffff : 0xffd84a, 2); burst(end.x, end.y, end.z, 0.25, 0xfff4c0); }
      else impactPuff(end, surf, gun.pellets > 1 ? 2 : 4);
    }, gun.pellets > 1 ? 0.8 : 1.2);
  }
  if (hits) { fps.hitMarker = 0.12; sfx('hit'); }
  if (killed) fps.killMarker = 0.45;
  // feel: flash, light, kick, shake, bloom, a popcorn shell
  const fl = viewmodel.userData.flash;
  fl.visible = true; fl.scale.setScalar((gun.pellets > 1 ? 1.8 : 1) * (0.8 + Math.random() * 0.7)); fl.rotation.z = Math.random() * 6;
  fps.flash = 0.05;
  fps.recoil += gun.kick * (0.7 + Math.random() * 0.6);
  fps.yaw += (Math.random() - 0.5) * gun.kick * 0.5;
  fps.vmKick = Math.min(1.5, fps.vmKick + (gun.pellets > 1 ? 1.4 : u.type === 'sniper' ? 1.2 : 0.55));
  fps.shake = Math.min(0.3, fps.shake + gun.shake);
  fps.bloom = Math.min(1, fps.bloom + (u.type === 'trooper' ? 0.12 : 0.5));
  if (!fps.scoped) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    spawnDebris(mz.clone().addScaledVector(right, -0.05), right.multiplyScalar(2 + Math.random() * 1.5).add(new THREE.Vector3(0, 2.5 + Math.random(), 0)), 0xfffbe8, 0.035, 1.0);
  }
  sfx(gun.sound);
}

function updateFPS(dt, simDt) {
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
  const sp = u.speed * 1.15 * (fps.scoped ? 0.45 : 1);
  // accelerate / brake smoothly instead of snapping to full speed
  const k = Math.min(1, simDt * 12);
  fps.vx += ((fx * f + rx * s) * sp - fps.vx) * k;
  fps.vz += ((fz * f + rz * s) * sp - fps.vz) * k;
  u.x += fps.vx * simDt;
  u.z += fps.vz * simDt;
  u.facing = yaw;
  const v = Math.hypot(fps.vx, fps.vz);
  if (v > 0.3) fps.bob += simDt * 9 * Math.min(1, v / sp);
  if (isTouch && fps.firing) aimAssist(dt);
  if (fps.firing) { let n = 0; while (u.cool <= 0 && n++ < 3) playerShoot(u); } // catch up on slow frames
  else if (u.cool < 0) u.cool = 0;
}

// touch only: gently pull the aim toward the enemy closest to the crosshair
function aimAssist(dt) {
  let best = null, bd = 0.09;
  for (const e of entities) {
    if (e.dead || e.team === PLAYER || e.isBase) continue;
    const dx = e.x - camera.position.x, dz = e.z - camera.position.z, d = Math.hypot(dx, dz);
    if (d > 30 || d < 0.5) continue;
    let dy = Math.atan2(-dx, -dz) - fps.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = Math.atan2(1.0 - EYE, d) - fps.pitch;
    const a = Math.hypot(dy, dp);
    if (a < bd && hasLOS(possessed, e)) { bd = a; best = { dy, dp }; }
  }
  if (best) { const k = Math.min(1, dt * 4); fps.yaw += best.dy * k; fps.pitch += best.dp * k * 0.5; }
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
  const sh = fps.shake;
  euler.set(fps.pitch + fps.recoil + (Math.random() - 0.5) * sh * 0.08, fps.yaw + (Math.random() - 0.5) * sh * 0.08, (Math.random() - 0.5) * sh * 0.04);
  return { pos: new THREE.Vector3(u.x + (Math.random() - 0.5) * sh * 0.05, EYE + bob, u.z), quat: new THREE.Quaternion().setFromEuler(euler), fov: fps.scoped ? 22 : 72 };
}

function setMode(m, arc = 0) {
  const prev = mode;
  mode = m;
  document.body.classList.toggle('fps', m === 'fps');
  viewmodel.visible = m === 'fps' && !fps.scoped;
  amoveArmed = false;
  const tag = $('modeTag');
  tag.innerHTML = m === 'fps' ? '<b>DUCK MODE</b> stand on nests · fight' : '<b>COMMANDER</b> move the flock · buy birds';
  tag.className = m === 'fps' ? 'op' : '';
  updateButtons();
  if ((prev === 'rts' || prev === 'fps') && (m === 'rts' || m === 'fps')) {
    trans = { t: 0, dur: m === 'fps' ? (arc > 5 ? 1.0 : 0.6) : 0.55, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), fromFov: camera.fov, arc };
  }
}

function updateCamera(dt) {
  if (mode !== 'fps') {
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
    camera.position.y += Math.sin(Math.PI * e) * trans.arc; // swoop up, then dive in
    camera.quaternion.slerpQuaternions(trans.fromQuat, pose.quat, e);
    camera.fov = trans.fromFov + (pose.fov - trans.fromFov) * e;
    if (k >= 1) trans = null;
  } else {
    camera.position.copy(pose.pos);
    camera.quaternion.copy(pose.quat);
    camera.fov += (pose.fov - camera.fov) * Math.min(1, dt * 14);
  }
  camera.updateProjectionMatrix();
  // recoil springs back, the gun kicks, sways against your look and bobs as you walk
  fps.recoil *= Math.exp(-dt * 9);
  fps.vmKick *= Math.exp(-dt * 14);
  fps.shake *= Math.exp(-dt * 10);
  fps.bloom = Math.max(0, fps.bloom - dt * (fps.firing ? 1.2 : 3));
  let dyaw = fps.yaw - fps.lastYaw; while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const dpitch = fps.pitch - fps.lastPitch;
  fps.lastYaw = fps.yaw; fps.lastPitch = fps.pitch;
  const ks = Math.min(1, dt * 10);
  fps.swayX += (Math.max(-0.05, Math.min(0.05, dyaw * 0.6)) - fps.swayX) * ks;
  fps.swayY += (Math.max(-0.05, Math.min(0.05, -dpitch * 0.6)) - fps.swayY) * ks;
  const walk = Math.min(1, Math.hypot(fps.vx, fps.vz) / 4);
  const portrait = camera.aspect < 1;
  viewmodel.scale.setScalar(portrait ? 0.5 : 0.62);
  viewmodel.position.set(
    (portrait ? 0.09 : 0.17) + fps.swayX + Math.cos(fps.bob * 0.5) * 0.012 * walk,
    (portrait ? -0.15 : -0.17) + fps.swayY - Math.abs(Math.sin(fps.bob * 0.5)) * 0.014 * walk - fps.vmKick * 0.012,
    -0.35 + fps.vmKick * 0.07);
  viewmodel.rotation.set(fps.vmKick * 0.18, fps.swayX * 1.5, -fps.swayX * 2);
  fps.flash -= dt;
  if (fps.flash <= 0) viewmodel.userData.flash.visible = false;
  const ch = $('crosshair');
  ch.style.transform = fps.scoped ? '' : `scale(${1 + fps.bloom * 0.9})`;
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
let lastTouchAt = -1e9;
window.addEventListener('pointerdown', e => { markTouch(e.pointerType === 'touch'); if (e.pointerType !== 'mouse') lastTouchAt = performance.now(); }, true);
window.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') lastTouchAt = performance.now(); }, true);

canvas.addEventListener('contextmenu', e => e.preventDefault());

const lookSens = () => (fps.scoped ? 0.35 : 1);
canvas.addEventListener('pointerdown', e => {
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
    if (e.pointerType === 'touch') p.look = true;
    else if (!document.pointerLockElement) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
    } else if (e.button === 0) fps.firing = true;
    else if (e.button === 2 && possessed && possessed.type === 'sniper') setScoped(!fps.scoped);
  }
});

canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (mode === 'fps' && !isTouch && document.pointerLockElement === canvas) {
    fps.yaw -= e.movementX * 0.0024 * lookSens();
    fps.pitch = Math.max(-1.4, Math.min(1.4, fps.pitch - e.movementY * 0.0024 * lookSens()));
  }
  if (!p) return;
  const px = p.x, py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (mode === 'fps' && p.look) {
    fps.yaw -= (p.x - px) * 0.006 * lookSens();
    fps.pitch = Math.max(-1.3, Math.min(1.3, fps.pitch - (p.y - py) * 0.006 * lookSens()));
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
  if (mode === 'fps') { if (e.pointerType === 'mouse' && e.button === 0) fps.firing = false; return; } // a lifted look finger must not stop the FIRE button
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
  const picked = playerUnits().filter(e => {
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
  if (tac.on) { tacticsTap(ent, gp, sel, { secondary, shift, touch }); return; }
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
  if (mode === 'rts' && tac.on) {
    if (e.code === 'KeyQ') selectAll();
    else if (e.code === 'Escape') { setTool('move'); selection = []; updateButtons(); }
    else if (tac.phase === 'plan') {
      if (e.code === 'KeyH') holdSelected();
      else if (e.code === 'KeyB') setTool(tac.tool === 'bomb' ? 'move' : 'bomb');
      else if (e.code === 'KeyF') heroFromSelection();
      else if (e.code === 'Enter' || e.code === 'Space') goLive();
    } else if (e.code === 'KeyF') possessFromSelection();
  } else if (mode === 'rts') {
    if (e.code === 'KeyF') possessFromSelection();
    else if (e.code === 'KeyQ') selectAll();
    else if (e.code === 'KeyX') toggleAMove();
    else if (e.code === 'Digit1') buy('trooper');
    else if (e.code === 'Digit2') buy('heavy');
    else if (e.code === 'Digit3') buy('sniper');
    else if (e.code === 'Escape') { amoveArmed = false; selection = []; updateButtons(); }
  } else if (mode === 'fps') {
    if (e.code === 'KeyF' || e.code === 'Tab') exitFPS();
    else if (e.code === 'KeyR') rally();
    else if (e.code === 'KeyE') swapUnit();
    else if (e.code === 'KeyQ') useAbility();
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
const stick = $('stick'), knob = $('knob');
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
stick.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (stickId !== null) return; stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch { /* ignore */ } stickUpdate(e); });
stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickUpdate(e); });
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; fps.stickX = fps.stickY = 0; knob.style.transform = ''; };
stick.addEventListener('pointerup', stickEnd);
stick.addEventListener('pointercancel', stickEnd);

// FIRE button: its own finger, and it doubles as an aim pad (deltas computed by hand:
// mobile Safari reports no movementX for touch)
const btnFire = $('btnFire');
let fireId = null, fireX = 0, fireY = 0;
btnFire.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  fireId = e.pointerId; fireX = e.clientX; fireY = e.clientY;
  try { btnFire.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  fps.firing = true;
});
btnFire.addEventListener('pointermove', e => {
  if (e.pointerId !== fireId) return;
  const dx = e.clientX - fireX, dy = e.clientY - fireY;
  fireX = e.clientX; fireY = e.clientY;
  fps.yaw -= dx * 0.005 * lookSens();
  fps.pitch = Math.max(-1.3, Math.min(1.3, fps.pitch - dy * 0.005 * lookSens()));
});
const fireEnd = e => { if (e.pointerId !== fireId) return; fireId = null; fps.firing = false; };
btnFire.addEventListener('pointerup', fireEnd);
btnFire.addEventListener('pointercancel', fireEnd);

// Touch browsers turn a second finger into pinch-zoom or swallow it as a double-tap,
// which cancels the first finger. Block native gestures everywhere except the menus,
// and fire buttons on pointerdown (click is suppressed once touchstart is cancelled).
const nativeOk = t => t.closest && t.closest('.screen');
for (const ev of ['touchstart', 'touchmove']) {
  document.addEventListener(ev, e => { if (!nativeOk(e.target)) e.preventDefault(); }, { passive: false });
}
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

function tapButton(el, fn) {
  // touch: act on pointerdown so it works while other fingers are busy; mouse/keyboard: click
  // (the ghost click that follows a touch can land on a different button once the UI changes, so ignore all clicks shortly after any touch)
  el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { e.preventDefault(); e.stopPropagation(); fn(); } });
  el.addEventListener('click', e => { e.preventDefault(); if (performance.now() - lastTouchAt > 800) fn(); });
}
tapButton($('btnAll'), selectAll);
tapButton($('btnAMove'), toggleAMove);
tapButton($('btnPossess'), possessFromSelection);
tapButton($('btnExit'), exitFPS);
tapButton($('btnSwap'), swapUnit);
tapButton($('btnRally'), rally);
tapButton($('btnAbility'), useAbility);
tapButton($('btnBuyTrooper'), () => buy('trooper'));
tapButton($('btnBuyHeavy'), () => buy('heavy'));
tapButton($('btnBuySniper'), () => buy('sniper'));
tapButton($('btnStart'), startGame);
tapButton($('btnStartTac'), startTactics);
tapButton($('btnHold'), holdSelected);
tapButton($('btnBomb'), () => setTool(tac.tool === 'bomb' ? 'move' : 'bomb'));
tapButton($('btnHero'), heroFromSelection);
tapButton($('btnGo'), goLive);
tapButton($('btnRestart'), () => location.reload());

function selectAll() {
  const mine = playerUnits();
  selection = (liveSelection().length === mine.length) ? [] : mine;
  updateButtons();
}
function toggleAMove() {
  if (!liveSelection().length) { toast('Select units first', 1); return; }
  amoveArmed = !amoveArmed; updateButtons();
  if (amoveArmed) toast(isTouch ? 'Tap a destination' : 'Click a destination', 1);
}
function possessFromSelection() {
  if (tac.on) { if (tac.phase === 'live' && tac.hero && !tac.hero.dead) possess(tac.hero); else heroFromSelection(); return; }
  const sel = liveSelection();
  if (sel.length) { possess(sel[0]); return; }
  dropInNear(rts.focus.x, rts.focus.z);
}
function updateButtons() {
  selection = selection.filter(u => !u.dead);
  const sel = liveSelection();
  const counts = {};
  for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
  $('selInfo').textContent = sel.length ? `${sel.length} selected · ${Object.entries(counts).map(([t, n]) => `${n} ${NAMES[PLAYER][t].toLowerCase()}`).join(', ')}` : 'No birds selected';
  $('btnAMove').classList.toggle('armed', amoveArmed);
}

let toastTimer = 0;
function toast(msg, secs = 2) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastTimer = secs;
}

function startGame(tactics = false) {
  if (tactics !== true) tactics = false; // also called from a click handler
  initAudio();
  if (audio && audio.resume) audio.resume();
  $('menu').classList.add('hidden');
  setMode('rts');
  rts.focus.set(0, 0, 10);
  rts.zoom = camera.aspect < 1 ? 42 : 30; // portrait phones need a wider view
  selection = playerUnits();
  updateButtons();
  if (tactics) { toast(isTouch ? 'Tap birds, tap the ground to plan, then Go' : 'Select birds, right-click to plan, then Go (Space)', 3.5); return; }
  toast(isTouch ? 'Double-tap a duck to become it' : 'Double-click a duck (or press F) to become it', 3);
  setTimeout(() => radio('Only YOU can claim a nest: drop into a duck and sit on nest B', 'good', { dropAt: points[1] }), 1200);
}

function endGame(won, text) {
  if (mode === 'over') return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (possessed) { possessed.possessed = false; possessed.mesh.visible = true; possessed = null; }
  setMode('over');
  document.body.classList.remove('fps', 'scoped');
  $('overTitle').textContent = won ? 'Egg-cellent victory!' : 'Fried.';
  $('overText').textContent = text || (won ? `The hen coop is flattened after ${waveNum} waves. All the eggs are yours.` : `The hens took your barn during wave ${waveNum}.`);
  setTimeout(() => $('over').classList.remove('hidden'), 900);
}

// ---------------------------------------------------------------- tactics mode
function startTactics() {
  tac.on = true;
  document.body.classList.add('tactics');
  // a smaller, fair fight: 6 birds vs 8 hens, no waves, no corn
  for (const e of entities) if (!e.isBase && e.team === ENEMY) { e.dead = true; scene.remove(e.mesh); }
  entities = entities.filter(e => !e.dead);
  const hens = [['trooper', -14, -17], ['trooper', 14, -17], ['trooper', -4, -15], ['trooper', 4, -15], ['heavy', -9, -19], ['heavy', 9, -19], ['sniper', -2, -20], ['sniper', 2, -20]];
  for (const [t, x, z] of hens) makeUnit(ENEMY, t, x, z);
  enemyBase.shieldMesh.visible = false;
  startGame(true);
  startPlan();
}

function startPlan() {
  if (mode === 'over') return;
  if (possessed) exitFPS();
  tac.phase = 'plan'; tac.round++;
  document.body.classList.add('plan'); document.body.classList.remove('live');
  if (!tac.hero || tac.hero.dead) tac.hero = playerUnits()[0] || null;
  setTool('move');
  enemyPlan();
  const mine = playerUnits();
  if (mine.length) { // frame the flock, looking toward the hens
    rts.focus.set(mine.reduce((t, u) => t + u.x, 0) / mine.length * 0.5, 0, Math.max(-10, mine.reduce((t, u) => t + u.z, 0) / mine.length - 8));
  }
  if (camera.aspect < 1) rts.zoom = Math.max(rts.zoom, 46);
  selection = mine; updateButtons();
  radio(`Round ${tac.round}: give orders, pick your ★ hero, then press Go`, 'good');
}

function goLive() {
  if (!tac.on || tac.phase !== 'plan' || mode !== 'rts') return;
  tac.phase = 'live'; tac.t = ROUND_TIME; tac.rallyUsed = false;
  document.body.classList.remove('plan'); document.body.classList.add('live');
  setTool('move');
  selection = []; updateButtons();
  if (tac.hero && !tac.hero.dead) possess(tac.hero);
}

function updateRound(dt) {
  if (tac.phase !== 'live') return;
  tac.t -= dt;
  if (tac.t > 0) return;
  // round over: hold all 3 nests to win, lose all 3 to lose
  const mine = points.filter(p => p.owner === PLAYER).length, theirs = points.filter(p => p.owner === ENEMY).length;
  if (mine === points.length) { endGame(true, `You held all 3 nests at the end of round ${tac.round}.`); return; }
  if (theirs === points.length) { endGame(false, `The hens held all 3 nests at the end of round ${tac.round}.`); return; }
  startPlan();
}

// the hens plan at the same time as you: grab nests, hunt ducks, fall back when hurt
function enemyPlan() {
  const hens = entities.filter(e => !e.dead && !e.isBase && e.team === ENEMY);
  const ducks = playerUnits();
  const open = points.filter(p => p.owner !== ENEMY);
  hens.forEach((h, i) => {
    if (h.hp < h.maxHp * 0.35) { commandMove([h], h.x * 0.6, Math.max(-24, h.z - 8), 'amove', true); return; }
    const near = (list) => list.slice().sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
    const roll = (i + tac.round) % 3;
    if (open.length && (roll !== 2 || !ducks.length)) {
      const p = roll === 1 && open.length > 1 ? open[(i + tac.round) % open.length] : near(open);
      commandMove([h], p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, 'amove', true);
    } else if (ducks.length && (roll === 2 || Math.random() < 0.5)) {
      const d = near(ducks);
      commandMove([h], d.x + (Math.random() - 0.5) * 4, d.z + (Math.random() - 0.5) * 4, 'amove', true);
    } else {
      h.order = { type: 'idle' }; h.path = null; // sit tight on what they have
    }
  });
}

function setTool(t) {
  tac.tool = t;
  const b = $('btnBomb'); if (b) b.classList.toggle('armed', t === 'bomb');
  if (t === 'bomb') toast(isTouch ? 'Tap where the egg bomb lands' : 'Click where the egg bomb lands', 1.2);
}
function holdSelected() {
  if (tac.phase !== 'plan') return;
  const sel = liveSelection();
  if (!sel.length) { toast('Select birds first', 1); return; }
  for (const u of sel) { u.order = { type: 'idle' }; u.path = null; u.pathGoal = null; }
  toast(`${sel.length} holding position`, 0.8);
}
function heroFromSelection() {
  if (tac.phase !== 'plan') return;
  const sel = liveSelection();
  if (!sel.length) { toast('Select a bird to be your ★ hero', 1); return; }
  possess(sel[0]); // in plan phase this marks the hero
}

function tacticsTap(ent, gp, sel, { secondary, shift, touch }) {
  const planning = tac.phase === 'plan';
  const order = planning && (secondary || (touch && sel.length && !(ent && ent.team === PLAYER)) || tac.tool === 'bomb');
  if (order && sel.length) {
    if (tac.tool === 'bomb') {
      const ducks = sel.filter(u => u.type === 'trooper');
      if (!ducks.length) toast('Only ducks carry egg bombs', 1.2);
      else if (gp) { for (const u of ducks) { u.order = { type: 'bomb', x: gp.x, z: gp.z }; u.path = null; } ping(gp.x, gp.z, 0xffaa55, 2.2); }
      setTool('move');
      return;
    }
    if (ent && ent.team === ENEMY) commandAttack(sel, ent);
    else if (gp) commandMove(sel, gp.x, gp.z, 'amove');
    return;
  }
  if (!planning && (secondary || (touch && sel.length && !(ent && ent.team === PLAYER)))) { toast('Orders are locked until the round ends', 1); return; }
  if (ent && ent.team === PLAYER && !ent.isBase) {
    const now = performance.now();
    if (lastTap.ent === ent && now - lastTap.t < 380) { lastTap.ent = null; possess(ent); return; }
    lastTap = { ent, t: now };
    if (shift) selection = selection.includes(ent) ? selection.filter(u => u !== ent) : [...selection, ent];
    else selection = [ent];
    updateButtons();
    return;
  }
  if (!shift) { selection = []; updateButtons(); }
}

function throwEgg(u, x, z) {
  const T = 0.9, y0 = 1.2;
  const pos = new THREE.Vector3(u.x, y0, u.z);
  const vel = new THREE.Vector3((x - u.x) / T, (0.15 - y0 + 0.5 * 20 * T * T) / T, (z - u.z) / T);
  const mesh = noRay(new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xfff6e0 }))); mesh.scale.set(0.14, 0.18, 0.14);
  scene.add(mesh);
  grenades.push({ pos, vel, t: 0, mesh, src: u, noBox: true });
  u.facing = facingFor(x - u.x, z - u.z);
}

function updateTacticsHud() {
  const tag = $('modeTag');
  if (tac.phase === 'plan') { tag.innerHTML = `<b>PLAN</b> round ${tac.round} · paused`; tag.className = 'plan'; }
  else { tag.innerHTML = `<b>LIVE</b> ${Math.max(0, Math.ceil(tac.t))}s left${mode === 'fps' ? ' · you are the ★ hero' : ''}`; tag.className = 'op'; }
  $('btnPossess').textContent = tac.hero && !tac.hero.dead ? 'Hero view ▶' : 'Hero down';
  $('btnPossess').classList.toggle('off', !tac.hero || tac.hero.dead);
}

// planned paths, egg bomb targets and the hero star, drawn on top of the map
function drawPlans() {
  if (mode !== 'rts') return;
  const proj = (x, z) => toScreen(x, 0.1, z);
  octx.lineWidth = 2;
  for (const u of playerUnits()) {
    const o = u.order;
    const a = proj(u.x, u.z);
    if (o.type === 'bomb') {
      const b = proj(o.x, o.z);
      octx.setLineDash([4, 5]); octx.strokeStyle = '#ffaa55';
      octx.beginPath(); octx.moveTo(a.x, a.y); octx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 60, b.x, b.y); octx.stroke();
      octx.setLineDash([]);
      octx.beginPath();
      for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI * 2; const q = proj(o.x + Math.cos(t) * 3.4, o.z + Math.sin(t) * 3.4); k ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y); }
      octx.stroke();
    } else if ((o.type === 'amove' || o.type === 'move') && u.path && tac.phase === 'plan') {
      octx.setLineDash([6, 6]); octx.strokeStyle = selection.includes(u) ? '#9dffc4' : 'rgba(157,255,196,.6)';
      octx.beginPath(); octx.moveTo(a.x, a.y);
      for (const p of u.path) { const q = proj(p.x, p.z); octx.lineTo(q.x, q.y); }
      octx.stroke(); octx.setLineDash([]);
      const end = proj(u.path[u.path.length - 1].x, u.path[u.path.length - 1].z);
      octx.fillStyle = '#9dffc4'; octx.beginPath(); octx.arc(end.x, end.y, 4, 0, Math.PI * 2); octx.fill();
    } else if (o.type === 'attack' && !o.target.dead && tac.phase === 'plan') {
      const b = proj(o.target.x, o.target.z);
      octx.strokeStyle = '#ff6a5a'; octx.setLineDash([3, 4]);
      octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.setLineDash([]);
    } else if (o.type === 'idle' && tac.phase === 'plan') {
      octx.fillStyle = 'rgba(255,255,255,.85)'; octx.font = '700 10px system-ui'; octx.textAlign = 'center';
      octx.fillText('HOLD', a.x, a.y + 16);
    }
    if (u === tac.hero) {
      const s = toScreen(u.x, 2.7, u.z);
      octx.font = '900 20px system-ui'; octx.textAlign = 'center';
      octx.lineWidth = 4; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.strokeText('★', s.x, s.y);
      octx.fillStyle = '#ffd84a'; octx.fillText('★', s.x, s.y); octx.lineWidth = 2;
    }
  }
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

const hex = c => '#' + c.toString(16).padStart(6, '0');
function drawOverlay() {
  octx.clearRect(0, 0, innerWidth, innerHeight);
  if (mode === 'menu') return;
  // point labels
  octx.textAlign = 'center';
  for (const p of points) {
    const s = toScreen(p.x, 3.9, p.z);
    if (s.behind) continue;
    if (mode === 'fps' && Math.hypot(p.x - camera.position.x, p.z - camera.position.z) > 60) continue;
    octx.font = '800 16px system-ui';
    octx.lineWidth = 4; octx.strokeStyle = 'rgba(0,0,0,.7)';
    octx.strokeText(p.name, s.x, s.y);
    octx.fillStyle = hex(pointColor(p));
    octx.fillText(p.name, s.x, s.y);
    if (p.contested || p.capturing) {
      octx.font = '700 11px system-ui';
      const txt = p.contested ? 'CONTESTED' : 'CAPTURING';
      octx.strokeText(txt, s.x, s.y + 14); octx.fillStyle = '#fff'; octx.fillText(txt, s.x, s.y + 14);
    }
  }
  for (const e of entities) {
    if (e.dead || e.possessed) continue;
    const selected = selection.includes(e);
    if (!(selected || e.hp < e.maxHp || e.isBase || e.elite)) continue;
    const s = toScreen(e.x, e.isBase ? 5.8 : e.elite ? 2.8 : 2.0, e.z);
    if (s.behind || s.x < -50 || s.x > innerWidth + 50 || s.y < -20 || s.y > innerHeight + 20) continue;
    if (mode === 'fps' && Math.hypot(e.x - camera.position.x, e.z - camera.position.z) > 45) continue;
    const w = e.isBase ? 70 : e.elite ? 50 : 30, h = e.isBase ? 7 : 4;
    const k = Math.max(0, e.hp / e.maxHp);
    octx.fillStyle = 'rgba(0,0,0,.65)';
    octx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, h + 2);
    octx.fillStyle = e.elite ? '#ffc340' : e.team === PLAYER ? (k > 0.35 ? '#46e08a' : '#f0c040') : '#ff5a3c';
    octx.fillRect(s.x - w / 2, s.y, w * k, h);
    if (e.isBase && e.shield && !tac.on) {
      octx.strokeStyle = '#ffa080'; octx.lineWidth = 2; octx.strokeRect(s.x - w / 2 - 3, s.y - 3, w + 6, h + 6);
      octx.fillStyle = '#ffd0c0'; octx.font = '700 11px system-ui';
      octx.fillText(`EGGSHELL · hold ${points.length - playerPointCount()} more nest${points.length - playerPointCount() === 1 ? '' : 's'}`, s.x, s.y - 6);
    }
    if (e.armorT > 0) { octx.fillStyle = '#7fb8ff'; octx.fillRect(s.x - w / 2, s.y + h + 1, w, 2); }
  }
  if (tac.on) drawPlans();
  if (boxSel) {
    octx.strokeStyle = '#5dff9a'; octx.lineWidth = 1.5;
    octx.fillStyle = 'rgba(93,255,154,.12)';
    const x = Math.min(boxSel.x0, boxSel.x1), y = Math.min(boxSel.y0, boxSel.y1);
    const w = Math.abs(boxSel.x1 - boxSel.x0), h = Math.abs(boxSel.y1 - boxSel.y0);
    octx.fillRect(x, y, w, h); octx.strokeRect(x, y, w, h);
  }
  if (mode === 'fps' && (fps.hitMarker > 0 || fps.killMarker > 0)) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const kill = fps.killMarker > 0;
    const g = kill ? 1 + (0.45 - fps.killMarker) * 1.5 : 1;
    octx.strokeStyle = kill ? '#ff4a3a' : '#ffffff'; octx.lineWidth = kill ? 3 : 2;
    octx.beginPath();
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { octx.moveTo(cx + a * 7 * g, cy + b * 7 * g); octx.lineTo(cx + a * 15 * g, cy + b * 15 * g); }
    octx.stroke();
  }
  if (mode === 'fps') {
    octx.textAlign = 'center';
    for (const n of dmgNums) {
      const s = toScreen(n.x, n.y + (0.8 - n.life) * 1.2, n.z);
      if (s.behind) continue;
      octx.globalAlpha = Math.min(1, n.life * 3);
      octx.font = `900 ${n.crit ? 22 : 15}px system-ui`;
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.7)';
      octx.strokeText(n.text, s.x + n.dx * (0.8 - n.life), s.y);
      octx.fillStyle = n.crit ? '#ff5a3c' : '#fff07a';
      octx.fillText(n.text, s.x + n.dx * (0.8 - n.life), s.y);
    }
    octx.globalAlpha = 1;
  }
}

function drawMinimap() {
  const W = minimap.width, s = W / N;
  const X = x => (x + HALF) * s;
  mctx.fillStyle = '#0d131a'; mctx.fillRect(0, 0, W, W);
  mctx.fillStyle = '#4b5666';
  for (const b of boxes) if (!b.owner) mctx.fillRect(X(b.minX), X(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
  mctx.lineWidth = 2;
  for (const p of points) {
    mctx.strokeStyle = hex(pointColor(p));
    mctx.beginPath(); mctx.arc(X(p.x), X(p.z), POINT_R * s, 0, Math.PI * 2); mctx.stroke();
  }
  mctx.lineWidth = 1;
  for (const e of entities) {
    if (e.dead) continue;
    mctx.fillStyle = e.elite ? '#ffc340' : e.team === PLAYER ? (selection.includes(e) ? '#9dffc4' : '#3fa9ff') : '#ff5a3c';
    if (e.isBase) {
      mctx.fillRect(X(e.x) - 6, X(e.z) - 6, 12, 12);
      if (e.shield) { mctx.strokeStyle = '#ffa080'; mctx.beginPath(); mctx.arc(X(e.x), X(e.z), 10, 0, Math.PI * 2); mctx.stroke(); }
    } else { const r = e.possessed || e.elite ? 4 : 2.2; mctx.beginPath(); mctx.arc(X(e.x), X(e.z), r, 0, Math.PI * 2); mctx.fill(); }
  }
  mctx.strokeStyle = 'rgba(255,255,255,.7)';
  if (mode === 'fps' && possessed) {
    const x = X(possessed.x), z = X(possessed.z), a = fps.yaw;
    mctx.beginPath();
    mctx.moveTo(x, z); mctx.lineTo(x - Math.sin(a - 0.5) * 22, z - Math.cos(a - 0.5) * 22);
    mctx.moveTo(x, z); mctx.lineTo(x - Math.sin(a + 0.5) * 22, z - Math.cos(a + 0.5) * 22);
    mctx.stroke();
  } else {
    const vw = rts.zoom * camera.aspect * 0.75, vh = rts.zoom * 0.75;
    mctx.strokeRect(X(rts.focus.x - vw / 2), X(rts.focus.z - vh / 2), vw * s, vh * s);
  }
}

function updateHud(dt) {
  if (tac.on) { updateTacticsHud(); if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); } }
  const pb = Math.max(0, Math.round(playerBase.hp / playerBase.maxHp * 100));
  const eb = Math.max(0, Math.round(enemyBase.hp / enemyBase.maxHp * 100));
  const dots = points.map(p => `${p.name}${p.owner === PLAYER ? '🦆' : p.owner === ENEMY ? '🐔' : '🥚'}`).join(' ');
  if (tac.on) $('status').textContent = `Nests ${dots} · Ducks ${countUnits(PLAYER)} vs Hens ${countUnits(ENEMY)} · Round ${tac.round}`;
  else $('status').textContent = `Nests ${dots} · Barn ${pb}% · Coop ${eb}%${enemyBase.shield ? ' (shelled)' : ' (CRACKED!)'} · Hens in ${Math.ceil(waveTimer)}s`;
  const income = CP_BASE + CP_PER_POINT * playerPointCount();
  $('cpText').textContent = `🌽 ${Math.floor(game.cp)}  (+${income.toFixed(1)}/s)`;
  for (const [id, t] of [['btnBuyTrooper', 'trooper'], ['btnBuyHeavy', 'heavy'], ['btnBuySniper', 'sniper']]) $(id).classList.toggle('off', game.cp < COSTS[t]);
  $('btnPossess').textContent = game.relink > 0 ? `Drop in (${Math.ceil(game.relink)}s)` : 'Drop in ▶';
  $('btnPossess').classList.toggle('off', game.relink > 0);
  if (possessed) {
    const k = Math.max(0, possessed.hp / possessed.maxHp);
    $('fpsHpFill').style.width = `${k * 100}%`;
    $('fpsHpText').textContent = `${nameOf(possessed).toUpperCase()}  ${Math.ceil(possessed.hp)} / ${possessed.maxHp}  ·  hero`;
    const t = TYPES[possessed.type];
    const ab = $('btnAbility');
    ab.textContent = possessed.type === 'sniper' ? (fps.scoped ? 'Unscope (Q)' : 'Scope (Q)') : possessed.abilityCd > 0 ? `${t.ability} ${Math.ceil(possessed.abilityCd)}s` : `${t.ability} (Q)`;
    ab.classList.toggle('cd', possessed.abilityCd > 0 && possessed.type !== 'sniper');
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
  if ((mode === 'rts' || mode === 'fps') && !(tac.on && tac.phase === 'plan')) {
    // slow motion during the drop-in: 25% speed, easing back over the last half second
    if (game.slowmo > 0) game.slowmo -= dt;
    const scale = game.slowmo > 0.5 ? 0.25 : game.slowmo > 0 ? 1 - 1.5 * game.slowmo : 1;
    const simDt = dt * scale;
    game.time += simDt;
    if (!tac.on) game.cp = Math.min(CP_MAX, game.cp + (CP_BASE + CP_PER_POINT * playerPointCount()) * simDt);
    if (game.relink > 0) game.relink -= simDt;
    if (mode === 'fps') updateFPS(dt, simDt);
    for (const e of entities) if (!e.dead && !e.isBase) updateUnit(e, simDt);
    separate();
    updatePoints(simDt);
    if (tac.on) updateRound(simDt);
    else { updateEnemyOrders(simDt); updateBases(simDt); }
    updateGrenades(simDt);
    updateBullets(simDt);
    entities = entities.filter(e => !e.dead);
    selection = selection.filter(e => !e.dead);
  }
  for (const e of entities) {
    if (e.isBase) { e.bodyMat.emissive.setHex(e.flash > 0 ? 0x552211 : 0); e.flash -= dt; continue; }
    e.mesh.position.set(e.x, e.moving ? Math.abs(Math.sin(now / 90)) * 0.05 : 0, e.z);
    e.mesh.rotation.y = e.facing;
    e.mesh.visible = !e.possessed;
    e.ring.visible = selection.includes(e) && mode !== 'fps';
    if (!e.elite) {
      e.bodyMat.emissive.setHex(e.flash > 0 ? 0xffffff : e.armorT > 0 ? 0x2266ff : 0);
      e.bodyMat.emissiveIntensity = e.flash > 0 ? 0.6 : e.armorT > 0 ? 0.5 : 0;
    }
    e.flash -= dt;
  }
  for (const p of points) p.flag.rotation.y = Math.sin(now / 500 + p.x) * 0.3;
  fps.hitMarker -= dt;
  fps.killMarker -= dt;
  updateDebris(dt);
  for (let i = dmgNums.length - 1; i >= 0; i--) { dmgNums[i].life -= dt; if (dmgNums[i].life <= 0) dmgNums.splice(i, 1); }
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
window.__game = {
  get mode() { return mode; }, get entities() { return entities; }, get selection() { return selection; },
  get possessed() { return possessed; }, get enemyBase() { return enemyBase; }, points,
  game, fps, possess, exitFPS, startGame, commandMove, buy, useAbility, dropInNear, damage,
  setEliteTimer: t => { eliteTimer = t; }, setWaveTimer: t => { waveTimer = t; },
  tac, goLive, startTactics, toScreen,
};
