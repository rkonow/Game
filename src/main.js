// Fowl Play: ducks vs hens. RTS command view + first-person possession prototype.
//
// One loop: the three capture points can only be taken by a soldier you are
// controlling in first person. Points pay command points, which you spend in
// the command view on new soldiers. Hold all three and the enemy post's shield
// drops so your army can destroy it.
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';

// ---------------------------------------------------------------- config
const HALF = 30;            // map spans [-HALF, HALF] on X and Z
const N = HALF * 2;         // pathfinding grid cells per side (1 unit each)
const PLAYER = 0, ENEMY = 1;
const TEAM_COLORS = [0x3fa9ff, 0xb35cff];
const TYPES = {
  trooper: { hp: 60, speed: 4.2, range: 10, dmg: 7, rate: 0.45, radius: 0.45, acc: 0.7, ability: 'Frag grenade', abilityCd: 6 },
  heavy: { hp: 150, speed: 3.0, range: 8, dmg: 18, rate: 1.1, radius: 0.6, acc: 0.8, ability: 'Energy wall', abilityCd: 12 },
  sniper: { hp: 45, speed: 3.4, range: 16, dmg: 38, rate: 2.2, radius: 0.45, acc: 0.85, ability: 'Scope', abilityCd: 0 },
  turret: { hp: 220, speed: 0, range: 12, dmg: 8, rate: 0.35, radius: 0.8, acc: 0.75 },
  mortar: { hp: 180, speed: 0, range: 18, dmg: 45, rate: 3.2, radius: 0.8, acc: 1 },
  scarecrow: { hp: 300, speed: 0, range: 6, dmg: 0, rate: 1, radius: 0.6, acc: 0 },
  elite: { hp: 450, speed: 4.0, range: 11, dmg: 12, rate: 0.4, radius: 0.75, acc: 0.8, ability: '', abilityCd: 0 },
};
const COSTS = { trooper: 20, heavy: 35, sniper: 30, turret: 40, mortar: 55, scarecrow: 25 };
const TOWERS = ['turret', 'mortar', 'scarecrow'];
const POSSESS_DMG = 2.0;    // damage multiplier while you drive the unit
const POSSESS_RATE = 0.6;   // fire-rate multiplier (lower = faster)
const EYE = 1.45;
const PLAYER_CAP = 20, ENEMY_CAP = 22;
const RELINK_CD = 5;        // wait after your soldier dies
const CP_BASE = 1, CP_PER_POINT = 1.5, CP_MAX = 200, CP_START = 40;
const POINT_DEFS = [['A', -17, 0], ['B', 0, 0], ['C', 17, 0]];
const POINT_R = 3;
const REGEN_DELAY = 4, REGEN_RATE = 0.1; // ducks heal 10% of max hp per second once out of combat
const PLAYER_HP = 1.25;     // your birds are a bit tougher than the hens
const VISION = 17;          // idle and attack-moving birds react to enemies this close

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');
const $ = id => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

// physically based materials everywhere (the helper keeps its old name so the rest of the code stays put)
function toon(p = {}) {
  const { gradientMap, ...rest } = p; // eslint-disable-line no-unused-vars
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.15, ...rest });
  m.metalness = Math.min(m.metalness, 0.65); // fully metallic faces turn black wherever they don't mirror the bright sky
  return m;
}
function outline() { return null; } // the cartoon ink outlines are gone in the realistic look

const scene = new THREE.Scene();
const HAZE = 0xb98a6e;
scene.background = new THREE.Color(HAZE);
scene.fog = new THREE.Fog(HAZE, 55, 210);

// alien dusk sky: violet overhead, a dusty amber horizon and a low sun that throws long shadows
const SUN_DIR = new THREE.Vector3(-0.55, 0.38, -0.74).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 top = vec3(0.07, 0.08, 0.20), mid = vec3(0.42, 0.30, 0.42), hor = vec3(1.05, 0.62, 0.38), ground = vec3(0.30, 0.18, 0.12);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
      c = mix(c, top, smoothstep(0.22, 0.85, h));
      c = mix(c, ground, (1.0 - smoothstep(-0.15, 0.0, h)));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.75, 0.45) * (pow(s, 900.0) * 18.0 + pow(s, 40.0) * 0.6 + pow(s, 6.0) * 0.18);
      // faint stars high up
      vec3 q = floor(d * 380.0); float st = fract(sin(dot(q, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      c += vec3(0.9) * step(0.9985, st) * smoothstep(0.35, 0.9, h);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 16), skyMat);
  sky.renderOrder = -1; sky.raycast = () => {};
  scene.add(sky);
}

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
scene.add(camera);

// image-based light: bake the sky into an environment map so metal and armour pick up its colours
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.8;
  pm.dispose();
}
scene.add(new THREE.HemisphereLight(0x8f86b8, 0x5a3a28, 0.55));
const sun = new THREE.DirectionalLight(0xffc89a, 3.4);
sun.position.copy(SUN_DIR).multiplyScalar(60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6f8cff, 0.7); // cool bounce from the opposite side
rim.position.set(30, 20, 40);
scene.add(rim);

// ---------------------------------------------------------------- post-processing: bloom + colour grade + vignette
// "Fancy" graphics render through a composer. If the device can't keep up, it drops to plain rendering by itself.
const gfx = { fancy: true, auto: true, slowT: 0, warm: 0 };
try {
  const q = new URLSearchParams(location.search).get('fancy');
  if (q !== null) { gfx.fancy = q !== '0'; gfx.auto = false; }
  else if (localStorage.getItem('fowl.gfx') === 'fast') gfx.fancy = false;
} catch (e) { /* storage blocked: keep defaults */ }
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.45, 0.92);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 }, uVig: { value: 0.32 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAspect, uVig, uHurt; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.14);                       // a touch more saturated
      c *= mix(vec3(0.97, 0.99, 1.05), vec3(1.05, 1.0, 0.93), smoothstep(0.2, 0.8, l)); // cool shadows, warm highlights
      c = (c - 0.5) * 1.05 + 0.5;
      vec2 d = vUv - 0.5; d.x *= uAspect;
      float v = (1.0 - smoothstep(0.3, 0.95, length(d)));
      c *= mix(1.0 - uVig, 1.0, v);
      c = mix(c, vec3(0.9, 0.1, 0.05), (1.0 - v) * uHurt * 0.6);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(gradePass);
function setFancy(on, why, save = true) {
  gfx.fancy = on;
  if (save) try { localStorage.setItem('fowl.gfx', on ? 'fancy' : 'fast'); } catch (e) { /* ignore */ }
  const b = document.getElementById('btnGfx'); if (b) b.textContent = on ? '✨ Graphics: fancy' : '⚡ Graphics: fast';
  if (why) toast(why, 2.5);
}
function renderFrame(dt) {
  if (!gfx.fancy) { renderer.render(scene, camera); return; }
  composer.render(dt);
  // too slow for a few seconds in game? fall back to fast graphics
  if (gfx.auto && mode !== 'menu') {
    gfx.warm += dt;
    if (gfx.warm > 3) { gfx.slowT = dt > 0.042 ? gfx.slowT + dt : Math.max(0, gfx.slowT - dt * 2); }
    if (gfx.slowT > 4) { gfx.auto = false; setFancy(false, 'Switched to fast graphics for a smoother game', false); }
  }
}

// ---------------------------------------------------------------- procedural textures (colour + normal maps, all generated at load)
function canvasTex(w, h, draw, rx = 1, ry = 1, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// tileable value noise with a few octaves
function makeNoise(size, period, seed = 1) {
  const rnd = (i, j) => { const s = Math.sin((i * 127.1 + j * 311.7 + seed * 74.7)) * 43758.5453; return s - Math.floor(s); };
  const sm = t => t * t * (3 - 2 * t);
  return (x, y, oct = 5) => {
    let v = 0, amp = 0.5, f = period, norm = 0;
    for (let o = 0; o < oct; o++) {
      const fx = x / size * f, fy = y / size * f, i = Math.floor(fx), j = Math.floor(fy), u = sm(fx - i), w = sm(fy - j);
      const a = rnd(i % f, j % f), b = rnd((i + 1) % f, j % f), c = rnd(i % f, (j + 1) % f), d = rnd((i + 1) % f, (j + 1) % f);
      v += amp * ((a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w); norm += amp;
      amp *= 0.5; f *= 2;
    }
    return v / norm;
  };
}
// height field -> colour texture + normal map
function surfaceTextures(size, heightFn, colorFn, strength, rx, ry) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x, y);
  const col = canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) { const [r, gg, b] = colorFn(H[i], i % size, (i / size) | 0); img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, rx, ry);
  const nrm = canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size), at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, rx, ry, false);
  return { col, nrm };
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// rusty regolith: rolling dunes, pebbles and cracks
const groundTex = (() => {
  const n = makeNoise(512, 4, 3), n2 = makeNoise(512, 32, 9);
  return surfaceTextures(512, (x, y) => n(x, y) * 0.7 + n2(x, y, 3) * 0.3 + (n2(x * 3 % 512, y * 3 % 512, 2) > 0.78 ? 0.25 : 0),
    (h, x, y) => { const c = mixc([92, 54, 36], [176, 118, 78], Math.min(1, h * 1.3)); const k = 0.9 + n2(x, y, 2) * 0.2; return [c[0] * k, c[1] * k, c[2] * k]; },
    6, N / 10, N / 10);
})();
// worn metal plates with seams and rivets
const plateTex = (() => {
  const n = makeNoise(256, 8, 5);
  const seam = (x, y) => (x % 128 < 2 || y % 64 < 2) ? -0.6 : 0;
  const rivet = (x, y) => { const rx = x % 128, ry = y % 64; return ((rx - 8) ** 2 + (ry - 8) ** 2 < 6 || (rx - 120) ** 2 + (ry - 8) ** 2 < 6) ? 0.5 : 0; };
  return surfaceTextures(256, (x, y) => seam(x, y) + rivet(x, y) + n(x, y, 4) * 0.15,
    (h, x, y) => { const g = 150 + (n(x, y, 4) - 0.5) * 60; const rust = Math.max(0, n((x * 2) % 256, (y * 2) % 256, 3) - 0.62) * 3; return mixc([g, g * 1.02, g * 1.06], [130, 70, 40], Math.min(1, rust)).map(v => h < -0.3 ? v * 0.5 : v); },
    3, 1, 1);
})();
// rock: layered strata
const rockTex = (() => {
  const n = makeNoise(256, 6, 11);
  return surfaceTextures(256, (x, y) => n(x, y) * 0.8 + (Math.abs(n((x * 2) % 256, (y * 2) % 256, 3) - 0.5) < 0.02 ? -0.25 : 0),
    (h) => mixc([70, 46, 36], [150, 104, 78], Math.min(1, Math.max(0, h))), 5, 1, 1);
})();
const stripeTex = canvasTex(64, 64, (g, w, h) => { // hazard stripes
  g.fillStyle = '#d9a21c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + 64, h); g.lineTo(i * 32 + 64, h); g.fill(); }
}, 2, 1);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N), toon({ map: groundTex.col, normalMap: groundTex.nrm, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const outerTex = { col: groundTex.col.clone(), nrm: groundTex.nrm.clone() };
outerTex.col.repeat.set(40, 40); outerTex.nrm.repeat.set(40, 40);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon({ map: outerTex.col, normalMap: outerTex.nrm, roughness: 1, metalness: 0, color: 0xd8c0b0 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true;
scene.add(outer);
const noRay = o => { o.raycast = () => {}; return o; };

// compacted haul roads between the bases, and a coolant pool
for (const x of [-17, 0, 17]) {
  const lane = noRay(new THREE.Mesh(new THREE.PlaneGeometry(4.5, 44), toon({ color: 0x3a2a22, transparent: true, opacity: 0.45, roughness: 0.85, metalness: 0, depthWrite: false })));
  lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.01, 0);
  lane.receiveShadow = true;
  scene.add(lane);
  for (const s of [-1, 1]) { // tyre tracks
    const tr = noRay(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 44), toon({ color: 0x24180f, transparent: true, opacity: 0.35, depthWrite: false })));
    tr.rotation.x = -Math.PI / 2; tr.position.set(x + s * 1.1, 0.015, 0); scene.add(tr);
  }
}
const windUniform = { value: 0 };
{
  const pool = noRay(new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshStandardMaterial({ color: 0x0c4a52, roughness: 0.05, metalness: 0.3, emissive: 0x0a6a70, emissiveIntensity: 0.5 })));
  pool.rotation.x = -Math.PI / 2; pool.scale.set(1.5, 1, 1); pool.position.set(-21, 0.02, 26);
  scene.add(pool);
  const rimRock = noRay(new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 6, 40), toon({ map: rockTex.col, normalMap: rockTex.nrm, roughness: 0.95 })));
  rimRock.rotation.x = -Math.PI / 2; rimRock.scale.set(1.5, 1, 0.5); rimRock.position.set(-21, 0.05, 26); scene.add(rimRock);
  const crater = noRay(new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), toon({ color: 0x2a1a14, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false })));
  crater.rotation.x = -Math.PI / 2; crater.scale.set(1.6, 1, 1); crater.position.set(21, 0.015, -26);
  scene.add(crater);
}

// ---------------------------------------------------------------- the planet around the colony: rocks, ore crystals, mesas, rigs, a wreck
function sphere14() { return sphereGeoShared || (sphereGeoShared = new THREE.SphereGeometry(1, 14, 10)); }
var sphereGeoShared = null;
function rockGeo(seed, detail = 1) { // a lumpy boulder
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, n = makeNoise(64, 4, seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.6 + n(((x + 1) * 20 + (y + 1) * 7) | 0, ((z + 1) * 20 + (y + 1) * 13) | 0, 3) * 0.8;
    p.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  return g;
}
const rockMat = toon({ map: rockTex.col, normalMap: rockTex.nrm, roughness: 0.92, metalness: 0.05, flatShading: true });
const ambient = { embers: null, drills: [], beacons: [], dropship: null, smokeT: 0 };
const smokeSpots = [];
const LANDMARKS = [[-46, -42, 10], [46, -44, 9], [48, 40, 11], [-50, 44, 9], [0, -56, 14], [-60, 0, 8], [60, 4, 8]];
{
  const d = new THREE.Object3D();
  // boulders: scattered inside (small, as cover-looking decor) and outside (big)
  const rg = [rockGeo(1), rockGeo(2), rockGeo(3)];
  for (let k = 0; k < 3; k++) {
    const COUNT = 70, rocks = new THREE.InstancedMesh(rg[k], rockMat, COUNT);
    let n = 0;
    for (let i = 0; i < COUNT * 4 && n < COUNT; i++) {
      const x = (Math.random() - 0.5) * 150, z = (Math.random() - 0.5) * 150;
      const inside = Math.abs(x) < HALF + 1 && Math.abs(z) < HALF + 1;
      if (inside && (Math.random() < 0.8 || [-17, 0, 17].some(l => Math.abs(x - l) < 3) || Math.abs(z) > 22)) continue;
      if (LANDMARKS.some(([lx, lz, lr]) => Math.hypot(x - lx, z - lz) < lr)) continue;
      const s = inside ? 0.15 + Math.random() * 0.25 : 0.6 + Math.random() * 2.6 * (Math.hypot(x, z) / 70);
      d.position.set(x, s * 0.25, z); d.rotation.set(Math.random() * 0.4, Math.random() * 6, Math.random() * 0.4); d.scale.set(s * (0.8 + Math.random() * 0.6), s, s * (0.8 + Math.random() * 0.6));
      d.updateMatrix(); rocks.setMatrixAt(n++, d.matrix);
    }
    rocks.count = n; rocks.castShadow = rocks.receiveShadow = true; noRay(rocks); scene.add(rocks);
  }
  // glowing ore crystal clusters
  const crystalGeo = new THREE.OctahedronGeometry(1, 0); crystalGeo.scale(0.35, 1.4, 0.35); crystalGeo.translate(0, 1, 0);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x38e8ff, emissive: 0x1aa8ff, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
  const CR = 160, crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, CR);
  let cn = 0;
  for (let c = 0; c < 26 && cn < CR; c++) {
    let cx, cz;
    do { cx = (Math.random() - 0.5) * 120; cz = (Math.random() - 0.5) * 120; } while ((Math.abs(cx) < HALF + 2 && Math.abs(cz) < HALF + 2) || LANDMARKS.some(([lx, lz, lr]) => Math.hypot(cx - lx, cz - lz) < lr));
    const k = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < k && cn < CR; i++) {
      d.position.set(cx + (Math.random() - 0.5) * 1.6, 0, cz + (Math.random() - 0.5) * 1.6);
      d.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * 6, (Math.random() - 0.5) * 0.9);
      d.scale.setScalar(0.4 + Math.random() * 0.9); d.updateMatrix(); crystals.setMatrixAt(cn++, d.matrix);
    }
  }
  crystals.count = cn; noRay(crystals); scene.add(crystals);
  // mesas on the horizon
  const mesaMat = toon({ map: rockTex.col, normalMap: rockTex.nrm, roughness: 1, metalness: 0, color: 0xb08068, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2, r = 110 + Math.random() * 50;
    const w = 10 + Math.random() * 18, h = 8 + Math.random() * 22;
    const m = noRay(new THREE.Mesh(rockGeo(40 + i, 2), mesaMat));
    m.scale.set(w, h, w * (0.6 + Math.random() * 0.6));
    m.position.set(Math.cos(a) * r, h * 0.3, Math.sin(a) * r); m.rotation.y = Math.random() * 3;
    scene.add(m);
  }
  // a ringed gas giant and a small moon in the sky
  const planetTex = canvasTex(256, 128, (g, w, h) => {
    for (let y = 0; y < h; y++) { const t = y / h; g.fillStyle = `hsl(${20 + Math.sin(t * 22) * 12 + t * 20}, 45%, ${45 + Math.sin(t * 9) * 12}%)`; g.fillRect(0, y, w, 1); }
  });
  const planet = noRay(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 20), new THREE.MeshBasicMaterial({ map: planetTex, fog: false })));
  planet.position.set(120, 110, 170); planet.rotation.z = 0.3; scene.add(planet);
  const ring = noRay(new THREE.Mesh(new THREE.RingGeometry(38, 58, 64), new THREE.MeshBasicMaterial({ color: 0xd8b89a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false })));
  ring.position.copy(planet.position); ring.rotation.set(1.2, 0.2, 0.3); scene.add(ring);
  const moon = noRay(new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xcfd6e6, fog: false })));
  moon.position.set(-90, 120, 140); scene.add(moon);

  const steel = toon({ map: plateTex.col, normalMap: plateTex.nrm, roughness: 0.45, metalness: 0.75 });
  const darkSteel = toon({ color: 0x2b2f36, roughness: 0.4, metalness: 0.8 });
  const hazard = toon({ map: stripeTex, roughness: 0.6, metalness: 0.2 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.4) });
  const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; noRay(m); scene.add(m); return m; };
  // mining drill rigs with spinning heads and blinking lamps
  for (const [x, z, s] of [[-46, -42, 1.2], [-50, 44, 1]]) {
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 14 * s, 0.4), darkSteel), x + lx * s, 7 * s, z + lz * s); leg.rotation.set(lz * 0.04, 0, -lx * 0.04); }
    for (const y of [3, 7, 11]) add(new THREE.Mesh(new THREE.BoxGeometry(4.4 * s, 0.3, 4.4 * s), darkSteel), x, y * s, z);
    const head = new THREE.Group(); head.position.set(x, 4 * s, z); scene.add(head);
    const bit = noRay(new THREE.Mesh(new THREE.CylinderGeometry(0.9 * s, 0.2, 4 * s, 10), darkSteel)); bit.castShadow = true; head.add(bit);
    for (let k = 0; k < 3; k++) { const fl = noRay(new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.4 * s, 1.6 * s), steel)); fl.rotation.y = k * 2.1; head.add(fl); }
    ambient.drills.push(head);
    const lb = add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lamp.clone()), x, 14.4 * s, z);
    ambient.beacons.push(lb);
    add(new THREE.Mesh(new THREE.BoxGeometry(6 * s, 1.2, 6 * s), hazard), x, 0.6, z);
    smokeSpots.push(new THREE.Vector3(x, 0.8, z));
  }
  // refinery: tanks, pipes and a stack
  {
    const [x, z] = [46, -44];
    for (const [dx, dz, r, h] of [[0, 0, 3, 9], [6, 2, 2.2, 7], [-2, 6, 2, 6]]) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), steel), x + dx, h / 2, z + dz);
      add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel), x + dx, h, z + dz);
      add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.5, 20), hazard), x + dx, 1, z + dz);
    }
    const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 10), darkSteel), x + 3, 5.5, z + 1); pipe.rotation.z = Math.PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 16, 12), darkSteel), x - 5, 8, z - 3);
    smokeSpots.push(new THREE.Vector3(x - 5, 16.5, z - 3));
    ambient.beacons.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lamp.clone()), x - 5, 16.3, z - 3));
  }
  // habitat domes with lit windows
  {
    const [x, z] = [48, 40];
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fc8ff, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.55 });
    for (const [dx, dz, r] of [[0, 0, 5], [8, 4, 3.4], [-6, 6, 3]]) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.6, 24), steel), x + dx, 0.8, z + dz);
      add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass), x + dx, 1.6, z + dz);
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.8) });
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const w = noRay(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), glow)); w.position.set(x + dx + Math.cos(a) * (r + 0.01), 0.9, z + dz + Math.sin(a) * (r + 0.01)); w.rotation.y = -a + Math.PI / 2; scene.add(w); }
    }
    const tube = add(new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 1.4), steel), x + 4.2, 0.7, z + 2);
    tube.rotation.y = -0.45;
  }
  // a crashed freighter half buried in the dust
  {
    const [x, z] = [0, -58];
    const hull = add(new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, 26, 10, 1), steel), x, 2, z);
    hull.rotation.set(0.15, 0.3, Math.PI / 2 - 0.25);
    const nose = add(new THREE.Mesh(new THREE.ConeGeometry(4, 7, 10), steel), x + 14, 4.5, z - 4); nose.rotation.set(0, 0.3, -Math.PI / 2 - 0.25);
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 6), darkSteel), x - 9, 7, z + 2.5); fin.rotation.z = -0.3;
    smokeSpots.push(new THREE.Vector3(x + 4, 6, z - 1));
    for (let i = 0; i < 4; i++) { const r = add(new THREE.Mesh(rg[i % 3], rockMat), x + (Math.random() - 0.5) * 24, 0.4, z + 4 + Math.random() * 3); r.scale.set(2.2, 1.2, 1.8); }
  }
  // perimeter: light pylons and a low wall around the play area
  const wallMat = toon({ color: 0x55504a, roughness: 0.85, metalness: 0.1, normalMap: plateTex.nrm });
  for (const [x, z, w, dd] of [[0, -30.6, 61, 0.4], [0, 30.6, 61, 0.4], [-30.6, 0, 0.4, 61], [30.6, 0, 0.4, 61]]) add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, dd), wallMat), x, 0.3, z);
  for (let i = 0; i <= 8; i++) for (const s of [-1, 1]) {
    const t = -30 + i * 7.5;
    for (const [px, pz] of [[s * 30.6, t], [t, s * 30.6]]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.25), darkSteel), px, 1.1, pz);
      const l = noRay(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.4) }))); l.position.set(px, 2.25, pz); scene.add(l);
    }
  }
  // drifting dust motes / embers, catching the low sun
  const EM = 260, pos = new Float32Array(EM * 3);
  for (let i = 0; i < EM; i++) { pos[i * 3] = (Math.random() - 0.5) * 90; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ambient.embers = noRay(new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffc896, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false })));
  scene.add(ambient.embers);
  // a dropship circling the colony
  {
    const ship = new THREE.Group();
    const body = noRay(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 6), steel)); ship.add(body);
    const cock = noRay(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.9 }))); cock.position.set(0, 0.5, -2.6); ship.add(cock);
    for (const s of [-1, 1]) {
      const wing = noRay(new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 2.2), darkSteel)); wing.position.set(s * 2.4, 0, 0.6); ship.add(wing);
      const eng = noRay(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.8, 10), darkSteel)); eng.rotation.x = Math.PI / 2; eng.position.set(s * 3.6, 0, 0.8); ship.add(eng);
      const fl = noRay(new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.2, 4) }))); fl.position.set(s * 3.6, 0, 1.75); ship.add(fl);
    }
    ship.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(ship); ambient.dropship = ship;
  }
}
function updateAmbient(dt, now) {
  windUniform.value = now / 1000;
  const t = now / 1000;
  for (const h of ambient.drills) h.rotation.y += dt * 2.5;
  for (const b of ambient.beacons) b.visible = (t * 1.2 + b.position.x) % 1 < 0.5;
  if (ambient.dropship) {
    const a = t * 0.06, s = ambient.dropship;
    s.position.set(Math.cos(a) * 70, 24 + Math.sin(t * 0.4) * 2, Math.sin(a) * 70);
    s.rotation.set(0, -a + Math.PI, 0.25);
  }
  if (ambient.embers) {
    const p = ambient.embers.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + dt * 1.6, y = p.getY(i) + Math.sin(t + i) * dt * 0.3;
      if (x > 45) x = -45;
      p.setXY(i, x, y);
    }
    p.needsUpdate = true;
  }
  ambient.smokeT -= dt;
  if (ambient.smokeT <= 0) { ambient.smokeT = 0.3; for (const sp of smokeSpots) puff(sp.x, sp.y, sp.z, 1.4, 0x8a7a70, 3.6, 1.6, 0.45); }
}

// ---------------------------------------------------------------- cover: cargo containers, crates, barriers, prefab huts
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
const containerTex = (() => { // corrugated container walls
  const n = makeNoise(256, 8, 21);
  return surfaceTextures(256, (x, y) => Math.sin(x * 0.4) * 0.5 + n(x, y, 3) * 0.2,
    (h, x, y) => { const rust = Math.max(0, n(x, (y * 2) % 256, 3) - 0.6) * 2.5; return mixc([255, 255, 255], [150, 90, 60], Math.min(1, rust)).map(v => v * (0.85 + h * 0.1)); },
    4, 1, 1);
})();
const containerColors = [0x2f6f9a, 0xa8432c, 0x5a7a3a, 0xc08a2a];
const hayMat = toon({ map: plateTex.col, normalMap: plateTex.nrm, roughness: 0.5, metalness: 0.7, color: 0x8a8f96 }); // crate metal (name kept for towers)
const hayTopMat = toon({ color: 0x555a62, roughness: 0.6, metalness: 0.6 });
const plankMat = toon({ color: 0x8c8a86, roughness: 0.9, metalness: 0.05, normalMap: rockTex.nrm }); // concrete
const barnRedMat = toon({ map: plateTex.col, normalMap: plateTex.nrm, roughness: 0.55, metalness: 0.6, color: 0xb8bcc4 });
OBSTACLE_DEFS.forEach(([x, z, w, d, h], idx) => {
  const barrier = Math.min(w, d) <= 1;          // thin ones are concrete barriers
  const hut = w === 3 && d === 3;              // square ones are prefab huts
  let m;
  if (barrier) {
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plankMat);
    const cap = noRay(new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1), toon({ map: stripeTex, roughness: 0.6 }))); cap.position.set(x, h + 0.06, z); scene.add(cap);
  } else if (hut) {
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [barnRedMat, barnRedMat, hayTopMat, barnRedMat, barnRedMat, barnRedMat]);
  } else { // shipping container
    const c = containerTex.col.clone(); c.needsUpdate = true; c.repeat.set(w / 2.5, 1);
    const n2 = containerTex.nrm.clone(); n2.needsUpdate = true; n2.repeat.set(w / 2.5, 1);
    const mat = toon({ map: c, normalMap: n2, color: containerColors[idx % containerColors.length], roughness: 0.55, metalness: 0.55 });
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  staticShootables.push(m);
  if (hut) { // antenna, door and a warm lamp
    const door = noRay(new THREE.Mesh(new THREE.PlaneGeometry(1, 1.7), toon({ color: 0x2a2e34, roughness: 0.4, metalness: 0.8 })));
    door.position.set(x, 0.85, z + (z > 0 ? -1.51 : 1.51)); if (z > 0) door.rotation.y = Math.PI;
    const lampM = noRay(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.8, 0.8) })));
    lampM.position.set(x, 1.95, z + (z > 0 ? -1.56 : 1.56));
    const ant = noRay(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6), hayTopMat)); ant.position.set(x + 1, h + 0.8, z + 1);
    const vent = noRay(new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), hayMat)); vent.position.set(x - 0.5, h + 0.2, z - 0.4); vent.castShadow = true;
    scene.add(door, lampM, ant, vent);
  } else if (!barrier) { // crates stacked on top
    const top = noRay(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), hayMat));
    top.position.set(x + w * 0.25, h + 0.45, z); top.rotation.y = 0.3; top.castShadow = true;
    scene.add(top);
  }
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
});

// ---------------------------------------------------------------- capture points: comms relays with a glowing core
const NEUTRAL_COLOR = 0xdfe6f0;
const relayPad = toon({ map: plateTex.col, normalMap: plateTex.nrm, roughness: 0.4, metalness: 0.8, color: 0x9aa0a8 });
const points = POINT_DEFS.map(([name, x, z]) => {
  const g = new THREE.Group();
  const disc = noRay(new THREE.Mesh(new THREE.CircleGeometry(POINT_R, 40), new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.12, depthWrite: false })));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
  const rim = noRay(new THREE.Mesh(new THREE.RingGeometry(POINT_R - 0.12, POINT_R, 48), new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.8, depthWrite: false })));
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.04;
  const arc = noRay(new THREE.Mesh(new THREE.RingGeometry(POINT_R + 0.1, POINT_R + 0.45, 48, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  arc.rotation.x = -Math.PI / 2; arc.position.y = 0.05;
  const nest = noRay(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.35, 8), relayPad)); // the relay base
  nest.position.y = 0.17; nest.castShadow = nest.receiveShadow = true;
  const mast = noRay(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 8), hayTopMat)); mast.position.y = 1.9; mast.castShadow = true;
  const dish = noRay(new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), relayPad)); dish.position.y = 3.2; dish.rotation.x = 0.9;
  const eggMat = new THREE.MeshStandardMaterial({ color: NEUTRAL_COLOR, emissive: NEUTRAL_COLOR, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1 });
  const flag = noRay(new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), eggMat)); // the glowing core, coloured by owner
  flag.scale.set(1, 1.5, 1); flag.position.y = 1.2;
  const halo = noRay(new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 6, 32), eggMat)); halo.position.y = 1.2; halo.rotation.x = Math.PI / 2;
  flag.add(noRay(new THREE.Object3D()));
  const beamGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 20, 1, true); beamGeo.translate(0, 7, 0);
  const beam = noRay(new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ // a light column over a held relay
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uTime: windUniform },
    vertexShader: 'varying float vY; void main(){ vY = position.y / 14.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying float vY; void main(){ float a = (1.0 - vY) * (0.35 + 0.15 * sin(vY * 20.0 - uTime * 4.0)); gl_FragColor = vec4(uColor * a, a); }',
  })));
  beam.visible = false;
  g.add(disc, rim, arc, nest, mast, dish, flag, halo, beam);
  g.position.set(x, 0, z);
  scene.add(g);
  return { name, x, z, owner: null, prog: 0, disc, rim, arc, flag, halo, beam, lastArc: -2 };
});
const pointColor = p => (p.owner === PLAYER ? TEAM_COLORS[PLAYER] : p.owner === ENEMY ? TEAM_COLORS[ENEMY] : NEUTRAL_COLOR);
const playerPointCount = () => points.filter(p => p.owner === PLAYER).length;

// ---------------------------------------------------------------- entities: marines vs the swarm
let entities = [];
const teamMats = TEAM_COLORS.map(c => toon({ color: c, roughness: 0.45, metalness: 0.4 }));
const darkMat = toon({ color: 0x353b44, roughness: 0.4, metalness: 0.55 });   // gunmetal
const goldMat = toon({ color: 0x5a2a7a, emissive: 0x6a1aa0, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3 }); // tyrant carapace
const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x38c8ff, emissiveIntensity: 1.8, roughness: 0.1, metalness: 0.6 });
const orangeMat = toon({ color: 0xff8a1f, roughness: 0.5 });
const suitMat = toon({ color: 0x23272d, roughness: 0.8, metalness: 0.1 });     // under-suit
const eyeGlow = [0x9cff3a, 0xff3a6a].map(c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) }));
const acidMat = new THREE.MeshStandardMaterial({ color: 0x6aff2a, emissive: 0x4adf10, emissiveIntensity: 1.4, roughness: 0.2, transparent: true, opacity: 0.85 });
const NAMES = [
  { trooper: 'Marine', heavy: 'Juggernaut', sniper: 'Ranger', turret: 'Autoturret', mortar: 'Mortar', scarecrow: 'Stasis pylon' },
  { trooper: 'Skitter', heavy: 'Brute', sniper: 'Spitter', elite: 'Hive Tyrant' },
];
const nameOf = u => NAMES[u.team][u.type];
const sphere = new THREE.SphereGeometry(1, 16, 12);
const ARMOR = { trooper: 0x6d7a68, heavy: 0x4a4f58, sniper: 0xa89478 };   // olive, steel, desert
const CARAPACE = { trooper: 0x3a2448, heavy: 0x2a1a30, sniper: 0x3c2a1c };

function tagMeshes(group, ent) {
  group.traverse(o => { o.userData.entity = ent; if (o.isMesh) o.castShadow = true; });
}
function blob(mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(sphere, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m;
}
function box(mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m;
}
// a limb that pivots at its top: returns the pivot group
function limb(mat, len, thick, x, y, z, foot) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick * 1.1), mat); m.position.y = -len / 2; g.add(m);
  if (foot) { const f = new THREE.Mesh(new THREE.BoxGeometry(thick * 1.2, thick * 0.6, thick * 1.8), foot); f.position.set(0, -len, -thick * 0.3); g.add(f); }
  return g;
}

function buildMarine(u, g, type, team) {
  const armor = toon({ color: ARMOR[type], roughness: 0.5, metalness: 0.55, normalMap: plateTex.nrm, normalScale: new THREE.Vector2(0.4, 0.4) });
  u.bodyMat = armor;
  const big = type === 'heavy' ? 1.25 : 1, tall = type === 'sniper' ? 1.06 : 1;
  // legs (pivot at the hip) with armoured boots
  u.legs = [-1, 1].map(s => { const l = limb(suitMat, 0.62 * tall, 0.17 * big, s * 0.14 * big, 0.66 * tall, 0, darkMat); l.add(box(armor, 0.2 * big, 0.22, 0.12, 0, -0.32 * tall, -0.08)); return l; });
  g.add(...u.legs);
  const up = new THREE.Group(); up.position.y = 0.66 * tall; up.userData.y0 = up.position.y; g.add(up); u.upper = up;
  // torso, chest plate, belt, backpack
  up.add(box(suitMat, 0.42 * big, 0.5, 0.26 * big, 0, 0.3, 0));
  up.add(box(armor, 0.5 * big, 0.36, 0.32 * big, 0, 0.42, -0.01));
  up.add(box(darkMat, 0.44 * big, 0.08, 0.28 * big, 0, 0.08, 0));
  up.add(box(armor, 0.34 * big, 0.42, 0.18, 0, 0.38, 0.24 * big));
  if (type === 'sniper') { const cloak = box(toon({ color: 0x7a6a52, roughness: 0.95, metalness: 0 }), 0.46, 0.5, 0.05, 0, 0.3, 0.36); cloak.rotation.x = 0.15; up.add(cloak); }
  // shoulder pads in team colour
  for (const s of [-1, 1]) { const pad = blob(teamMats[team], 0.15 * big, 0.1 * big, 0.17 * big, s * 0.31 * big, 0.6, 0); up.add(pad); }
  // helmet with a glowing visor
  const headY = 0.86;
  const helm = blob(armor, 0.17 * big, 0.19 * big, 0.19 * big, 0, headY, 0.01); up.add(helm);
  const visor = box(visorMat, 0.24 * big, 0.07, 0.06, 0, headY + 0.02, -0.16 * big); up.add(visor);
  if (type === 'heavy') up.add(box(armor, 0.36, 0.16, 0.3, 0, headY - 0.12, 0)); // armoured collar
  // arms holding the rifle
  u.arms = [-1, 1].map(s => { const a = limb(suitMat, 0.48, 0.13 * big, s * 0.3 * big, 0.58, 0); a.rotation.x = -1.1; a.rotation.z = -s * 0.25; a.add(box(armor, 0.16 * big, 0.2, 0.16 * big, 0, -0.08, 0)); return a; });
  up.add(...u.arms);
  const gunLen = { heavy: 0.9, sniper: 1.25 }[type] || 0.75;
  const gun = new THREE.Group(); gun.position.set(0.12, 0.45, -0.3); up.add(gun);
  gun.add(box(darkMat, 0.09, 0.14, gunLen, 0, 0, -gunLen / 2 + 0.15));
  gun.add(box(darkMat, 0.06, 0.16, 0.08, 0, -0.12, 0.05));
  if (type === 'heavy') { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), darkMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -gunLen + 0.05); gun.add(barrel); }
  if (type === 'sniper') gun.add(box(visorMat, 0.04, 0.05, 0.25, 0, 0.11, -0.2));
  gun.add(box(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3) }), 0.03, 0.03, 0.12, 0.05, 0.03, -gunLen * 0.5));
  u.gun = gun;
  u.muzzleOffset = { side: 0.12, fwd: gunLen + 0.2, y: 0.66 * tall + 0.45 };
  u.feet = u.legs; u.wings = u.arms;
  if (type === 'heavy') g.scale.setScalar(1.08);
}

function buildAlien(u, g, type) {
  const elite = type === 'elite';
  const shell = elite ? goldMat.clone() : toon({ color: CARAPACE[type], roughness: 0.28, metalness: 0.35, normalMap: rockTex.nrm, normalScale: new THREE.Vector2(0.6, 0.6) });
  u.bodyMat = shell;
  const belly = toon({ color: type === 'sniper' ? 0x8a6a3a : 0x6a4a5a, roughness: 0.6, metalness: 0.05 });
  const legMat = toon({ color: 0x1a1018, roughness: 0.4, metalness: 0.3 });
  const up = new THREE.Group(); g.add(up); u.upper = up;
  const heavyish = type === 'heavy' || elite;
  const L = heavyish ? 0.95 : type === 'sniper' ? 0.8 : 0.6; // body height
  // body segments
  if (type === 'sniper') {
    up.add(blob(shell, 0.42, 0.36, 0.55, 0, L, 0.3));                // abdomen
    const sac = blob(acidMat, 0.3, 0.3, 0.34, 0, L + 0.35, 0.4); up.add(sac); u.sac = sac; // glowing acid sac
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.9, 8), shell); neck.position.set(0, L + 0.45, -0.25); neck.rotation.x = -0.5; up.add(neck);
    up.add(blob(shell, 0.2, 0.18, 0.3, 0, L + 0.85, -0.5));           // head
  } else {
    const s = heavyish ? 1.5 : 1;
    up.add(blob(shell, 0.42 * s, 0.32 * s, 0.6 * s, 0, L, 0.35 * s));      // abdomen
    up.add(blob(belly, 0.36 * s, 0.22 * s, 0.5 * s, 0, L - 0.12 * s, 0.32 * s));
    up.add(blob(shell, 0.32 * s, 0.28 * s, 0.34 * s, 0, L + 0.05 * s, -0.12 * s)); // thorax
    up.add(blob(shell, 0.22 * s, 0.2 * s, 0.24 * s, 0, L + 0.08 * s, -0.5 * s));  // head
    for (let k = 0; k < (heavyish ? 4 : 3); k++) up.add(blob(shell, 0.08 * s, 0.14 * s, 0.1 * s, 0, L + 0.3 * s, 0.1 * s + k * 0.22 * s)); // dorsal spines
    if (heavyish) for (const sd of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.5 * s, 6), toon({ color: 0xd8c8b0, roughness: 0.4 })); horn.position.set(sd * 0.16 * s, L + 0.25 * s, -0.62 * s); horn.rotation.set(-1.0, 0, sd * 0.3); up.add(horn); }
  }
  // glowing eyes and mandibles
  const hz = type === 'sniper' ? -0.72 : heavyish ? -0.82 : -0.62, hy = type === 'sniper' ? L + 0.88 : L + (heavyish ? 0.15 : 0.1);
  u.eyes = [];
  for (const sd of [-1, 1]) {
    const e = blob(eyeGlow[elite ? 1 : 0], 0.045, 0.035, 0.03, sd * (heavyish ? 0.13 : 0.09), hy + 0.04, hz + (heavyish ? 0.1 : 0.08)); up.add(e); u.eyes.push(e);
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 5), legMat); m.position.set(sd * 0.06, hy - 0.08, hz); m.rotation.set(-Math.PI / 2 - 0.3, 0, sd * 0.4); up.add(m);
  }
  // legs: three per side (two for the brutes, thicker), grouped per side so they scuttle in turn
  const sides = [-1, 1].map(sd => {
    const side = new THREE.Group(); g.add(side);
    const n = heavyish ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const z = (k - (n - 1) / 2) * (heavyish ? 0.7 : 0.35);
      const th = heavyish ? 0.1 : 0.05;
      const thigh = limb(legMat, L * 0.9, th, sd * 0.25 * (heavyish ? 1.4 : 1), L, z);
      thigh.rotation.z = sd * 1.05;
      const shin = limb(legMat, L * 1.15, th * 0.85, 0, -L * 0.9, 0); shin.rotation.z = -sd * 1.6; thigh.add(shin);
      side.add(thigh);
    }
    return side;
  });
  u.legs = sides; u.feet = sides; u.wings = [new THREE.Group(), new THREE.Group()];
  u.muzzleOffset = { side: 0, fwd: -hz + 0.1, y: hy };
  if (elite) { // the tyrant: a crown of glowing spikes
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 5), acidMat); sp.position.set((k - 2) * 0.16, L + 0.6, -0.25 + Math.abs(k - 2) * 0.08); up.add(sp); }
  }
}

function makeUnit(team, type, x, z) {
  const t = TYPES[type];
  const u = {
    kind: 'unit', type, team, x, z, hp: t.hp * (team === PLAYER ? PLAYER_HP : 1), maxHp: t.hp * (team === PLAYER ? PLAYER_HP : 1), speed: t.speed, range: t.range,
    dmg: t.dmg, rate: t.rate, radius: t.radius, acc: t.acc,
    facing: team === PLAYER ? 0 : Math.PI, cool: Math.random() * t.rate, abilityCd: 0, armorT: 0,
    order: { type: 'idle' }, path: null, pathGoal: null, possessed: false, dead: false, flash: 0,
    elite: type === 'elite',
  };
  const g = new THREE.Group();
  if (team === PLAYER) buildMarine(u, g, type, team); else buildAlien(u, g, type);
  u.animT = Math.random() * 10;
  if (type === 'elite') g.scale.setScalar(1.3);
  u.baseScale = g.scale.x;
  tagMeshes(g, u);
  const r = t.radius;
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

// bases: the marines' command bunker and the swarm's hive
function makeBase(team, x, z) {
  const b = {
    kind: 'base', isBase: true, team, x, z, hp: 1500, maxHp: 1500, radius: 2.5, dead: false, flash: 0,
    shield: team === ENEMY,
  };
  const g = new THREE.Group();
  let beacon;
  if (team === PLAYER) {
    const bodyMat = toon({ map: plateTex.col, normalMap: plateTex.nrm, color: 0x9aa2ac, roughness: 0.45, metalness: 0.75 });
    b.bodyMat = bodyMat;
    const core = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 5), bodyMat); core.position.y = 1.3;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 3.4), bodyMat); top.position.y = 3.2;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.35, 5.1), toon({ map: stripeTex, roughness: 0.6 })); trim.position.y = 0.2;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 0.1), darkMat); door.position.set(0, 0.95, -2.52);
    const doorLight = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 3) })); doorLight.position.set(0, 1.95, -2.55);
    const mastM = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6), darkMat); mastM.position.set(0, 4.5, 0);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), bodyMat); dish.rotation.x = 1.1; dish.position.set(0, 5.2, 0);
    b.dish = dish;
    beacon = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3.2) })); beacon.scale.setScalar(0.18); beacon.position.y = 4.9;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(darkMat, 0.4, 3, 0.4, sx * 2.45, 1.5, sz * 2.45));
    g.add(core, top, trim, door, doorLight, mastM, dish, beacon);
  } else {
    const bodyMat = toon({ color: 0x3a1c40, roughness: 0.35, metalness: 0.2, normalMap: rockTex.nrm, normalScale: new THREE.Vector2(1.5, 1.5) });
    b.bodyMat = bodyMat;
    const mound = new THREE.Mesh(rockGeo(7, 2), bodyMat); mound.scale.set(2.8, 2.6, 2.8); mound.position.y = 0.8;
    g.add(mound);
    for (let k = 0; k < 7; k++) { // pulsing egg sacs
      const a = k / 7 * Math.PI * 2, sac = new THREE.Mesh(sphere, acidMat); sac.scale.set(0.35, 0.45, 0.35);
      sac.position.set(Math.cos(a) * 2.3, 0.6 + (k % 3) * 0.7, Math.sin(a) * 2.3); g.add(sac);
    }
    for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.4, 6), bodyMat); const a = k / 6 * Math.PI * 2 + 0.4; sp.position.set(Math.cos(a) * 1.8, 3.2, Math.sin(a) * 1.8); sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(sp); }
    beacon = new THREE.Mesh(sphere, acidMat); beacon.scale.set(0.6, 0.8, 0.6); beacon.position.y = 4.9;
    const maw = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2, 0.3) })); maw.position.set(0, 1, 2.62); g.add(maw, beacon);
  }
  b.beacon = beacon;
  tagMeshes(g, b);
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  if (b.shield) { // a hexagonal bio-shield dome with a fresnel glow
    const sh = noRay(new THREE.Mesh(
      new THREE.SphereGeometry(4.4, 40, 20),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { opacity: { value: 0.2 }, uTime: windUniform },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: `uniform float opacity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main(){
            float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.5);
            vec2 q = vec2(atan(vP.z, vP.x) * 6.0, vP.y * 3.0); vec2 h = abs(fract(q) - 0.5);
            float hex = smoothstep(0.42, 0.5, max(h.x, h.y));
            float pulse = 0.6 + 0.4 * sin(vP.y * 2.0 - uTime * 2.0);
            vec3 c = vec3(0.7, 0.35, 1.0) * (f * 1.6 + hex * 0.5 * pulse) * opacity * 4.0;
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    ));
    sh.scale.set(1, 1.3, 1);
    sh.position.y = 0.8;
    sh.material.opacity = 0.2; // read by updateBases
    Object.defineProperty(sh.material, 'opacity', { get() { return this.uniforms.opacity.value; }, set(v) { if (this.uniforms) this.uniforms.opacity.value = v; } });
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

// towers (Tactics only): immobile units on your half of the map
function makeTower(type, x, z) {
  const t = TYPES[type];
  const u = {
    kind: 'unit', isTower: true, type, team: PLAYER, x, z, hp: t.hp, maxHp: t.hp, speed: 0, range: t.range,
    dmg: t.dmg, rate: t.rate, radius: t.radius, acc: t.acc, facing: 0, cool: 0, abilityCd: 0, armorT: 0,
    order: { type: 'idle' }, path: null, pathGoal: null, possessed: false, dead: false, flash: 0, lvl: 1,
  };
  const g = new THREE.Group();
  const bodyMat = toon({ map: plateTex.col, normalMap: plateTex.nrm, color: 0x8a929c, roughness: 0.45, metalness: 0.75 });
  u.bodyMat = bodyMat;
  if (type === 'turret') {
    for (let k = 0; k < 3; k++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), darkMat); const a = k / 3 * Math.PI * 2; leg.position.set(Math.cos(a) * 0.45, 0.45, Math.sin(a) * 0.45); leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); g.add(leg); }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.8), bodyMat); head.position.y = 1.1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8), darkMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(0.12, 1.15, -0.85);
    const barrel2 = barrel.clone(); barrel2.position.x = -0.12;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), visorMat); eye.position.set(0, 1.25, -0.42);
    g.add(head, barrel, barrel2, eye);
    u.muzzleOffset = { side: 0, fwd: 1.4, y: 1.15 };
  } else if (type === 'mortar') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 10), bodyMat); base.position.y = 0.25;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 12), darkMat); tube.position.set(0, 1.0, -0.1); tube.rotation.x = -0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16), toon({ map: stripeTex })); ring.position.set(0, 0.7, 0.1); ring.rotation.x = Math.PI / 2 - 0.5;
    g.add(base, tube, ring);
    u.muzzleOffset = { side: 0, fwd: 0.3, y: 1.4 };
  } else { // stasis pylon: slows the swarm around it
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 2.2, 6), bodyMat); post.position.y = 1.1;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x58b8ff, emissiveIntensity: 2.2 })); core.position.y = 2.5;
    for (let k = 0; k < 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.5), darkMat); fin.position.y = 1.0; fin.rotation.y = k * 2.1; g.add(fin); }
    g.add(post, core);
    const aura = noRay(new THREE.Mesh(new THREE.RingGeometry(5.7, 6, 48), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthWrite: false })));
    aura.rotation.x = -Math.PI / 2; aura.position.y = 0.06; g.add(aura);
    u.muzzleOffset = { side: 0, fwd: 0, y: 1 };
  }
  tagMeshes(g, u);
  const ring = noRay(new THREE.Mesh(new THREE.RingGeometry(u.radius + 0.12, u.radius + 0.28, 28), new THREE.MeshBasicMaterial({ color: 0x2dff7a, transparent: true, opacity: 0.95, depthWrite: false })));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.visible = false; g.add(ring);
  u.ring = ring; u.mesh = g;
  g.position.set(x, 0, z); scene.add(g);
  entities.push(u);
  return u;
}

function updateTower(u, dt) {
  if (u.type === 'scarecrow') { // scare and slow every hen nearby
    for (const e of entities) if (!e.dead && !e.isBase && e.team === ENEMY && Math.hypot(e.x - u.x, e.z - u.z) < 6) e.slowT = 0.3;
    u.facing += dt * 0.3;
    return;
  }
  const target = findTarget(u, u.range);
  if (!target || target.isBase) return;
  u.facing = angleLerp(u.facing, facingFor(target.x - u.x, target.z - u.z), Math.min(1, dt * 8));
  if (u.cool > 0) return;
  if (u.type === 'mortar') {
    const d = Math.hypot(target.x - u.x, target.z - u.z);
    if (d < 4) return;
    u.cool = u.rate;
    lobEgg(u, target.x + (Math.random() - 0.5) * 1.5, target.z + (Math.random() - 0.5) * 1.5, 1.4, 3.4, u.dmg);
    sfx('blast', u.x, u.z);
  } else if (hasLOS(u, target)) aiShoot(u, target);
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
const onTop = (u, b) => (u.y || 0) >= (b.h ?? 99) - 0.05 && u.x > b.minX - 0.3 && u.x < b.maxX + 0.3 && u.z > b.minZ - 0.3 && u.z < b.maxZ + 0.3;
function hasLOS(a, b) {
  for (const box of boxes) {
    if (box.owner === b || box.owner === a) continue;
    if (onTop(a, box) || onTop(b, box)) continue; // a heron on a hay bale sees and is seen over it
    if (segHitsBox(a.x, a.z, b.x, b.z, box)) return false;
  }
  return true;
}
const distTo = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) - (b.isBase ? b.radius : 0);

function resolveCollision(u) {
  for (const b of boxes) {
    if ((u.y || 0) >= (b.h ?? 99) - 0.05) continue; // above it
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
  effects.push({ m, life: 0.45, max: 0.45, size });  if (size >= 2) smoke(x, Math.max(0.3, y - 0.5), z, Math.min(3, size * 0.45), Math.min(14, 4 + Math.round(size * 1.5)));
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
// overbright so they glow under bloom
bulletMats.corn.color.setRGB(0.8, 2.2, 4.0); bulletMats.seed.color.setRGB(1.2, 3.2, 0.4); bulletMats.gold.color.setRGB(3.0, 0.6, 3.2); // plasma, acid, tyrant bile
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
function debrisMat(c) { return debrisMats[c] || (debrisMats[c] = toon({ color: c, roughness: 0.8 })); }
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

// soft sprite puffs: dust when birds walk, smoke from blasts and the chimney
const puffTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 31, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const puffs = [];
for (let i = 0; i < 110; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
  sp.visible = false; sp.raycast = () => {}; scene.add(sp);
  puffs.push({ sp, life: 0, max: 1, vy: 0, vx: 0, vz: 0, size: 1, grow: 1, alpha: 1 });
}
let puffIdx = 0;
function puff(x, y, z, size, color, life = 0.8, vy = 0.6, alpha = 0.7, spread = 0.4) {
  const p = puffs[puffIdx++ % puffs.length];
  p.sp.position.set(x, y, z); p.sp.material.color.setHex(color); p.sp.visible = true;
  p.life = p.max = life; p.vy = vy; p.vx = (Math.random() - 0.5) * spread; p.vz = (Math.random() - 0.5) * spread;
  p.size = size; p.alpha = alpha; p.sp.material.rotation = Math.random() * 6;
}
function smoke(x, y, z, r, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, d = Math.random() * r * 0.6;
    puff(x + Math.cos(a) * d, y + Math.random() * r * 0.5, z + Math.sin(a) * d, r * (0.6 + Math.random() * 0.5), i % 3 ? 0xdddddd : 0xfff0c0, 0.9 + Math.random() * 0.7, 1 + Math.random() * 1.5, 0.75, r * 1.2);
  }
}
function updatePuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sp.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt;
    p.sp.scale.setScalar(p.size * (0.4 + k * 1.1));
    p.sp.material.opacity = p.alpha * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
  }
}
// confetti when a nest flips
const confettiGeo = new THREE.PlaneGeometry(0.14, 0.09);
const confettiMats = [0x6fd8ff, 0xffffff, 0x3fa9ff, 0xb8f0ff, 0x9fd8ff, 0x58b8ff].map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const confettiList = [];
function confetti(x, z, n = 60) {
  for (let i = 0; i < n; i++) {
    const m = noRay(new THREE.Mesh(confettiGeo, confettiMats[i % confettiMats.length]));
    m.position.set(x, 1.6, z); m.rotation.set(Math.random() * 6, Math.random() * 6, 0); scene.add(m);
    const a = Math.random() * 6.28, sp = 2 + Math.random() * 5;
    confettiList.push({ m, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 6, vz: Math.sin(a) * sp, spin: 6 + Math.random() * 10, life: 2.2 + Math.random() });
  }
  if (confettiList.length > 300) for (const c of confettiList.splice(0, confettiList.length - 300)) scene.remove(c.m);
}
// knocked-out birds pop up, spin and vanish instead of disappearing on the spot
const corpses = [];
function tumble(mesh) { corpses.push({ m: mesh, t: 0, vy: 5, spin: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6), s0: mesh.scale.x }); }
function updateKO(dt) {
  for (let i = confettiList.length - 1; i >= 0; i--) {
    const c = confettiList[i]; c.life -= dt;
    c.vy = Math.max(-1.6, c.vy - 14 * dt); c.vx *= 1 - dt * 1.5; c.vz *= 1 - dt * 1.5;
    c.m.position.x += c.vx * dt; c.m.position.y = Math.max(0.03, c.m.position.y + c.vy * dt); c.m.position.z += c.vz * dt;
    c.m.rotation.x += c.spin * dt; c.m.rotation.y += c.spin * 0.7 * dt;
    if (c.life <= 0) { scene.remove(c.m); confettiList.splice(i, 1); }
  }
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i]; c.t += dt; c.vy -= 22 * dt;
    c.m.position.y = Math.max(0, c.m.position.y + c.vy * dt);
    c.m.rotation.z += c.spin * dt * 0.5; c.m.rotation.x += c.spin * dt * 0.25;
    const s = c.s0 * Math.max(0.01, 1 - Math.max(0, c.t - 0.35) / 0.3);
    c.m.scale.set(s, s, s);
    if (c.t > 0.65) { scene.remove(c.m); corpses.splice(i, 1); if (c.t > 0) puff(c.m.position.x, 0.4, c.m.position.z, 1.2, 0xffffff, 0.6, 0.8, 0.8); }
  }
}

// floating damage numbers (first person only)
const dmgNums = [];
function dmgNumber(p, amount, crit) {
  dmgNums.push({ x: p.x, y: p.y + 0.3, z: p.z, text: String(Math.round(amount)), life: 0.8, crit, dx: (Math.random() - 0.5) * 30 });
  if (dmgNums.length > 40) dmgNums.shift();
}

const feathersList = [];
const featherGeo = new THREE.BoxGeometry(0.1, 0.05, 0.16); // armour shards and chitin bits
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
    f.vy = Math.max(-9, f.vy - 14 * dt); f.vx *= 1 - dt * 2; f.vz *= 1 - dt * 2; // flutter down
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
    const base = kind === 'quack' ? 170 : kind === 'bawk' ? 1150 : 120;
    const reps = kind === 'bawk' ? 3 : 1;
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
let eliteTimer = 100, eliteWarned = false;
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
const playerUnits = () => entities.filter(e => !e.dead && !e.isBase && !e.isTower && e.team === PLAYER);

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
  const step = u.speed * (u.slowT > 0 ? 0.4 : 1) * dt;
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
    if (u.team === PLAYER && !e.isBase) { // smarter ducks: finish off the wounded, answer whoever shoots them, stay in range
      s -= (1 - e.hp / e.maxHp) * 5;
      if (e === u.lastHitBy) s -= 3;
      if (d <= u.range) s -= 3;
    }
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
  u.fireT = 0.3;
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
  const wallHit = wall.active && u.team === ENEMY ? wallBlocks(m.x, m.z, tx, tz) : null;
  if (wallHit) { // the goose's wing wall eats the shot
    shootBullet(from, new THREE.Vector3(wallHit.x, ty, wallHit.z), kind, 60, () => { wall.hp -= u.dmg; impactPuff(new THREE.Vector3(wallHit.x, ty, wallHit.z), 0xffffff, 2); });
    if (Math.random() < 0.6) sfx('pop', u.x, u.z);
    return;
  }
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
  if (t.invulnT > 0) return;
  if (src && src.possessed && !t.isBase && t.team !== src.team && !ultDamage) chargeUlt(src, amount * 0.12);
  if (t.isBase && t.shield) {
    if (Math.random() < 0.3) burst(t.x + (Math.random() - 0.5) * 6, 1 + Math.random() * 3, t.z + (Math.random() - 0.5) * 6, 0.4, 0xffa080);
    if (src && src.possessed && performance.now() > shieldToast) { shieldToast = performance.now() + 3000; toast('Bio-shield! Hold all 3 relays to break it', 1.5); }
    return;
  }
  if (t.armorT > 0) amount *= 0.5;
  t.hp -= amount;
  t.hurtAt = game.time;
  t.flash = 0.12;
  if (t.possessed) { fps.hurt = 0.5; fps.shake = Math.min(0.3, fps.shake + 0.06); }
  if (t === playerBase) radio('The outpost is under attack!', 'warn', { key: 'base', gap: 10, dropAt: playerBase });
  if (src && src.kind === 'unit') t.lastHitBy = src;
  // snipers out of reach: an idle bird goes after them (otherwise it just picks the best target nearby)
  if (!tac.on && !t.isBase && !t.possessed && t.order.type === 'idle' && src && src.kind === 'unit' && !src.dead && distTo(t, src) > t.range + 4 && !findTarget(t, t.range + 4)) t.order = { type: 'attack', target: src, auto: true };
  if (t.hp <= 0) kill(t, src);
}

const cap = s => s[0].toUpperCase() + s.slice(1);
function kill(e, src) {
  e.dead = true;
  burst(e.x, e.isBase ? 2 : 1, e.z, e.isBase ? 6 : 1.2, e.isBase ? 0xffaa44 : e.team === PLAYER ? 0xffc080 : 0x9cff3a);
  feathers(e.x, e.z, e.isBase ? (e.team === PLAYER ? 0x9aa0a8 : 0x6aff2a) : e.team === PLAYER ? 0x8a9098 : 0x7aff3a, e.isBase ? 40 : 14);
  sfx(e.isBase ? 'boom' : e.team === PLAYER ? 'quack' : 'bawk', e.x, e.z);
  if (e.isBase || e.possessed) scene.remove(e.mesh);
  else { if (e.ring) e.ring.visible = false; tumble(e.mesh); }
  if (e.isBase) {
    const i = boxes.indexOf(e.box); if (i >= 0) boxes.splice(i, 1);
    rebuildGrid();
    endGame(e.team === ENEMY);
    return;
  }
  if (e.team === ENEMY && !tac.on) {
    game.cp = Math.min(CP_MAX, game.cp + 3);
    if (e.elite) { game.cp = Math.min(CP_MAX, game.cp + 40); radio('The Hive Tyrant is down! +40 ore', 'good'); }
  }
  if (tac.on) {
    if (e === possessed) { radio(`Your hero ${nameOf(e).toLowerCase()} is down. Watch the rest of the round.`, 'warn'); rts.focus.set(e.x, 0, e.z); possessed = null; exitFPS(); }
    if (e.team === ENEMY) { game.cp = Math.min(CP_MAX, game.cp + (e.elite ? 30 : 4)); if (!countUnits(ENEMY)) radio('Wave cleared! More of the swarm comes next round', 'good'); }
    return;
  }
  if (e.team === PLAYER && e === possessed) {
    game.relink = RELINK_CD;
    radio(`Your ${nameOf(e).toLowerCase()} is down. Drop in again in ${RELINK_CD}s.`, 'warn');
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
  u.invulnT = (u.invulnT || 0) - dt;
  u.slowT = (u.slowT || 0) - dt;
  u.moving = false;
  // ducks patch themselves up after 4s out of the fight
  if (u.team === PLAYER && u.hp < u.maxHp && game.time - (u.hurtAt ?? -99) > REGEN_DELAY) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * REGEN_RATE * dt);
  if (u.isTower) { updateTower(u, dt); return; }
  if (u.possessed) return;
  if (u.stunT > 0) { u.stunT -= dt; return; }
  if (dodgeEggs(u, dt)) return;
  const o = u.order;
  if (o.type === 'bomb') { // walk until in throwing range, then lob an egg bomb
    if (Math.hypot(o.x - u.x, o.z - u.z) <= 10) { throwEgg(u, o.x, o.z); u.order = { type: 'idle' }; }
    else { pathTo(u, o.x, o.z); moveAlong(u, dt); fireOnTheMove(u); }
    return;
  }
  if (o.type !== 'idle') u.anchor = null;
  let target = null;
  if (o.type === 'attack') {
    if (o.target.dead) u.order = { type: 'idle' };
    else target = o.target;
  } else if (o.type === 'move' && u.team === PLAYER) {
    // a moving duck stops to shoot back at anything in range, then carries on to where you sent it
    const t = findTarget(u, u.range);
    if (t && !(t.isBase && t.shield) && hasLOS(u, t)) target = t;
  } else if (o.type === 'idle' || o.type === 'amove') {
    target = findTarget(u, Math.max(u.range + 4, VISION)); // react to anything that can shoot us, snipers included
  }
  if (target) {
    const d = distTo(u, target);
    // AI ducks and hens lob an egg bomb now and then (a simpler version of your ability)
    if (u.type === 'trooper' && u.abilityCd <= 0 && !target.isBase && d > 4 && d < 10) { u.abilityCd = 9 + Math.random() * 5; lobEgg(u, target.x, target.z, 0.9, 3, 35); }
    if (d <= u.range && hasLOS(u, target)) {
      u.path = null; u.pathGoal = null;
      u.facing = angleLerp(u.facing, facingFor(target.x - u.x, target.z - u.z), Math.min(1, dt * 12));
      if (u.cool <= 0) aiShoot(u, target);
      return;
    }
    if (o.auto && d > u.range + 8) { u.order = { type: 'idle' }; return; }
    if (tac.on && o.type === 'idle') { // in tactics, idle means hold this spot: step out a little to answer fire, never wander
      if (!u.anchor) u.anchor = { x: u.x, z: u.z };
      if (u.lastHitBy === target && Math.hypot(u.x - u.anchor.x, u.z - u.anchor.z) < 5) { pathTo(u, target.x, target.z); moveAlong(u, dt); fireOnTheMove(u); }
      return;
    }
    pathTo(u, target.x, target.z);
    moveAlong(u, dt);
    fireOnTheMove(u);
    return;
  }
  if (o.type === 'move' || o.type === 'amove') {
    pathTo(u, o.x, o.z);
    if (moveAlong(u, dt)) u.order = { type: 'idle' };
    fireOnTheMove(u);
  } else if (tac.on && o.type === 'idle' && u.anchor && Math.hypot(u.x - u.anchor.x, u.z - u.anchor.z) > 0.8) {
    pathTo(u, u.anchor.x, u.anchor.z); moveAlong(u, dt); // walk back to the held spot
  }
}

// see an egg bomb coming and hop out of the blast. Ducks always try; hens only sometimes, so your bombs still land.
function dodgeEggs(u, dt) {
  if (u.dodgeT > 0) {
    u.dodgeT -= dt;
    const dx = u.dodgeX - u.x, dz = u.dodgeZ - u.z, d = Math.hypot(dx, dz), step = u.speed * 1.5 * dt;
    if (d > 0.05) { const k = Math.min(1, step / d); u.x += dx * k; u.z += dz * k; u.facing = angleLerp(u.facing, facingFor(dx, dz), Math.min(1, dt * 12)); u.moving = true; resolveCollision(u); }
    fireOnTheMove(u);
    if (d <= 0.05) u.dodgeT = 0;
    return true;
  }
  for (const g of grenades) {
    if (g.tx === undefined || !g.src || g.src.team === u.team) continue;
    if (!g.seen) g.seen = new Set();
    if (g.seen.has(u)) continue;
    g.seen.add(u);
    const r = (g.r || 3.4) + 0.5, dx = u.x - g.tx, dz = u.z - g.tz, d = Math.hypot(dx, dz);
    if (d > r || (u.team === ENEMY && Math.random() > 0.3)) continue;
    const nx = d > 0.1 ? dx / d : Math.random() - 0.5, nz = d > 0.1 ? dz / d : Math.random() - 0.5, nl = Math.hypot(nx, nz) || 1;
    u.dodgeX = Math.max(-HALF + 1, Math.min(HALF - 1, g.tx + nx / nl * r)); u.dodgeZ = Math.max(-HALF + 1, Math.min(HALF - 1, g.tz + nz / nl * r));
    u.dodgeT = 0.9; u.path = null; u.pathGoal = null;
    return true;
  }
  return false;
}

// birds shoot at anything in range while they walk (a bit less accurately), instead of ignoring it
function fireOnTheMove(u) {
  if (u.cool > 0) return;
  const t = findTarget(u, u.range);
  if (!t || (t.isBase && t.shield) || !hasLOS(u, t)) return;
  const acc = u.acc; if (u.team === ENEMY) u.acc *= 0.8;
  const f = u.facing; aiShoot(u, t); u.facing = f;
  u.acc = acc;
}

function separate() {
  const units = entities.filter(e => !e.dead && !e.isBase);
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
    if (d < min && d > 1e-4) {
      const push = (min - d);
      const nx = dx / d, nz = dz / d;
      const fa = a.possessed || a.isTower, fb = b.possessed || b.isTower;
      if (fa && fb) continue;
      const wa = fa ? 0 : (fb ? 1 : 0.5), wb = 1 - wa;
      a.x -= nx * push * wa; a.z -= nz * push * wa;
      b.x += nx * push * wb; b.z += nz * push * wb;
    }
  }
  for (const u of units) resolveCollision(u);
}

const countUnits = team => entities.reduce((n, e) => n + (!e.dead && !e.isBase && !e.isTower && e.team === team ? 1 : 0), 0);

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
      p.owner = PLAYER; sfx('chime'); burst(p.x, 1, p.z, 3, TEAM_COLORS[PLAYER]); confetti(p.x, p.z);
      radio(`Relay ${p.name} is ours! +${CP_PER_POINT} ore/s`, 'good');
      onPointsChanged();
    } else if (p.prog <= -1 && p.owner !== ENEMY) {
      p.owner = ENEMY;
      radio(`The swarm took relay ${p.name}`, 'warn', { dropAt: p });
      onPointsChanged();
    } else if ((p.owner === PLAYER && p.prog <= 0) || (p.owner === ENEMY && p.prog >= 0)) {
      p.owner = null; onPointsChanged();
    }
    if (p.owner === PLAYER && foes && !you && p.prog < before) {
      radio(`The swarm is hitting relay ${p.name}!`, 'warn', { key: 'atk' + p.name, gap: 9, dropAt: p });
    }
    // visuals
    const col = pointColor(p);
    p.rim.material.color.setHex(col); p.flag.material.color.setHex(col); p.flag.material.emissive.setHex(col); p.disc.material.color.setHex(col); p.beam.visible = p.owner !== null; p.beam.material.uniforms.uColor.value.setHex(col).multiplyScalar(1.6);
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
  const all = playerPointCount() === points.length;
  if (all && enemyBase.shield) {
    enemyBase.shield = false; enemyBase.shieldMesh.visible = false;
    burst(enemyBase.x, 2, enemyBase.z, 5, 0xffa080);
    radio('All 3 relays are ours: the bio-shield is down! Hit the hive!', 'good');
    if (!tac.on) commandMove(playerUnits().filter(e => !e.possessed), enemyBase.x, enemyBase.z + 6, 'amove', true);
    toast('Shield down! Destroy the hive', 2.5);
  } else if (!all && !enemyBase.shield && !enemyBase.dead) {
    enemyBase.shield = true; enemyBase.shieldMesh.visible = true;
    radio('We lost a relay: the hive is shielded again', 'warn');
  }
}

function spawnPlayer(type) {
  const u = makeUnit(PLAYER, type, (Math.random() - 0.5) * 3, 21.5);
  if (tac.on) { u.x = (Math.random() - 0.5) * 6; u.z = 19 + Math.random(); return u; } // ready to be ordered
  commandMove([u], (Math.random() - 0.5) * 8, 17 - Math.random() * 2, 'move', true);
  return u;
}

function buy(type) {
  if (mode !== 'rts' || (tac.on && tac.phase !== 'plan')) return;
  if (TOWERS.includes(type)) {
    if (!tac.on) return;
    if (game.cp < COSTS[type]) { toast(`${NAMES[PLAYER][type]} costs ${COSTS[type]} ore`, 1); return; }
    setTool('place:' + type); return;
  }
  if (countUnits(PLAYER) >= PLAYER_CAP) { toast('The squad is full', 1); return; }
  if (game.cp < COSTS[type]) { toast(`${NAMES[PLAYER][type]} costs ${COSTS[type]} ore`, 1); return; }
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
      if (spawned.length) radio(`Swarm wave ${waveNum} is heading for relay ${pt.name}`, 'warn', { dropAt: pt });
    }
    eliteTimer -= dt;
    const eliteAlive = entities.some(e => e.elite && !e.dead);
    if (!eliteAlive && eliteTimer <= 5 && !eliteWarned) { eliteWarned = true; radio('The Hive Tyrant emerges in 5s!', 'warn'); }
    if (eliteTimer <= 0) {
      eliteTimer = 90; eliteWarned = false;
      if (!eliteAlive) {
        const e = makeUnit(ENEMY, 'elite', 0, -20);
        e.order = { type: 'amove', x: 0, z: 0 };
        radio('The Hive Tyrant is out. It hunts YOUR marine!', 'warn', { dropAt: { x: 0, z: 0 } });
      }
    }
    enemyBase.shieldMesh.material.opacity = 0.13 + Math.sin(game.time * 3) * 0.04;
  }
  for (const b of [playerBase, enemyBase]) if (!b.dead) { b.beacon.position.y = 4.9 + Math.sin(game.time * 2.5) * 0.15; if (b.dish) b.dish.rotation.z = game.time * 0.8; }
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
    if (g.pos.y <= 0.15 || inBox || g.t > 3) {
      scene.remove(g.mesh);
      explode(g.pos.x, g.pos.z, g.r || 3.4, g.dmg || 60, g.src);
      grenades.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- FPS control
const viewmodel = new THREE.Group();
// first-person weapons: one model per kit, built from simple parts but with real gun anatomy
// (receiver, rail, handguard, barrel, muzzle brake, magazine, stock, optic) and an armoured glove + sleeve holding it
{
  const metal = toon({ color: 0x4a515b, roughness: 0.32, metalness: 0.6 });
  const poly = toon({ color: 0x2c3036, roughness: 0.62, metalness: 0.1 });       // polymer furniture
  const paint = toon({ color: 0x7d7a62, roughness: 0.55, metalness: 0.25 });     // olive panels
  const edge = toon({ color: 0x8c949e, roughness: 0.28, metalness: 0.65 });      // worn bright edges
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.6, 2.6) }); // energy strip and coils
  const lens = new THREE.MeshStandardMaterial({ color: 0x0b1820, emissive: 0xff4a3a, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.4 });
  const sleeve = toon({ color: 0x6b7a66, roughness: 0.5, metalness: 0.45 });     // tinted to the marine's armour on possess
  const glove = toon({ color: 0x23262b, roughness: 0.75, metalness: 0.05 });
  const box = (g, mat, w, h, d, x, y, z, rx = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const tube = (g, mat, r1, r2, len, x, y, z, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  const ring = (g, mat, r, t, x, y, z) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 18), mat); m.position.set(x, y, z); g.add(m); return m; };
  const hands = (g, gripZ, foreZ, foreY) => {
    box(g, glove, 0.07, 0.075, 0.085, 0.004, -0.085, gripZ + 0.01);                       // right hand on the grip
    box(g, glove, 0.02, 0.03, 0.06, -0.03, -0.045, gripZ - 0.035);                         // trigger finger
    const s1 = tube(g, sleeve, 0.05, 0.058, 0.32, 0.03, -0.14, gripZ + 0.2, 10); s1.rotation.x = Math.PI / 2 - 0.55; // forearm armour
    ring(g, edge, 0.052, 0.008, 0.02, -0.11, gripZ + 0.1).rotation.x = Math.PI / 2 - 0.55;
    box(g, glove, 0.075, 0.06, 0.1, -0.012, foreY - 0.045, foreZ);                         // left hand under the handguard
    const s2 = tube(g, sleeve, 0.048, 0.056, 0.36, -0.13, foreY - 0.13, foreZ + 0.12, 10); s2.rotation.set(Math.PI / 2 - 0.6, 0, -0.75);
  };
  const strip = (g, len, z, y = 0.01) => { box(g, glow, 0.004, 0.01, len, 0.043, y, z); box(g, glow, 0.004, 0.01, len, -0.043, y, z); };
  const kits = {};
  { // Marine: compact pulse rifle with a red-dot sight
    const g = new THREE.Group();
    box(g, metal, 0.08, 0.1, 0.34, 0, 0, -0.12);                 // receiver
    box(g, paint, 0.084, 0.05, 0.2, 0, -0.01, -0.14);            // side panels
    box(g, edge, 0.04, 0.012, 0.36, 0, 0.056, -0.16);            // top rail
    for (let k = 0; k < 7; k++) box(g, metal, 0.046, 0.008, 0.012, 0, 0.066, -0.03 - k * 0.042);
    box(g, poly, 0.074, 0.08, 0.24, 0, -0.005, -0.4);           // handguard
    for (let k = 0; k < 4; k++) { box(g, glow, 0.078, 0.012, 0.03, 0, 0.006, -0.32 - k * 0.055); }
    tube(g, metal, 0.016, 0.016, 0.16, 0, 0.005, -0.58);         // barrel
    tube(g, edge, 0.026, 0.024, 0.06, 0, 0.005, -0.67, 8);       // muzzle brake
    box(g, poly, 0.05, 0.15, 0.075, 0, -0.11, -0.2, 0.22);        // magazine
    box(g, glow, 0.052, 0.012, 0.02, 0, -0.16, -0.215, 0.22);     // ammo counter
    box(g, poly, 0.045, 0.1, 0.05, 0, -0.08, 0.0, -0.3);          // grip
    box(g, poly, 0.06, 0.085, 0.16, 0, -0.01, 0.12);              // stock
    box(g, glove, 0.065, 0.1, 0.03, 0, -0.01, 0.205);             // butt pad
    box(g, metal, 0.05, 0.05, 0.09, 0, 0.1, -0.1);                // optic housing
    const l = tube(g, lens, 0.02, 0.02, 0.005, 0, 0.1, -0.147, 14); l.rotation.x = Math.PI / 2;
    strip(g, 0.2, -0.13);
    hands(g, 0.0, -0.4, -0.005);
    kits.trooper = { g, muzzle: -0.71 };
  }
  { // Juggernaut: a heavy tri-barrel plasma cannon with glowing coils and a power cell
    const g = new THREE.Group();
    box(g, metal, 0.13, 0.13, 0.42, 0, 0, -0.16);
    box(g, paint, 0.136, 0.07, 0.26, 0, 0.02, -0.17);
    box(g, edge, 0.06, 0.014, 0.3, 0, 0.073, -0.16);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + Math.PI / 2;
      tube(g, metal, 0.022, 0.022, 0.32, Math.cos(a) * 0.035, Math.sin(a) * 0.035 + 0.005, -0.5, 10);
    }
    for (let k = 0; k < 3; k++) ring(g, glow, 0.066, 0.009, 0, 0.005, -0.42 - k * 0.07);
    tube(g, edge, 0.07, 0.065, 0.05, 0, 0.005, -0.66, 14);
    const cell = tube(g, poly, 0.045, 0.045, 0.22, 0.095, -0.03, -0.12, 12);
    ring(g, glow, 0.047, 0.006, 0.095, -0.03, -0.06); ring(g, glow, 0.047, 0.006, 0.095, -0.03, -0.18); cell.userData.cell = true;
    box(g, poly, 0.05, 0.1, 0.06, 0, -0.1, 0.0, -0.25);
    box(g, poly, 0.07, 0.04, 0.12, 0, -0.085, -0.26);              // fore handle
    box(g, metal, 0.11, 0.1, 0.12, 0, -0.005, 0.1);
    strip(g, 0.3, -0.16, 0.035);
    hands(g, 0.0, -0.26, -0.06);
    kits.heavy = { g, muzzle: -0.7 };
  }
  { // Ranger: a long rail rifle with a big scope and a folding bipod
    const g = new THREE.Group();
    box(g, metal, 0.064, 0.085, 0.36, 0, 0, -0.12);
    box(g, paint, 0.068, 0.04, 0.22, 0, -0.012, -0.12);
    box(g, poly, 0.06, 0.07, 0.26, 0, -0.005, -0.42);
    for (let k = 0; k < 5; k++) box(g, glow, 0.064, 0.008, 0.024, 0, 0.012, -0.33 - k * 0.045);
    tube(g, metal, 0.014, 0.017, 0.4, 0, 0.0, -0.74, 10);         // long barrel
    tube(g, edge, 0.022, 0.022, 0.08, 0, 0.0, -0.96, 8);           // suppressor-ish brake
    tube(g, metal, 0.03, 0.03, 0.24, 0, 0.1, -0.14, 14);           // scope tube
    tube(g, metal, 0.04, 0.03, 0.05, 0, 0.1, -0.28, 14);           // objective bell
    tube(g, metal, 0.036, 0.03, 0.04, 0, 0.1, -0.005, 14);         // eyepiece
    const l = tube(g, lens, 0.034, 0.034, 0.004, 0, 0.1, -0.307, 14); lens.emissive.setHex(0xff4a3a);
    box(g, metal, 0.02, 0.05, 0.03, 0, 0.06, -0.08); box(g, metal, 0.02, 0.05, 0.03, 0, 0.06, -0.2); // rings
    box(g, poly, 0.04, 0.1, 0.045, 0, -0.08, 0.0, -0.3);
    box(g, poly, 0.045, 0.1, 0.06, 0, -0.1, -0.16, 0.15);
    const st = box(g, poly, 0.05, 0.03, 0.2, 0, 0.02, 0.15); box(g, poly, 0.05, 0.03, 0.18, 0, -0.06, 0.15, 0.25); box(g, glove, 0.055, 0.12, 0.03, 0, -0.02, 0.255);
    box(g, edge, 0.012, 0.012, 0.16, 0.02, -0.05, -0.5); box(g, edge, 0.012, 0.012, 0.16, -0.02, -0.05, -0.5); // folded bipod
    strip(g, 0.18, -0.12);
    hands(g, 0.0, -0.42, -0.01);
    kits.sniper = { g, muzzle: -1.0 };
  }
  for (const k in kits) { kits[k].g.visible = false; viewmodel.add(kits[k].g); }
  viewmodel.userData.kits = kits;
  viewmodel.userData.wing = { material: sleeve };
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.71); viewmodel.add(muzzle);
  viewmodel.userData.muzzle = muzzle;
  const flash = new THREE.Group();
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 3.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let k = 0; k < 3; k++) { // a star of crossed quads
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), flashMat); q.rotation.z = k * Math.PI / 3; flash.add(q);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  flash.add(core);
  flash.position.set(0, 0.005, -0.75); flash.visible = false; viewmodel.add(flash);
  viewmodel.userData.flash = flash;
  // a soft fill light that only reaches the gun, so it never turns into a black silhouette against the sky
  const fill = new THREE.PointLight(0xdfe8ff, 0.12, 1.2, 2); fill.position.set(-0.1, 0.25, 0.1); viewmodel.add(fill);
  viewmodel.position.set(0.22, -0.22, -0.35);
  viewmodel.scale.setScalar(0.8);
  viewmodel.visible = false;
  viewmodel.traverse(noRay);
  camera.add(viewmodel);
}
function setViewGun(type) {
  const kits = viewmodel.userData.kits, kit = kits[type] || kits.trooper;
  for (const k in kits) kits[k].g.visible = kits[k] === kit;
  viewmodel.userData.muzzle.position.z = kit.muzzle;
  viewmodel.userData.flash.position.z = kit.muzzle - 0.04;
}


const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();

function possess(u) {
  if (!u || u.dead || u.isBase || u.isTower || u.team !== PLAYER) return;
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
  fps.vx = fps.vz = fps.recoil = fps.bloom = fps.vy = 0; fps.dash = null; u.y = 0; fps.lastYaw = fps.yaw; fps.lastPitch = fps.pitch;
  viewmodel.userData.wing.material.color.copy(u.bodyMat.color).multiplyScalar(0.7);
  setViewGun(u.type);
  if (!selection.includes(u)) selection.push(u);
  game.slowmo = swap ? 0.6 : 1.3;
  setMode('fps', swap ? 3 : 9);
  sfx('whoosh');
  if (!isTouch && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  toast(`You are a ${nameOf(u)} · Q ${KITS[u.type][0].name} · E ${KITS[u.type][1].name} · X ultimate`, 1.6);
  sfx('quack');
}

function dropInNear(x, z) {
  const mine = playerUnits();
  if (!mine.length) { toast('No marines left', 1); return; }
  mine.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  possess(mine[0]);
}

function exitFPS() {
  if (possessed) {
    if (possessed.y > 0) { possessed.y = 0; resolveCollision(possessed); } // the AI can't stand on bales
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
  if (mine.length < 2) { toast('No other marines', 1); return; }
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
  radio(`${squad.length} marines moving to where you aimed`, 'good');
}

function setScoped(on) {
  fps.scoped = on;
  document.body.classList.toggle('scoped', on);
  viewmodel.visible = mode === 'fps' && !on;
}

// ---------------------------------------------------------------- hero kits: 2 abilities + an ultimate per bird
let ultDamage = false; // ultimates don't charge themselves
const KITS = {
  trooper: [{ name: 'Frag grenade', cd: 6 }, { name: 'Combat roll', cd: 5 }, { name: 'Drone swarm' }],
  heavy: [{ name: 'Energy wall', cd: 12 }, { name: 'Shield charge', cd: 8 }, { name: 'Shockwave' }],
  sniper: [{ name: 'Scope', cd: 0 }, { name: 'Jump jet', cd: 6 }, { name: 'Recon scan' }],
  elite: [{ name: '' }, { name: '' }, { name: '' }],
};
function chargeUlt(u, amt) {
  if (!u || u.team !== PLAYER) return;
  const before = u.ult || 0;
  u.ult = Math.min(100, before + amt);
  if (before < 100 && u.ult >= 100 && u.possessed) { toast(`Ultimate ready: ${KITS[u.type][2].name} (X)`, 1.2); sfx('chime'); }
}
const fwdVec = () => new THREE.Vector3(-Math.sin(fps.yaw), 0, -Math.cos(fps.yaw));
const hensNear = (x, z, r) => entities.filter(e => !e.dead && !e.isBase && e.team === ENEMY && Math.hypot(e.x - x, e.z - z) < r);

function useAbility(slot = 0) {
  const u = possessed;
  if (!u) return;
  const kit = KITS[u.type];
  if (u.type === 'sniper' && slot === 0) { setScoped(!fps.scoped); return; }
  u.cds = u.cds || [0, 0];
  if (u.cds[slot] > 0) { toast(`${kit[slot].name} ready in ${Math.ceil(u.cds[slot])}s`, 0.8); return; }
  u.cds[slot] = kit[slot].cd;
  const f = fwdVec();
  if (u.type === 'trooper' && slot === 0) {
    camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone().addScaledVector(dir, 0.6);
    const mesh = noRay(new THREE.Mesh(sphere, grenadeMat)); mesh.scale.set(0.1, 0.13, 0.1);
    scene.add(mesh);
    grenades.push({ pos, vel: dir.multiplyScalar(15).add(new THREE.Vector3(0, 4, 0)), t: 0, mesh, src: u });
  } else if (u.type === 'trooper' && slot === 1) { // dive roll: quick dash you can't be hit during
    const mv = Math.hypot(fps.vx, fps.vz) > 0.5 ? new THREE.Vector3(fps.vx, 0, fps.vz).normalize() : f;
    fps.dash = { t: 0.32, vx: mv.x * 19, vz: mv.z * 19, roll: true };
    u.invulnT = 0.4; sfx('whoosh');
  } else if (u.type === 'heavy' && slot === 0) { // wing wall
    wall.active = true; wall.t = 6; wall.hp = 450; wall.owner = u;
    wall.mesh.visible = true; sfx('honk'); toast('Energy wall up: it blocks swarm fire', 1);
  } else if (u.type === 'heavy' && slot === 1) { // charge
    fps.dash = { t: 0.5, vx: f.x * 17, vz: f.z * 17, charge: true, hitList: [] };
    u.invulnT = 0; sfx('honk');
  } else if (u.type === 'sniper' && slot === 1) { // stilt jump
    if ((u.y || 0) > fps.floor + 0.05) { u.cds[slot] = 0; return; }
    fps.vy = 10.5; setScoped(false); sfx('whoosh');
  }
}

function useUlt() {
  const u = possessed;
  if (!u || u.type === 'elite') return;
  if ((u.ult || 0) < 100) { toast(`Ultimate ${Math.floor(u.ult || 0)}%: deal damage and hold relays`, 0.9); return; }
  u.ult = 0;
  fps.shake = 0.3;
  if (u.type === 'trooper') { // duckling swarm
    for (let i = 0; i < 5; i++) spawnDuckling(u, i);
    toast('Drone swarm!', 1.2); sfx('quack'); setTimeout(() => sfx('quack'), 150);
  } else if (u.type === 'heavy') { // the HONK: stun every hen in a cone in front of you
    const f = fwdVec();
    let n = 0;
    for (const e of entities) {
      if (e.dead || e.isBase || e.team !== ENEMY) continue;
      const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz);
      if (d > 14 || (dx * f.x + dz * f.z) / (d || 1) < 0.5) continue;
      e.stunT = 3; ultDamage = true; damage(e, 20, u); ultDamage = false; n++;
      e.x += dx / (d || 1) * 1.5; e.z += dz / (d || 1) * 1.5;
    }
    for (let k = 0; k < 3; k++) setTimeout(() => ping(u.x + f.x * 3 * (k + 1), u.z + f.z * 3 * (k + 1), 0xfff6e0, 2 + k * 1.5, 0.6), k * 90);
    sfx('honk'); setTimeout(() => sfx('honk'), 120);
    toast(n ? `Shockwave! ${n} aliens stunned` : 'Shockwave!', 1.2);
  } else if (u.type === 'sniper') { // hawk eye
    hawk.t = 8; toast('Recon scan: aliens marked, shots pierce walls', 1.4); sfx('chime');
  }
}

// goose wing wall: a feathery barrier that follows the goose
const wall = { active: false, t: 0, hp: 0, owner: null, mesh: null };
{
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 2.4), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const panel = noRay(new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), m)); panel.position.y = 1.1;
  const rim = noRay(new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x9fd8ff })));
  rim.position.y = 2.2;
  g.add(panel, rim);
  for (let k = -3; k <= 3; k++) { const bar = noRay(new THREE.Mesh(featherGeoW(), m)); bar.position.set(k * 0.42, 1.1, 0.01); bar.scale.set(0.1, 3.6, 1); g.add(bar); }
  g.visible = false; scene.add(g); wall.mesh = g;
}
function featherGeoW() { return new THREE.PlaneGeometry(0.3, 0.6); }
function wallEnds() {
  const u = wall.owner, f = fwdVec();
  const cx = u.x + f.x * 1.3, cz = u.z + f.z * 1.3, rx = -f.z, rz = f.x;
  return [cx - rx * 1.5, cz - rz * 1.5, cx + rx * 1.5, cz + rz * 1.5, cx, cz];
}
function wallBlocks(ax, az, bx, bz) {
  if (!wall.owner || wall.owner.dead) return null;
  const [x1, z1, x2, z2] = wallEnds();
  const d = (bx - ax) * (z2 - z1) - (bz - az) * (x2 - x1);
  if (Math.abs(d) < 1e-6) return null;
  const t = ((x1 - ax) * (z2 - z1) - (z1 - az) * (x2 - x1)) / d;
  const v = ((x1 - ax) * (bz - az) - (z1 - az) * (bx - ax)) / d;
  return t > 0 && t < 1 && v >= 0 && v <= 1 ? { x: ax + (bx - ax) * t, z: az + (bz - az) * t } : null;
}
function updateWall(dt) {
  if (!wall.active) return;
  wall.t -= dt;
  if (wall.t <= 0 || wall.hp <= 0 || !wall.owner || wall.owner.dead || !wall.owner.possessed) {
    if (wall.hp <= 0) { feathers(wall.mesh.position.x, wall.mesh.position.z, 0x9fd8ff, 16); toast('Energy wall down', 0.8); }
    wall.active = false; wall.mesh.visible = false; return;
  }
  const [, , , , cx, cz] = wallEnds();
  wall.mesh.position.set(cx, wall.owner.y || 0, cz);
  wall.mesh.rotation.y = fps.yaw;
  wall.mesh.children[0].material.opacity = 0.08 + 0.17 * Math.max(0, wall.hp / 450);
}

// heron hawk eye
const hawk = { t: 0 };

// duckling swarm: tiny ducks that run at the nearest hen and pop
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a30, emissive: 0xff5a20, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.5 });
const ducklings = []; // drone swarm
function spawnDuckling(u, i) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(sphere, darkMat); body.scale.set(0.22, 0.12, 0.22); body.position.y = 0.6;
  const eye = new THREE.Mesh(sphere, visorMat); eye.scale.setScalar(0.08); eye.position.set(0, 0.6, -0.2);
  const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3) })); rotor.rotation.x = Math.PI / 2; rotor.position.y = 0.7;
  g.add(body, eye, rotor); g.traverse(noRay);
  const a = (i - 2) * 0.35 + fps.yaw;
  const d = { mesh: g, x: u.x - Math.sin(a) * 1.2, z: u.z - Math.cos(a) * 1.2, radius: 0.25, life: 7, src: u, hop: Math.random() * 6 };
  g.position.set(d.x, 0, d.z); scene.add(g);
  ducklings.push(d);
}
function updateDucklings(dt) {
  for (let i = ducklings.length - 1; i >= 0; i--) {
    const d = ducklings[i];
    d.life -= dt; d.hop += dt * 14;
    let best = null, bd = 30;
    for (const e of entities) if (!e.dead && e.team === ENEMY && !e.isBase) { const dd = Math.hypot(e.x - d.x, e.z - d.z); if (dd < bd) { bd = dd; best = e; } }
    if (best) {
      const dx = best.x - d.x, dz = best.z - d.z, l = Math.hypot(dx, dz) || 1;
      d.x += dx / l * 7.5 * dt; d.z += dz / l * 7.5 * dt;
      d.mesh.rotation.y = Math.atan2(-dx, -dz);
      resolveCollision(d);
    }
    d.mesh.position.set(d.x, 0.3 + Math.sin(d.hop * 0.5) * 0.12, d.z);
    if ((best && bd < 1.1) || d.life <= 0) {
      ultDamage = true; explode(d.x, d.z, 2.6, 45, d.src); ultDamage = false;
      feathers(d.x, d.z, 0x8a9098, 6);
      scene.remove(d.mesh); ducklings.splice(i, 1);
    }
  }
}

function playerShoot(u) {
  const gun = GUNS[u.type];
  u.cool += gun.rate; if (u.cool < 0) u.cool = 0; // keeps the fire rate exact at any frame rate
  camera.updateMatrixWorld(true);
  const targets = (hawk.t > 0 ? [ground] : staticShootables).concat(entities.filter(e => !e.dead && !e.possessed).map(e => e.mesh));
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
      if (enemy.dead) { killed = true; chargeUlt(u, 10); }
      hits++;
      if (!enemy.isBase && !enemy.dead) { // knockback
        const k = Math.min(0.35, dmg * 0.012);
        enemy.x += raycaster.ray.direction.x * k; enemy.z += raycaster.ray.direction.z * k;
      }
    }
    // the bullet you see; impact effects when it lands
    const surf = !hit ? null : enemy ? (enemy.isBase ? 0xffe6a0 : 'feather') : hit.object === ground ? 0x8a5a3c : 0x9aa0a8;
    const team = enemy && !enemy.isBase ? enemy.team : null;
    shootBullet(mz, end, 'corn', gun.speed, surf === null ? null : () => {
      if (surf === 'feather') { feathers(end.x, end.z, team === ENEMY ? 0x7aff3a : 0x8a9098, 2); burst(end.x, end.y, end.z, 0.25, team === ENEMY ? 0x9cff3a : 0xffd0a0); }
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
  if (fps.dash) {
    const dsh = fps.dash;
    dsh.t -= simDt;
    u.x += dsh.vx * simDt; u.z += dsh.vz * simDt;
    if (dsh.charge) { // bowl hens over
      for (const e of hensNear(u.x, u.z, 1.6)) {
        if (dsh.hitList.includes(e)) continue;
        dsh.hitList.push(e);
        const l = Math.hypot(e.x - u.x, e.z - u.z) || 1;
        e.x += (e.x - u.x) / l * 3; e.z += (e.z - u.z) / l * 3; e.stunT = 1.2;
        damage(e, 25, u); fps.shake = 0.25; sfx('hit'); feathers(e.x, e.z, 0x7aff3a, 5);
      }
    }
    if (dsh.t <= 0) fps.dash = null;
  } else {
    u.x += fps.vx * simDt;
    u.z += fps.vz * simDt;
  }
  // height: jumping, standing on hay bales and sheds, falling off them
  let floor = 0;
  for (const b of boxes) if (b.h !== undefined && (u.y || 0) >= b.h - 0.35 && u.x > b.minX - 0.2 && u.x < b.maxX + 0.2 && u.z > b.minZ - 0.2 && u.z < b.maxZ + 0.2) floor = Math.max(floor, b.h);
  fps.floor = floor;
  fps.vy = (fps.vy || 0) - 24 * simDt;
  u.y = (u.y || 0) + fps.vy * simDt;
  if (u.y <= floor) { if (fps.vy < -6) { fps.shake = 0.12; fps.vmKick = 1; } u.y = floor; fps.vy = 0; }
  for (const cd of [0, 1]) if (u.cds && u.cds[cd] > 0) u.cds[cd] -= simDt;
  chargeUlt(u, simDt * 1.2 + (points.some(p => p.capturing) ? simDt * 4 : 0));
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
  const roll = fps.dash && fps.dash.roll ? Math.sin((0.32 - fps.dash.t) / 0.32 * Math.PI) : 0;
  return { pos: new THREE.Vector3(u.x + (Math.random() - 0.5) * sh * 0.05, (u.y || 0) + EYE + bob - roll * 0.7, u.z), quat: new THREE.Quaternion().setFromEuler(euler), fov: fps.scoped ? 22 : 72 };
}

function setMode(m, arc = 0) {
  const prev = mode;
  mode = m;
  document.body.classList.toggle('fps', m === 'fps');
  viewmodel.visible = m === 'fps' && !fps.scoped;
  amoveArmed = false;
  const tag = $('modeTag');
  tag.innerHTML = m === 'fps' ? '<b>MARINE</b> hold relays · fight' : '<b>COMMANDER</b> move the squad · deploy';
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
  viewmodel.scale.setScalar(portrait ? 0.42 : 0.5);
  viewmodel.position.set(
    (portrait ? 0.09 : 0.17) + fps.swayX + Math.cos(fps.bob * 0.5) * 0.012 * walk,
    (portrait ? -0.12 : -0.17) + fps.swayY - Math.abs(Math.sin(fps.bob * 0.5)) * 0.014 * walk - fps.vmKick * 0.012,
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
let orderDrag = null;        // {x,y} while dragging a move order out of a bird
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
  if (mode === 'rts' && (e.button === 0 || e.pointerType === 'touch') && pointers.size === 1) {
    const ent = pickEntity(e.clientX, e.clientY);
    if (ent && ent.team === PLAYER && !ent.isBase && !ent.isTower) p.unit = ent; // dragging from a bird gives it a move order
  }
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
    else if (e.button === 2 && possessed) useAbility(possessed.type === 'sniper' ? 0 : 1);
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
    if (p.unit && !p.unit.dead) {
      if (!orderDrag) { if (!selection.includes(p.unit)) { selection = [p.unit]; updateButtons(); } }
      orderDrag = { x: p.x, y: p.y };
    } else boxSel = { x0: p.sx, y0: p.sy, x1: p.x, y1: p.y };
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (mode === 'fps') { if (e.pointerType === 'mouse' && e.button === 0) fps.firing = false; return; } // a lifted look finger must not stop the FIRE button
  if (!p || mode !== 'rts') return;
  if (gesture) { if (pointers.size === 0) gesture = null; return; }
  if (e.type === 'pointercancel') { boxSel = null; return; }
  if (orderDrag) { orderDrag = null; dragOrder(p.x, p.y); return; }
  if (e.type === 'pointercancel') orderDrag = null;
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
      else if (e.code === 'Digit1') buy('trooper');
      else if (e.code === 'Digit2') buy('heavy');
      else if (e.code === 'Digit3') buy('sniper');
      else if (e.code === 'Digit4') buy('turret');
      else if (e.code === 'Digit5') buy('mortar');
      else if (e.code === 'Digit6') buy('scarecrow');
      else if (e.code === 'KeyU') upgradeSelected();
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
    else if (e.code === 'KeyC') swapUnit();
    else if (e.code === 'KeyQ') useAbility(0);
    else if (e.code === 'KeyE') useAbility(1);
    else if (e.code === 'KeyX') useUlt();
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
tapButton($('btnAbility'), () => useAbility(0));
tapButton($('btnAbility2'), () => useAbility(1));
tapButton($('btnUlt'), useUlt);
tapButton($('btnBuyTrooper'), () => buy('trooper'));
tapButton($('btnBuyHeavy'), () => buy('heavy'));
tapButton($('btnBuySniper'), () => buy('sniper'));
tapButton($('btnStart'), startGame);
tapButton($('btnStartTac'), startTactics);
tapButton($('btnGfx'), () => { gfx.auto = false; setFancy(!gfx.fancy); });
setFancy(gfx.fancy, null, false);
tapButton($('btnHold'), holdSelected);
tapButton($('btnBomb'), () => setTool(tac.tool === 'bomb' ? 'move' : 'bomb'));
tapButton($('btnHero'), heroFromSelection);
tapButton($('btnGo'), goLive);
tapButton($('btnUpgrade'), upgradeSelected);
for (const ty of TOWERS) tapButton($('btnBuy_' + ty), () => buy(ty));
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
  $('selInfo').textContent = sel.length ? `${sel.length} selected · ${Object.entries(counts).map(([t, n]) => `${n} ${NAMES[PLAYER][t].toLowerCase()}`).join(', ')}` : 'No marines selected';
  renderPortraits(sel);
  $('btnAMove').classList.toggle('armed', amoveArmed);
}

// unit card: one portrait per selected bird with health, level and hero star. Tap one to pick just that bird.
const ICONS = { trooper: '🪖', heavy: '🛡️', sniper: '🎯', turret: '🔫', mortar: '💥', scarecrow: '🌀' };
let portraitUnits = [];
function renderPortraits(sel) {
  const box = $('portraits'); if (!box) return;
  portraitUnits = sel.slice(0, 24);
  box.innerHTML = portraitUnits.map((u, i) => `<button class="pt${u === tac.hero ? ' hero' : ''}" data-i="${i}" title="${nameOf(u)}"><i>${ICONS[u.type] || '🐤'}</i>${(u.lvl || 1) > 1 ? `<b>${'★'.repeat(u.lvl - 1)}</b>` : ''}<em><s style="width:${Math.round(Math.max(0, u.hp / u.maxHp) * 100)}%"></s></em></button>`).join('')
    + (sel.length > 24 ? `<span class="more">+${sel.length - 24}</span>` : '');
  document.body.classList.toggle('hasSel', sel.length > 0);
}
function refreshPortraitHp() {
  const box = $('portraits'); if (!box) return;
  box.querySelectorAll('.pt').forEach(el => {
    const u = portraitUnits[+el.dataset.i]; if (!u) return;
    const bar = el.querySelector('s'), k = Math.max(0, u.hp / u.maxHp);
    bar.style.width = `${Math.round(k * 100)}%`; bar.className = k < 0.35 ? 'low' : '';
    el.classList.toggle('dead', u.dead);
  });
}
$('portraits').addEventListener('pointerdown', e => {
  const el = e.target.closest('.pt'); if (!el) return;
  e.stopPropagation();
  const u = portraitUnits[+el.dataset.i]; if (!u || u.dead) return;
  const now = performance.now();
  if (selection.length === 1 && selection[0] === u && now - (renderPortraits.lastT || 0) < 400) { rts.focus.set(u.x, 0, u.z); }
  renderPortraits.lastT = now;
  selection = [u]; rts.focus.set(u.x, 0, u.z); updateButtons();
});

// top bar: corn, nests, timers and both bases as chips (refreshed a few times a second)
let topbarT = 0;
function renderTopbar(dt) {
  topbarT -= dt; if (topbarT > 0) return; topbarT = 0.25;
  const pb = Math.max(0, playerBase.hp / playerBase.maxHp), eb = Math.max(0, enemyBase.hp / enemyBase.maxHp);
  const nest = p => `<span class="nest ${p.owner === PLAYER ? 'mine' : p.owner === ENEMY ? 'theirs' : ''}${p.contested ? ' fight' : ''}">${p.name}</span>`;
  const bar = (label, k, cls, extra = '') => `<span class="base ${cls}"><b>${label}</b><em><s style="width:${Math.round(k * 100)}%"></s></em>${extra}</span>`;
  const timer = tac.on ? `<span class="chip">👾 ${countUnits(ENEMY)} vs 🪖 ${countUnits(PLAYER)}</span>` : `<span class="chip">👾 wave in ${Math.ceil(waveTimer)}s</span>`;
  $('status').innerHTML = `<span class="nests">${points.map(nest).join('')}</span>${bar('Outpost', pb, 'ours')}${bar('Hive', eb, 'enemy', enemyBase.shield ? '<i title="Bio-shield: hold all 3 relays">🛡</i>' : '<i title="Cracked!">💥</i>')}${timer}`;
}

const setLabel = (id, text) => { const b = $(id), sp = b && b.querySelector('span'); if (sp) sp.textContent = text; else if (b) b.textContent = text; };
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
  if (tactics) {
    toast(isTouch ? 'Drag from a marine to plan its move, then Go' : 'Drag from a marine (or right-click) to plan, then Go (Space)', 3.5);
    setTimeout(() => radio('Hold all 3 relays to drop the hive\'s bio-shield, then destroy it. Build turrets to guard the outpost.', 'good'), 1500);
    return;
  }
  toast(isTouch ? 'Double-tap a marine to take control' : 'Double-click a marine (or press F) to take control', 3);
  setTimeout(() => radio('Only YOU can capture a relay: drop into a marine and stand on relay B', 'good', { dropAt: points[1] }), 1200);
}

function endGame(won, text) {
  if (mode === 'over') return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (possessed) { possessed.possessed = false; possessed.mesh.visible = true; possessed = null; }
  setMode('over');
  document.body.classList.remove('fps', 'scoped');
  $('overTitle').textContent = won ? 'Hive destroyed!' : 'Outpost overrun.';
  $('overText').textContent = text || (won ? `The hive burned after ${waveNum} waves. The colony is safe.` : `The swarm overran the outpost during wave ${waveNum}.`);
  setTimeout(() => $('over').classList.remove('hidden'), 900);
}

// ---------------------------------------------------------------- tactics mode
const planGrid = new THREE.GridHelper(N, N / 2, 0xffffff, 0xffffff);
planGrid.material.transparent = true; planGrid.material.opacity = 0.16; planGrid.position.y = 0.04; planGrid.visible = false;
scene.add(planGrid);

const canPlace = (x, z) => z >= 4 && z <= 24 && Math.abs(x) <= 27 && isFree(toCell(x), toCell(z))
  && !entities.some(e => !e.dead && Math.hypot(e.x - x, e.z - z) < (e.isBase ? 4.5 : 1.6))
  && !points.some(p => Math.hypot(p.x - x, p.z - z) < POINT_R + 0.5);
function placeTower(type, x, z) {
  if (game.cp < COSTS[type]) { toast(`${NAMES[PLAYER][type]} costs ${COSTS[type]} ore`, 1); return false; }
  x = Math.round(x * 2) / 2; z = Math.round(z * 2) / 2;
  if (!canPlace(x, z)) { toast('Build on open ground on your side of the farm', 1.2); return false; }
  game.cp -= COSTS[type];
  const t = makeTower(type, x, z);
  t.facing = Math.PI * 0; ping(x, z, 0x5dff9a, 1.6); sfx('chime');
  return true;
}
const upgradeCost = u => 25 * (u.lvl || 1);
function upgradeSelected() {
  if (!tac.on || tac.phase !== 'plan') return;
  const sel = liveSelection().filter(u => (u.lvl || 1) < 3);
  if (!sel.length) { toast(liveSelection().length ? 'Already at max level' : 'Select marines or turrets to upgrade', 1.2); return; }
  let done = 0;
  for (const u of sel) {
    const c = upgradeCost(u);
    if (game.cp < c) break;
    game.cp -= c; done++;
    u.lvl = (u.lvl || 1) + 1;
    u.maxHp = Math.round(u.maxHp * 1.3); u.hp = u.maxHp;
    u.dmg *= 1.25; if (u.isTower) u.range += 1.5;
    u.mesh.scale.multiplyScalar(1.08);
    burst(u.x, 1, u.z, 1.4, 0xffd84a);
  }
  if (done) { sfx('chime'); toast(`Upgraded ${done} to ★${sel[0].lvl}`, 1); } else toast(`Upgrade costs ${upgradeCost(sel[0])} ore`, 1);
}

function startTactics() {
  tac.on = true;
  document.body.classList.add('tactics');
  // a smaller, fair fight: 6 birds vs 8 hens, no waves, no corn
  for (const e of entities) if (!e.isBase && e.team === ENEMY) { e.dead = true; scene.remove(e.mesh); }
  entities = entities.filter(e => !e.dead);
  const hens = [['trooper', -14, -17], ['trooper', 14, -17], ['trooper', -4, -15], ['trooper', 4, -15], ['heavy', -9, -19], ['heavy', 9, -19], ['sniper', -2, -20], ['sniper', 2, -20]];
  for (const [t, x, z] of hens) makeUnit(ENEMY, t, x, z);
  game.cp = 60;
  startGame(true);
  startPlan();
}

function startPlan() {
  if (mode === 'over') return;
  if (possessed) exitFPS();
  tac.phase = 'plan'; tac.round++;
  planGrid.visible = true;
  if (tac.round > 1) {
    // income, a breather for your birds, and a fresh hen wave from the coop
    const held = points.filter(p => p.owner === PLAYER).length;
    const income = 20 + 15 * held;
    game.cp = Math.min(CP_MAX, game.cp + income);
    for (const e of entities) if (!e.dead && e.team === PLAYER && !e.isBase) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25);
    const n = Math.min(2 + tac.round, ENEMY_CAP - countUnits(ENEMY));
    for (let i = 0; i < n; i++) {
      const type = i % 4 === 3 ? 'sniper' : i % 3 === 2 ? 'heavy' : 'trooper';
      const h = makeUnit(ENEMY, type, (Math.random() - 0.5) * 10, -20 - Math.random() * 2);
      if (tac.round >= 4) { h.maxHp = h.hp = Math.round(h.maxHp * (1 + (tac.round - 3) * 0.12)); }
    }
    if (tac.round % 5 === 0 && !entities.some(e => e.elite && !e.dead)) makeUnit(ENEMY, 'elite', 0, -20);
    radio(`+${income} ore (${held} relay${held === 1 ? '' : 's'} held) · ${n} new aliens${tac.round % 5 === 0 ? ' and the Hive Tyrant' : ''}`, 'good');
    if (!playerUnits().length && game.cp < COSTS.trooper) { endGame(false, `No marines left and no ore to deploy more, round ${tac.round}.`); return; }
  }
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
  planGrid.visible = false;
  document.body.classList.remove('plan'); document.body.classList.add('live');
  setTool('move');
  selection = []; updateButtons();
  if (tac.hero && !tac.hero.dead) possess(tac.hero);
}

function updateRound(dt) {
  if (tac.phase !== 'live') return;
  tac.t -= dt;
  if (tac.t > 0) return;
  startPlan(); // freeze: everything stops exactly where it is
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
    const towers = entities.filter(e => e.isTower && !e.dead);
    if (tac.round >= 3 && i % 4 === 3) { // raiders: go for a tower, or straight at the barn
      const t = towers.length ? near(towers) : playerBase;
      commandMove([h], t.x + (Math.random() - 0.5) * 2, t.z - 2, 'amove', true); return;
    }
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
  for (const ty of TOWERS) { const e = $('btnBuy_' + ty); if (e) e.classList.toggle('armed', t === 'place:' + ty); }
  if (t === 'bomb') toast(isTouch ? 'Tap where the grenade lands' : 'Click where the grenade lands', 1.2);
  if (t.startsWith('place:')) toast(`${isTouch ? 'Tap' : 'Click'} your side of the farm to build the ${NAMES[PLAYER][t.slice(6)]}`, 1.4);
}
function holdSelected() {
  if (tac.phase !== 'plan') return;
  const sel = liveSelection();
  if (!sel.length) { toast('Select marines first', 1); return; }
  for (const u of sel) { u.order = { type: 'idle' }; u.path = null; u.pathGoal = null; }
  toast(`${sel.length} holding position`, 0.8);
}
function heroFromSelection() {
  if (tac.phase !== 'plan') return;
  const sel = liveSelection();
  if (!sel.length) { toast('Select a marine to be your ★ hero', 1); return; }
  possess(sel[0]); // in plan phase this marks the hero
}

function tacticsTap(ent, gp, sel, { secondary, shift, touch }) {
  const planning = tac.phase === 'plan';
  if (planning && tac.tool.startsWith('place:') && !secondary) {
    const type = tac.tool.slice(6);
    if (gp && placeTower(type, gp.x, gp.z) && !shift) setTool('move');
    return;
  }
  sel = sel.filter(u => !u.isTower);
  const order = planning && (secondary || (touch && sel.length && !(ent && ent.team === PLAYER)) || tac.tool === 'bomb');
  if (order && sel.length) {
    if (tac.tool === 'bomb') {
      const ducks = sel.filter(u => u.type === 'trooper');
      if (!ducks.length) toast('Only marines carry grenades', 1.2);
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

function throwEgg(u, x, z) { lobEgg(u, x, z, 0.9); }
function lobEgg(u, x, z, T, r = 3.4, dmg = 60) {
  const y0 = 1.2;
  const pos = new THREE.Vector3(u.x, y0, u.z);
  const vel = new THREE.Vector3((x - u.x) / T, (0.15 - y0 + 0.5 * 20 * T * T) / T, (z - u.z) / T);
  const mesh = noRay(new THREE.Mesh(sphere, u.team === PLAYER ? grenadeMat : acidMat)); mesh.scale.set(0.14, 0.18, 0.14);
  scene.add(mesh);
  grenades.push({ pos, vel, t: 0, mesh, src: u, noBox: true, r, dmg, tx: x, tz: z });
  u.facing = facingFor(x - u.x, z - u.z);
}

function updateTacticsHud() {
  const tag = $('modeTag');
  if (tac.phase === 'plan') { tag.innerHTML = `<b>PLAN</b> round ${tac.round} · battle frozen`; tag.className = 'plan'; }
  else { tag.innerHTML = `<b>LIVE</b> ${Math.max(0, Math.ceil(tac.t))}s left${mode === 'fps' ? ' · you are the ★ hero' : ''}`; tag.className = 'op'; }
  const sel = liveSelection().filter(u => (u.lvl || 1) < 3);
  setLabel('btnUpgrade', sel.length ? `Upgrade · ${sel.reduce((t, u) => t + upgradeCost(u), 0)}` : 'Upgrade');
  for (const ty of TOWERS) $('btnBuy_' + ty).classList.toggle('off', game.cp < COSTS[ty]);
  setLabel('btnPossess', tac.hero && !tac.hero.dead ? 'Hero view' : 'Hero down');
  $('btnPossess').classList.toggle('off', !tac.hero || tac.hero.dead);
}

function dragOrder(sx, sy) {
  const sel = liveSelection().filter(u => !u.isTower);
  if (!sel.length) return;
  if (tac.on && tac.phase !== 'plan') { toast('Orders are locked until the round ends', 1); return; }
  const ent = pickEntity(sx, sy), gp = groundPoint(sx, sy);
  if (ent && ent.team === ENEMY) commandAttack(sel, ent);
  else if (gp) commandMove(sel, gp.x, gp.z, tac.on ? 'amove' : 'move');
}
// how many hens could shoot at this spot right now
function threatAt(x, z) {
  let n = 0;
  for (const e of entities) if (!e.dead && !e.isBase && e.team === ENEMY && Math.hypot(e.x - x, e.z - z) <= e.range + 0.5) n++;
  return n;
}
function groundCircle(x, z, r, seg = 40) {
  octx.beginPath();
  let first = true;
  for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, q = toScreen(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r);
    if (q.behind) { first = true; continue; }
    if (first) { octx.moveTo(q.x, q.y); first = false; } else octx.lineTo(q.x, q.y);
  }
}
// range rings of the selection, hen threat zones while planning, and the ghost preview of a dragged order
function drawOrderUI() {
  if (mode !== 'rts') return;
  const planning = tac.on && tac.phase === 'plan';
  if (planning || orderDrag) { // where the hens can shoot
    octx.fillStyle = orderDrag ? 'rgba(255,70,50,.06)' : 'rgba(0,0,0,0)'; octx.strokeStyle = 'rgba(255,90,60,.3)'; octx.lineWidth = 1;
    for (const e of entities) if (!e.dead && !e.isBase && e.team === ENEMY) { groundCircle(e.x, e.z, e.range, 32); octx.fill(); octx.stroke(); }
  }
  const sel = liveSelection();
  octx.setLineDash([5, 6]); octx.lineWidth = 1.5; octx.strokeStyle = 'rgba(160,230,255,.55)';
  for (const u of sel.slice(0, 12)) { groundCircle(u.x, u.z, u.range); octx.stroke(); }
  octx.setLineDash([]);
  if (!orderDrag) return;
  const units = sel.filter(u => !u.isTower);
  const ent = pickEntity(orderDrag.x, orderDrag.y), gp = groundPoint(orderDrag.x, orderDrag.y);
  if (ent && ent.team === ENEMY) { // attack preview
    const t = toScreen(ent.x, 0.1, ent.z);
    octx.strokeStyle = '#ff6a5a'; octx.lineWidth = 2.5; groundCircle(ent.x, ent.z, 1.1, 24); octx.stroke();
    for (const u of units) { const a = toScreen(u.x, 0.1, u.z); octx.setLineDash([4, 5]); octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(t.x, t.y); octx.stroke(); }
    octx.setLineDash([]); label(t.x, t.y - 26, `Attack ${nameOf(ent)}`, '#ff8a7a');
    return;
  }
  if (!gp) return;
  const spots = formationSpots(units.length, gp.x, gp.z);
  const sorted = [...units].sort((a, b) => Math.hypot(a.x - gp.x, a.z - gp.z) - Math.hypot(b.x - gp.x, b.z - gp.z));
  let danger = 0;
  sorted.forEach((u, i) => {
    const [x, z] = spots[i], th = threatAt(x, z); danger = Math.max(danger, th);
    const a = toScreen(u.x, 0.1, u.z), b = toScreen(x, 0.1, z);
    octx.strokeStyle = th ? 'rgba(255,120,90,.9)' : 'rgba(157,255,196,.9)'; octx.lineWidth = 2;
    octx.setLineDash([6, 6]); octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.setLineDash([]);
    groundCircle(x, z, u.radius + 0.25, 20); octx.fillStyle = th ? 'rgba(255,90,60,.35)' : 'rgba(80,255,150,.3)'; octx.fill(); octx.stroke();
  });
  const c = toScreen(gp.x, 0.1, gp.z);
  label(c.x, c.y - 30, danger ? `⚠ ${danger} alien${danger > 1 ? 's' : ''} can hit this spot` : `Move ${units.length} marine${units.length > 1 ? 's' : ''}`, danger ? '#ffb4a0' : '#b8ffd6');
}
function label(x, y, text, color) {
  octx.font = '800 13px system-ui'; octx.textAlign = 'center';
  const w = octx.measureText(text).width + 16;
  octx.fillStyle = 'rgba(10,14,20,.8)'; octx.beginPath(); octx.roundRect ? octx.roundRect(x - w / 2, y - 14, w, 22, 11) : octx.rect(x - w / 2, y - 14, w, 22); octx.fill();
  octx.fillStyle = color; octx.fillText(text, x, y + 2);
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
      const last = u.path[u.path.length - 1]; void end;
      groundCircle(last.x, last.z, u.radius + 0.2, 18); octx.fillStyle = threatAt(last.x, last.z) ? 'rgba(255,90,60,.4)' : 'rgba(157,255,196,.35)'; octx.fill(); octx.strokeStyle = '#9dffc4'; octx.stroke();
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
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  gradePass.uniforms.uAspect.value = w / h;
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
    if (!(selected || e.hp < e.maxHp || e.isBase || e.elite || e.stunT > 0 || e.lvl > 1)) continue;
    const s = toScreen(e.x, e.isBase ? 5.8 : e.elite ? 2.8 : 2.0, e.z);
    if (s.behind || s.x < -50 || s.x > innerWidth + 50 || s.y < -20 || s.y > innerHeight + 20) continue;
    if (mode === 'fps' && Math.hypot(e.x - camera.position.x, e.z - camera.position.z) > 45) continue;
    const w = e.isBase ? 70 : e.elite ? 50 : 30, h = e.isBase ? 7 : 4;
    const k = Math.max(0, e.hp / e.maxHp);
    octx.fillStyle = 'rgba(0,0,0,.65)';
    octx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, h + 2);
    octx.fillStyle = e.elite ? '#ffc340' : e.team === PLAYER ? (k > 0.35 ? '#46e08a' : '#f0c040') : '#ff5a3c';
    octx.fillRect(s.x - w / 2, s.y, w * k, h);
    if (e.isBase && e.shield) {
      octx.strokeStyle = '#ffa080'; octx.lineWidth = 2; octx.strokeRect(s.x - w / 2 - 3, s.y - 3, w + 6, h + 6);
      octx.fillStyle = '#ffd0c0'; octx.font = '700 11px system-ui';
      octx.fillText(`BIO-SHIELD · hold ${points.length - playerPointCount()} more relay${points.length - playerPointCount() === 1 ? '' : 's'}`, s.x, s.y - 6);
    }
    if (e.armorT > 0) { octx.fillStyle = '#7fb8ff'; octx.fillRect(s.x - w / 2, s.y + h + 1, w, 2); }
    if (e.stunT > 0) { octx.font = '14px system-ui'; octx.fillText('💫', s.x, s.y - 6); }
    if (e.lvl > 1) { octx.font = '700 10px system-ui'; octx.fillStyle = '#ffd84a'; octx.fillText('★'.repeat(e.lvl - 1), s.x, s.y - 3); }
  }
  drawOrderUI();
  if (tac.on) drawPlans();
  if (hawk.t > 0 && mode === 'fps') { // hens marked through walls
    for (const e of entities) {
      if (e.dead || e.isBase || e.team !== ENEMY) continue;
      const s = toScreen(e.x, 1.0, e.z);
      if (s.behind) continue;
      octx.strokeStyle = '#ff4a3a'; octx.lineWidth = 2;
      octx.beginPath(); octx.moveTo(s.x, s.y - 12); octx.lineTo(s.x + 9, s.y); octx.lineTo(s.x, s.y + 12); octx.lineTo(s.x - 9, s.y); octx.closePath(); octx.stroke();
    }
  }
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
  renderTopbar(dt);
  refreshPortraitHp();
  const income = CP_BASE + CP_PER_POINT * playerPointCount();
  $('cpText').innerHTML = tac.on ? `💠 <b>${Math.floor(game.cp)}</b>` : `💠 <b>${Math.floor(game.cp)}</b> <small>+${income.toFixed(1)}/s</small>`;
  for (const [id, t] of [['btnBuyTrooper', 'trooper'], ['btnBuyHeavy', 'heavy'], ['btnBuySniper', 'sniper']]) $(id).classList.toggle('off', game.cp < COSTS[t]);
  setLabel('btnPossess', game.relink > 0 ? `Drop in ${Math.ceil(game.relink)}s` : 'Drop in');
  $('btnPossess').classList.toggle('off', game.relink > 0);
  if (possessed) {
    const k = Math.max(0, possessed.hp / possessed.maxHp);
    $('fpsHpFill').style.width = `${k * 100}%`;
    $('fpsHpText').textContent = `${nameOf(possessed).toUpperCase()}  ${Math.ceil(possessed.hp)} / ${possessed.maxHp}  ·  hero`;
    const kit = KITS[possessed.type], cds = possessed.cds || [0, 0];
    const lab = (i, key) => {
      const b = $(i ? 'btnAbility2' : 'btnAbility');
      const scope = possessed.type === 'sniper' && i === 0;
      b.textContent = scope ? (fps.scoped ? `Unscope (${key})` : `Scope (${key})`) : cds[i] > 0 ? `${kit[i].name} ${Math.ceil(cds[i])}s` : `${kit[i].name} (${key})`;
      b.classList.toggle('cd', !scope && cds[i] > 0);
    };
    lab(0, 'Q'); lab(1, 'E');
    const ult = Math.floor(possessed.ult || 0), ub = $('btnUlt');
    ub.textContent = ult >= 100 ? `★ ${kit[2].name} (X)` : `★ ${ult}%`;
    ub.classList.toggle('ready', ult >= 100);
    ub.style.setProperty('--p', `${ult}%`);
  }
  $('vignette').style.opacity = Math.min(1, fps.hurt * 2);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
}

// ---------------------------------------------------------------- unit animation
function animateBird(e, dt, now) {
  const up = e.upper, alien = e.team === ENEMY;
  if (e.moving) {
    e.animT += dt * Math.max(2.5, e.speed) * (alien ? 4.5 : 2.6) * (e.slowT > 0 ? 0.4 : 1);
    const s = Math.sin(e.animT);
    if (alien) { // legs scuttle side against side, body bobs
      e.legs[0].rotation.x = s * 0.35; e.legs[1].rotation.x = -s * 0.35;
      e.legs[0].position.y = Math.max(0, s) * 0.06; e.legs[1].position.y = Math.max(0, -s) * 0.06;
      up.position.y = Math.abs(s) * 0.05; up.rotation.z = s * 0.05;
    } else { // marching: legs swing from the hip, a slight bounce
      e.legs[0].rotation.x = s * 0.6; e.legs[1].rotation.x = -s * 0.6;
      up.position.y = (e.upper.userData.y0 ??= up.position.y) + Math.abs(s) * 0.04; up.rotation.y = s * 0.05;
    }
    up.rotation.x += (0.06 - up.rotation.x) * Math.min(1, dt * 10);
    const step = Math.sign(s);
    if (step !== e.lastStep) { e.lastStep = step; if (Math.random() < 0.4) puff(e.x + (Math.random() - 0.5) * 0.4, 0.15, e.z + (Math.random() - 0.5) * 0.4, 0.5, 0x9a7058, 0.6, 0.5, 0.5); }
  } else {
    const k = Math.min(1, dt * 10);
    for (const l of e.legs) { l.rotation.x -= l.rotation.x * k; l.position.y -= l.position.y * k; }
    up.rotation.z -= up.rotation.z * k; up.rotation.y -= up.rotation.y * k;
    if (!alien && up.userData.y0 !== undefined) up.position.y += (up.userData.y0 - up.position.y) * k; else if (alien) up.position.y -= up.position.y * k;
    up.scale.y = 1 + Math.sin(now / 600 + e.animT) * 0.015; // breathing
    const twitch = alien && (now / 1000 + e.animT) % 3.5 < 0.25; // aliens rear up and twitch now and then
    up.rotation.x += ((twitch ? -0.25 : 0) - up.rotation.x) * Math.min(1, dt * (twitch ? 16 : 6));
  }
  if (e.fireT > 0) { // recoil while shooting
    e.fireT -= dt;
    const kick = Math.max(0, Math.sin(now / 30)) * 0.06;
    if (e.gun) e.gun.position.z = -0.3 + kick;
    if (alien) up.rotation.x = 0.12 - kick; else up.rotation.x = -0.04;
  } else if (e.gun) e.gun.position.z += (-0.3 - e.gun.position.z) * 0.3;
  if (e.sac) e.sac.scale.setScalar(0.3 + Math.sin(now / 200 + e.animT) * 0.03);
  if (e.eyes && alien) { const b = 1.5 + Math.sin(now / 300 + e.animT) * 0.5; for (const ey of e.eyes) ey.scale.z = 0.03 * b; }
}

// ---------------------------------------------------------------- main loop
function simulate(simDt, dt) {
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
  updateWall(simDt);
  updateDucklings(simDt);
  hawk.t -= simDt;
  entities = entities.filter(e => !e.dead);
  selection = selection.filter(e => !e.dead);
}
setupWorld();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if ((mode === 'rts' || mode === 'fps') && !(tac.on && tac.phase === 'plan')) {
    // slow motion during the drop-in: 25% speed, easing back over the last half second
    if (game.slowmo > 0) game.slowmo -= dt;
    const scale = game.slowmo > 0.5 ? 0.25 : game.slowmo > 0 ? 1 - 1.5 * game.slowmo : 1;
    simulate(dt * scale, dt);
  }
  for (const e of entities) {
    if (e.dead) continue;
    if (e.isBase) { e.bodyMat.emissive.setHex(e.flash > 0 ? 0x552211 : 0); e.flash -= dt; continue; }
    e.mesh.position.set(e.x, 0, e.z);
    { const q = Math.max(0, e.flash) * 1.4, b = e.baseScale || 1; e.mesh.scale.set(b * (1 + q), b * (1 - q), b * (1 + q)); } // squash when hit
    if (e.upper && !(tac.on && tac.phase === 'plan')) animateBird(e, dt, now);
    e.mesh.rotation.y = e.facing;
    // in first person, a squadmate brushing past the camera would fill the screen with armour for a frame: hide anyone that close
    e.mesh.visible = !e.possessed && !(mode === 'fps' && possessed && e.team === PLAYER && !e.isTower && Math.hypot(e.x - possessed.x, e.z - possessed.z) < 1.15);
    e.ring.visible = selection.includes(e) && mode !== 'fps';
    if (!e.elite) {
      e.bodyMat.emissive.setHex(e.flash > 0 ? 0xffffff : e.armorT > 0 ? 0x2266ff : 0);
      e.bodyMat.emissiveIntensity = e.flash > 0 ? 0.6 : e.armorT > 0 ? 0.5 : 0;
    }
    e.flash -= dt;
  }
  for (const p of points) { p.flag.rotation.y = now / 600 + p.x; p.flag.position.y = 1.25 + Math.sin(now / 400 + p.x) * 0.1; p.halo.rotation.z = -now / 900; p.halo.position.y = p.flag.position.y; }
  fps.hitMarker -= dt;
  fps.killMarker -= dt;
  updateDebris(dt);
  for (let i = dmgNums.length - 1; i >= 0; i--) { dmgNums[i].life -= dt; if (dmgNums[i].life <= 0) dmgNums.splice(i, 1); }
  fps.hurt = Math.max(0, fps.hurt - dt);
  updateEffects(dt);
  updatePuffs(dt);
  updateKO(dt);
  updateAmbient(dt, now);
  updateCamera(dt);
  if (window.__camOverride) window.__camOverride(camera);
  if (mode !== 'menu') updateHud(dt); else if (toastTimer > 0) toastTimer -= dt;
  renderFrame(dt);
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
  scene, camera, simulate, makeUnit, tac, goLive, startTactics, toScreen, useUlt, wall, hawk, ducklings, buy, upgradeSelected, placeTower,
};
