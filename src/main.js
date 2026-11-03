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
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';

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
  // campaign-only aliens: each breaks one rule
  burrower: { hp: 70, speed: 5, range: 2, dmg: 20, rate: 1, radius: 0.5, acc: 0.85 },  // tunnels under walls, ambushes up close
  shielder: { hp: 120, speed: 3.2, range: 9, dmg: 6, rate: 1, radius: 0.6, acc: 0.6 },  // shields the aliens around it
  eggsac: { hp: 90, speed: 0, range: 0, dmg: 0, rate: 9, radius: 0.7, acc: 0 },          // hatches a skitter every turn
};
const COSTS = { trooper: 20, heavy: 35, sniper: 30, turret: 40, mortar: 55, scarecrow: 25 };
const TOWERS = ['turret', 'mortar', 'scarecrow'];
const POSSESS_DMG = 2.0;    // damage multiplier while you drive the unit
const POSSESS_RATE = 0.6;   // fire-rate multiplier (lower = faster)
const EYE = 1.45;
const PLAYER_CAP = 20, ENEMY_CAP = 22;
const RELINK_CD = 5;        // wait after your soldier dies
const CP_BASE = 1, CP_PER_POINT = 1.5, CP_MAX = 200, CP_START = 40;
// a campaign mission launches by reloading the page with its id, so story missions can build their own map
const LAUNCH = (() => { try { const v = sessionStorage.getItem('hivefall.launch'); if (v) { sessionStorage.removeItem('hivefall.launch'); return JSON.parse(v); } } catch (e) { /* none */ } return null; })();
// story maps: [x, z, w, d, h] cover pieces, [x, z, w, d] rock ridges (impassable canyon walls), the relays, and both bases
const STORY_MAPS = {
  crash: {
    obstacles: [[-2, 19, 4, 1, 1.7], [2.5, 14, 1, 3, 1.7], [-18, 8, 3, 3, 2.6], [11, -5, 3, 3, 2.6], [18, 0, 3, 3, 2.6], [13, 3, 5, 1.2, 2],
      [20, -6, 1, 4, 1.8], [-3, -13, 4, 1, 1.7], [7, -13, 4, 1, 1.7], [-19, -2, 5, 1.2, 2], [-2, 1, 5, 1.2, 2], [6, -4, 1, 4, 1.8]],
    ridges: [[-6, 21, 2, 10], [6, 18, 2, 16], [-4, 9, 22, 2], [-24, 2, 2, 28], [-10, 4, 2, 8], [3, -9, 22, 2], [24, -4, 2, 24], [-14, -15, 2, 10]],
    points: [['R', 2, -17]],
  },
};
const STORY_MAP = LAUNCH && LAUNCH.story ? STORY_MAPS[LAUNCH.story] : null;
const POINT_DEFS = STORY_MAP ? STORY_MAP.points : [['A', -17, 0], ['B', 0, 0], ['C', 17, 0]];
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
// Three levels: fast (plain), fancy (bloom + grading), ultra (adds ambient occlusion, sharper shadows that follow the camera, more ground detail).
const GFX_NAMES = ['⚡ Graphics: fast', '✨ Graphics: fancy', '💎 Graphics: ultra'];
const gfx = { level: matchMedia('(pointer: coarse)').matches ? 1 : 2, fancy: true, auto: true, slowT: 0, warm: 0 };
try {
  const sp = new URLSearchParams(location.search), q = sp.get('fancy'), g = sp.get('gfx');
  const saved = localStorage.getItem('hivefall.gfx');
  if (g !== null) { gfx.level = Math.max(0, ['fast', 'fancy', 'ultra'].indexOf(g)); gfx.auto = false; }
  else if (q !== null) { gfx.level = q === '0' ? 0 : 1; gfx.auto = false; }
  else if (saved) gfx.level = Math.max(0, ['fast', 'fancy', 'ultra'].indexOf(saved));
} catch (e) { /* storage blocked: keep defaults */ }
gfx.fancy = gfx.level > 0;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const aoPass = new GTAOPass(scene, camera, 256, 256);
aoPass.output = GTAOPass.OUTPUT.Default;
aoPass.blendIntensity = 0.85;
aoPass.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
composer.addPass(aoPass);
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
function setGfx(level, why, save = true) {
  gfx.level = level; gfx.fancy = level > 0;
  aoPass.enabled = level === 2;
  if (save) try { localStorage.setItem('hivefall.gfx', ['fast', 'fancy', 'ultra'][level]); } catch (e) { /* ignore */ }
  const b = document.getElementById('btnGfx'); if (b) b.textContent = GFX_NAMES[level];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, level === 2 ? 2 : 1.75));
  const ms = level === 2 ? 4096 : 2048; // sharper shadows on ultra
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (typeof groundDetail !== 'undefined') groundDetail(level);
  if (typeof resize === 'function' && renderer.domElement.width) resize();
  if (why) toast(why, 2.5);
}
const setFancy = (on, why, save) => setGfx(on ? Math.max(1, gfx.level) : 0, why, save);
// the sun's shadow box follows what you're looking at, snapped to its texels so shadows don't shimmer
scene.add(sun.target);
function followShadows() {
  const c = mode === 'fps' && possessed ? possessed : mode === 'menu' ? { x: 4, z: 6 } : rts.focus;
  const half = gfx.level === 2 ? (mode === 'fps' ? 24 : 34) : 40;
  const cam = sun.shadow.camera;
  if (cam.right !== half) { Object.assign(cam, { left: -half, right: half, top: half, bottom: -half }); cam.updateProjectionMatrix(); }
  const texel = (half * 2) / sun.shadow.mapSize.x * 4;
  const x = Math.round(c.x / texel) * texel, z = Math.round(c.z / texel) * texel;
  sun.target.position.set(x, 0, z);
  sun.position.set(x + SUN_DIR.x * 60, SUN_DIR.y * 60, z + SUN_DIR.z * 60);
}
function renderFrame(dt) {
  followShadows();
  if (!gfx.fancy) { renderer.render(scene, camera); return; }
  composer.render(dt);
  // too slow for a few seconds in game? step down a graphics level
  if (gfx.auto && mode !== 'menu') {
    gfx.warm += dt;
    if (gfx.warm > 3) { gfx.slowT = dt > 0.042 ? gfx.slowT + dt : Math.max(0, gfx.slowT - dt * 2); }
    if (gfx.slowT > 4) {
      gfx.slowT = 0; gfx.warm = 0;
      if (gfx.level === 2) setGfx(1, 'Switched to fancy graphics for a smoother game', false);
      else { gfx.auto = false; setGfx(0, 'Switched to fast graphics for a smoother game', false); }
    }
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
// ground detail: thousands of instanced pebbles and alien spike-plants (fewer on lower graphics levels)
const detail = {};
{
  const rnd = (() => { let x = 1234567; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
  const pebGeo = rockGeo(91, 0); pebGeo.scale(0.12, 0.08, 0.12);
  const pebMat = toon({ color: 0x8a6a58, roughness: 0.95, metalness: 0.02, flatShading: true });
  const MAXP = 5000;
  const peb = new THREE.InstancedMesh(pebGeo, pebMat, MAXP);
  const d = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < MAXP; i++) {
    const r = Math.sqrt(rnd()) * 70, a = rnd() * Math.PI * 2;
    d.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    d.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
    d.scale.setScalar(0.3 + Math.pow(rnd(), 4) * 2.2);
    d.updateMatrix(); peb.setMatrixAt(i, d.matrix);
    peb.setColorAt(i, col.setHSL(0.05 + rnd() * 0.03, 0.35 + rnd() * 0.2, 0.42 + rnd() * 0.25));
  }
  peb.receiveShadow = true; peb.raycast = () => {};
  scene.add(peb);
  // alien plants: a cluster of thin dark spikes with glowing tips
  const spike = new THREE.ConeGeometry(0.035, 0.55, 5); spike.translate(0, 0.27, 0);
  const tip = new THREE.SphereGeometry(0.03, 6, 4); tip.translate(0, 0.56, 0);
  const plantMat = toon({ color: 0x3a2a3e, roughness: 0.6, metalness: 0.1 });
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 1.3) });
  const MAXS = 2400;
  const sp = new THREE.InstancedMesh(spike, plantMat, MAXS), tp = new THREE.InstancedMesh(tip, tipMat, MAXS);
  let n = 0;
  while (n < MAXS) {
    const r = 8 + Math.sqrt(rnd()) * 60, a = rnd() * Math.PI * 2, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (Math.abs(cx) < 30 && Math.abs(cz) < 30 && rnd() < 0.6) continue; // thinner inside the battlefield
    const k = 4 + Math.floor(rnd() * 6), sc = 0.6 + rnd() * 1.2;
    for (let j = 0; j < k && n < MAXS; j++, n++) {
      d.position.set(cx + (rnd() - 0.5) * 0.5, 0, cz + (rnd() - 0.5) * 0.5);
      d.rotation.set((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9);
      d.scale.set(sc, sc * (0.6 + rnd() * 0.9), sc);
      d.updateMatrix(); sp.setMatrixAt(n, d.matrix); tp.setMatrixAt(n, d.matrix);
    }
  }
  sp.castShadow = true; sp.raycast = tp.raycast = () => {};
  scene.add(sp, tp);
  Object.assign(detail, { peb, sp, tp, MAXP, MAXS });
}
function groundDetail(level) {
  const kP = [0.3, 0.6, 1][level], kS = [0.35, 0.65, 1][level];
  detail.peb.count = Math.round(detail.MAXP * kP);
  detail.sp.count = detail.tp.count = Math.round(detail.MAXS * kS);
}
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
const OBSTACLE_DEFS = STORY_MAP ? STORY_MAP.obstacles : [
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
if (STORY_MAP) { // canyon walls: a rock core lined with boulders so the silhouette reads as cliffs, not boxes
  const ridgeMat = toon({ map: rockTex.col, normalMap: rockTex.nrm, roughness: 0.95, metalness: 0.02, color: 0x9a7a66 });
  const bGeos = [rockGeo(11, 1), rockGeo(23, 1), rockGeo(37, 1)];
  STORY_MAP.ridges.forEach(([x, z, w, d], k) => {
    const h = 4.2;
    const core = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ridgeMat);
    core.position.set(x, h / 2, z); core.castShadow = core.receiveShadow = true; scene.add(core);
    staticShootables.push(core);
    const len = Math.max(w, d), along = w > d;
    for (let t = -len / 2; t <= len / 2; t += 1.6) {
      for (const side of [-1, 1]) {
        const r = noRay(new THREE.Mesh(bGeos[(k + Math.round(t * 3) + (side > 0 ? 1 : 0)) % 3 + 0], rockMat));
        const sc = 1.1 + ((Math.sin(t * 12.9 + k * 7 + side) + 1) * 0.5) * 1.1;
        r.scale.set(sc, sc * (1.2 + Math.abs(Math.sin(t * 3.1 + k))), sc);
        const off = (Math.min(w, d) / 2) * side * 0.7;
        r.position.set(along ? x + t : x + off, sc * 0.6 + Math.abs(Math.sin(t * 5 + k)) * 1.2, along ? z + off : z + t);
        r.rotation.set(t, t * 2 + k, 0); r.castShadow = true; scene.add(r);
      }
    }
    boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  });
}

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
  { trooper: 'Skitter', heavy: 'Brute', sniper: 'Spitter', elite: 'Hive Tyrant', burrower: 'Burrower', shielder: 'Warden', eggsac: 'Egg sac' },
];
const nameOf = u => NAMES[u.team][u.type];
const sphere = new THREE.SphereGeometry(1, 16, 12);
const ARMOR = { trooper: 0x6d7a68, heavy: 0x4a4f58, sniper: 0xa89478 };   // olive, steel, desert
const CARAPACE = { trooper: 0x3a2448, heavy: 0x2a1a30, sniper: 0x3c2a1c, burrower: 0x5a3a22, shielder: 0x1c2c4a, eggsac: 0x5a2a40 };
const ALIEN_MODEL = { burrower: 'trooper', shielder: 'heavy' };

function tagMeshes(group, ent) {
  group.traverse(o => { o.userData.entity = ent; if (o.isMesh) o.castShadow = true; });
}
const prec = m => { m.userData.prec = true; return m; }; // a precision (crit) spot: heads, eyes, mandibles, horns
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

function buildEggSac(u, g) { // a pulsing, veined sac on a root bed
  const shell = toon({ color: CARAPACE.eggsac, roughness: 0.25, metalness: 0.1, emissive: 0x401030, emissiveIntensity: 0.4 });
  u.bodyMat = shell;
  const up = new THREE.Group(); g.add(up); u.upper = up;
  up.add(blob(shell, 0.6, 0.75, 0.6, 0, 0.7, 0));
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; up.add(blob(shell, 0.28, 0.3, 0.28, Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5)); }
  const core = blob(acidMat, 0.3, 0.38, 0.3, 0, 0.8, 0); up.add(core); u.pulse = core;
  u.legs = [new THREE.Group(), new THREE.Group()]; g.add(u.legs[0], u.legs[1]); u.feet = u.legs; u.wings = [new THREE.Group(), new THREE.Group()];
  u.eyes = []; u.muzzleOffset = { side: 0, fwd: 0, y: 0.8 };
}
function buildAlien(u, g, type) {
  const kind = type;
  if (type === 'eggsac') { buildEggSac(u, g); return; }
  type = ALIEN_MODEL[type] || type;
  const elite = type === 'elite';
  const shell = elite ? goldMat.clone() : toon({ color: CARAPACE[kind], roughness: 0.28, metalness: 0.35, normalMap: rockTex.nrm, normalScale: new THREE.Vector2(0.6, 0.6) });
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
    up.add(prec(blob(shell, 0.2, 0.18, 0.3, 0, L + 0.85, -0.5)));     // head
  } else {
    const s = heavyish ? 1.5 : 1;
    up.add(blob(shell, 0.42 * s, 0.32 * s, 0.6 * s, 0, L, 0.35 * s));      // abdomen
    up.add(blob(belly, 0.36 * s, 0.22 * s, 0.5 * s, 0, L - 0.12 * s, 0.32 * s));
    up.add(blob(shell, 0.32 * s, 0.28 * s, 0.34 * s, 0, L + 0.05 * s, -0.12 * s)); // thorax
    up.add(prec(blob(shell, 0.22 * s, 0.2 * s, 0.24 * s, 0, L + 0.08 * s, -0.5 * s)));  // head
    for (let k = 0; k < (heavyish ? 4 : 3); k++) up.add(blob(shell, 0.08 * s, 0.14 * s, 0.1 * s, 0, L + 0.3 * s, 0.1 * s + k * 0.22 * s)); // dorsal spines
    if (heavyish) for (const sd of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.5 * s, 6), toon({ color: 0xd8c8b0, roughness: 0.4 })); horn.position.set(sd * 0.16 * s, L + 0.25 * s, -0.62 * s); horn.rotation.set(-1.0, 0, sd * 0.3); up.add(prec(horn)); }
  }
  // glowing eyes and mandibles
  const hz = type === 'sniper' ? -0.72 : heavyish ? -0.82 : -0.62, hy = type === 'sniper' ? L + 0.88 : L + (heavyish ? 0.15 : 0.1);
  u.eyes = [];
  for (const sd of [-1, 1]) {
    const e = blob(eyeGlow[elite ? 1 : 0], 0.045, 0.035, 0.03, sd * (heavyish ? 0.13 : 0.09), hy + 0.04, hz + (heavyish ? 0.1 : 0.08)); up.add(prec(e)); u.eyes.push(e);
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 5), legMat); m.position.set(sd * 0.06, hy - 0.08, hz); m.rotation.set(-Math.PI / 2 - 0.3, 0, sd * 0.4); up.add(prec(m));
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
  if (kind === 'shielder') { // a warden: a glowing halo on its back
    const halo = noRay(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 2.6) })));
    halo.position.set(0, L + 0.9, 0.3); halo.rotation.x = 0.4; up.add(halo);
  }
  if (kind === 'burrower') for (const sd of [-1, 1]) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 5), toon({ color: 0xd8c8b0, roughness: 0.4 })); claw.position.set(sd * 0.18, L, -0.7); claw.rotation.set(-1.3, 0, sd * 0.4); up.add(claw); }
  if (elite) { // the tyrant: a crown of glowing spikes
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 5), acidMat); sp.position.set((k - 2) * 0.16, L + 0.6, -0.25 + Math.abs(k - 2) * 0.08); up.add(sp); }
  }
}

let uidSeq = 0;
function makeUnit(team, type, x, z) {
  const t = TYPES[type];
  const u = {
    kind: 'unit', uid: ++uidSeq, type, team, x, z, hp: t.hp * (team === PLAYER ? PLAYER_HP : 1), maxHp: t.hp * (team === PLAYER ? PLAYER_HP : 1), speed: t.speed, range: t.range,
    dmg: t.dmg, rate: t.rate, radius: t.radius, acc: t.acc,
    facing: team === PLAYER ? 0 : Math.PI, cool: Math.random() * t.rate, abilityCd: 0, armorT: 0,
    order: { type: 'idle' }, path: null, pathGoal: null, possessed: false, dead: false, flash: 0,
    elite: type === 'elite',
  };
  const g = new THREE.Group();
  if (team === PLAYER) buildMarine(u, g, type, team); else buildAlien(u, g, type);
  u.animT = Math.random() * 10;
  if (type === 'elite') { g.scale.setScalar(1.3); if (camp.m && camp.m.tyrantHp) u.hp = u.maxHp = Math.round(u.maxHp * camp.m.tyrantHp); }
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
// bullet magnetism: the visible enemy closest to the shot, if it is within a small cone
function magnetTarget(u, ray, cone) {
  let best = null, bd = cone;
  for (const e of entities) {
    if (e.dead || e.team === u.team || e.isBase || hiddenFoe(e)) continue;
    const v = new THREE.Vector3(e.x, 0.6 * (e.baseScale || 1), e.z).sub(ray.origin), d = v.length();
    if (d > 45 || d < 0.5) continue;
    const ang = v.normalize().angleTo(ray.direction) - 0.35 / d; // bigger bodies up close
    if (ang < bd) { bd = ang; best = e; }
  }
  return best;
}
// a kill in first person: the alien bursts into light
function killPop(e, crit) {
  burst(e.x, 1, e.z, crit ? 1.1 : 0.8, crit ? 0xffe27a : 0xfff2c0);
  feathers(e.x, e.z, 0x7aff3a, crit ? 10 : 6);
}
function dmgNumber(p, amount, crit) {
  dmgNums.push({ x: p.x, y: p.y + 0.3, z: p.z, text: String(Math.round(amount)), life: 0.8, crit, dx: (Math.random() - 0.5) * 30 });
  if (dmgNums.length > 40) dmgNums.shift();
}

// ---------------------------------------------------------------- loot: dead aliens drop ore, medkits, ult cells and rare relics
// Walk a marine over it (or near it) to pick it up. Relics stay with that marine for the rest of the campaign.
const RELICS = {
  plate: { name: 'Chitin Plate', text: '+10% health', hp: 0.1 },
  gland: { name: 'Acid Gland', text: '+10% damage', dmg: 0.1 },
  lens: { name: 'Hive Lens', text: '+6% accuracy', acc: 0.06 },
  node: { name: 'Neural Node', text: 'ultimate charges 25% faster', ult: 0.25 },
};
const LOOT_KINDS = {
  ore: { color: 0x5fd0ff, label: n => `+${n} ore` },
  med: { color: 0x5dff9a, label: () => '+35% health' },
  cell: { color: 0xffd36a, label: () => '+20% ultimate' },
  relic: { color: 0xc77dff, label: r => `Relic: ${RELICS[r].name}` },
};
const loot = [];
const lootGeo = {
  ore: new THREE.OctahedronGeometry(0.2, 0),
  med: new RoundedBoxGeometry(0.34, 0.22, 0.26, 2, 0.04),
  cell: new THREE.CylinderGeometry(0.09, 0.09, 0.32, 12),
  relic: new THREE.IcosahedronGeometry(0.2, 0),
};
const lootRing = new THREE.RingGeometry(0.32, 0.4, 24);
function dropLoot(e) {
  const roll = Math.random();
  let kind = null, val = 0;
  if (e.elite || roll < 0.035) { kind = 'relic'; const ks = Object.keys(RELICS); val = ks[Math.floor(Math.random() * ks.length)]; }
  else if (roll < 0.45) { kind = 'ore'; val = 4 + Math.floor(Math.random() * 5); }
  else if (roll < 0.6) kind = 'med';
  else if (roll < 0.72) kind = 'cell';
  if (!kind) return;
  const L = LOOT_KINDS[kind];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: L.color, emissive: L.color, emissiveIntensity: kind === 'med' ? 0.25 : 1.4, roughness: 0.3, metalness: 0.3 });
  const m = new THREE.Mesh(lootGeo[kind], kind === 'med' ? toon({ color: 0xe8ecef, roughness: 0.4, metalness: 0.2 }) : mat);
  m.castShadow = true; g.add(m);
  if (kind === 'med') { // a green cross on top
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.05), mat), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.16), mat);
    c1.position.y = c2.position.y = 0.115; g.add(c1, c2);
  }
  const ring = new THREE.Mesh(lootRing, new THREE.MeshBasicMaterial({ color: L.color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -0.33; g.add(ring);
  g.position.set(e.x, 0.45, e.z);
  g.traverse(noRay);
  scene.add(g);
  loot.push({ g, m, kind, val, x: e.x, z: e.z, life: 30, vy: 3, y: 0.6 });
}
function updateLoot(dt) {
  for (let i = loot.length - 1; i >= 0; i--) {
    const l = loot[i];
    if (!turn.on) l.life -= dt; // in the campaign loot fades by turns instead
    // pop up, then hover and spin
    if (l.vy !== 0) { l.vy -= 12 * dt; l.y += l.vy * dt; if (l.y <= 0.45) { l.y = 0.45; l.vy = 0; } }
    l.g.position.y = l.y + (l.vy === 0 ? Math.sin(game.time * 3 + l.x) * 0.06 : 0);
    l.m.rotation.y += dt * 2.2;
    l.g.visible = l.life > 5 || Math.sin(l.life * 20) > 0;
    let taker = null;
    for (const u of entities) {
      if (u.dead || u.team !== PLAYER || u.isBase || u.isTower) continue;
      if (Math.hypot(u.x - l.x, u.z - l.z) < (u.possessed ? 1.8 : 1.3)) { taker = u; break; }
    }
    if (taker) takeLoot(l, taker);
    if (taker || l.life <= 0) { scene.remove(l.g); loot.splice(i, 1); }
  }
}
function takeLoot(l, u) {
  const L = LOOT_KINDS[l.kind];
  if (l.kind === 'ore') game.cp = Math.min(CP_MAX, game.cp + l.val);
  if (l.kind === 'med') u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.35);
  if (l.kind === 'cell') chargeUlt(u, 20);
  if (l.kind === 'relic') {
    applyRelic(u, l.val);
    (u.relics = u.relics || []).push(l.val);
    radio(`${u.callsign || nameOf(u)} found a relic: ${RELICS[l.val].name} (${RELICS[l.val].text})${u.rid ? ', kept for the campaign' : ''}`, 'good');
  }
  dmgNums.push({ x: l.x, y: 2.1, z: l.z, text: L.label(l.val), life: 1.4, crit: l.kind === 'relic', dx: 0, color: '#' + L.color.toString(16).padStart(6, '0') });
  burst(l.x, 0.6, l.z, 0.6, L.color);
  if (u.possessed) gunSound('ready');
}
function applyRelic(u, key) {
  const r = RELICS[key]; if (!r) return;
  if (r.hp) { const add = Math.round(u.maxHp * r.hp); u.maxHp += add; u.hp += add; }
  if (r.dmg) u.dmg *= 1 + r.dmg;
  if (r.acc) u.acc = Math.min(0.97, u.acc + r.acc);
  if (r.ult) u.ultRate = (u.ultRate || 1) + r.ult;
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
  if (audio) return; // one context for the whole page (sound effects and music share it)
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.8, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
  } catch { audio = null; }
}
// gunfire: layered transient + body + low thump + a plasma zap, with a short canyon echo through a generated reverb
let reverb = null;
function getReverb() {
  if (reverb || !audio) return reverb;
  const len = audio.sampleRate * 1.4, ir = audio.createBuffer(2, len, audio.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  reverb = audio.createConvolver(); reverb.buffer = ir;
  const g = audio.createGain(); g.gain.value = 0.35; reverb.connect(g); g.connect(audio.destination);
  return reverb;
}
function gunSound(kind) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime, rv = getReverb();
  const out = audio.createGain(); out.gain.value = 0.5; out.connect(audio.destination); out.connect(rv);
  const noise = (type, freq, q, vol, dur, rate = 1) => {
    const src = audio.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = rate;
    const f = audio.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = audio.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + dur + 0.02);
  };
  const tone = (type, f0, f1, vol, dur, delay = 0) => {
    const o = audio.createOscillator(), g = audio.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t + delay); o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.setValueAtTime(vol, t + delay); g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + delay + dur + 0.02);
  };
  const pitch = 0.94 + Math.random() * 0.12;
  if (kind === 'trooper' || kind === 'elite') {
    noise('highpass', 5000, 0.7, 0.5, 0.025, 1.6);           // crack
    noise('bandpass', 1100 * pitch, 1.1, 1.0, 0.1, 1.1);    // body
    tone('sine', 140, 45, 0.85, 0.1);                         // chest thump
    tone('square', 420 * pitch, 160, 0.07, 0.05);             // mechanical clack
    tone('sawtooth', 1800 * pitch, 260, 0.08, 0.06);          // energy zap
  } else if (kind === 'heavy') {
    noise('highpass', 3000, 0.7, 0.6, 0.04, 1.2);
    noise('lowpass', 900, 0.8, 1.4, 0.32, 0.7);
    tone('sine', 110, 32, 1.0, 0.26);
    tone('square', 520 * pitch, 90, 0.08, 0.18);
  } else if (kind === 'sniper') {
    noise('highpass', 6000, 0.7, 0.8, 0.03, 2);
    noise('bandpass', 900 * pitch, 0.9, 1.2, 0.35, 1);
    tone('sine', 130, 38, 0.9, 0.22);
    tone('sawtooth', 3200, 400, 0.15, 0.16);                 // rail whine
  } else if (kind === 'crit') { // precision hit: a bright ping you learn to chase
    out.disconnect(rv); out.gain.value = 0.38;
    tone('triangle', 2350, 2300, 0.28, 0.09); tone('sine', 3500, 3400, 0.12, 0.06); noise('bandpass', 4200, 3, 0.35, 0.03, 1.8);
  } else if (kind === 'hit') {
    out.disconnect(rv); out.gain.value = 0.35;
    noise('bandpass', 2600, 2, 0.6, 0.05, 1.5); tone('triangle', 900, 600, 0.2, 0.05);
  } else if (kind === 'kill') {
    out.disconnect(rv); out.gain.value = 0.4;
    tone('triangle', 520, 520, 0.25, 0.08); tone('triangle', 780, 780, 0.25, 0.12, 0.07); noise('lowpass', 500, 1, 0.5, 0.15, 0.6);
  } else if (kind === 'reload') {
    out.disconnect(rv); out.gain.value = 0.35;
    noise('bandpass', 2400, 4, 0.5, 0.04, 1.4); tone('square', 300, 200, 0.06, 0.05, 0.05);
    const s2 = audio.createBufferSource(); s2.buffer = noiseBuf; const f2 = audio.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1800; f2.Q.value = 5;
    const g2 = audio.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.setValueAtTime(0.5, t + 0.45); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    s2.connect(f2); f2.connect(g2); g2.connect(out); s2.start(t); s2.stop(t + 0.55);
  } else if (kind === 'ready') {
    out.disconnect(rv); out.gain.value = 0.4;
    noise('bandpass', 3200, 6, 0.6, 0.03, 1.8); noise('bandpass', 1600, 6, 0.6, 0.04, 1.2);
  } else if (kind === 'screech') { // an alien dying
    out.gain.value = 0.25;
    tone('sawtooth', 900 * pitch, 180, 0.35, 0.35); tone('square', 1400 * pitch, 300, 0.12, 0.25); noise('bandpass', 2000, 1, 0.4, 0.3);
  }
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
  ads: 0, adsWant: false, reloadT: 0, reloadMax: 1,
  yaw: 0, pitch: 0, firing: false, bob: 0, hitMarker: 0, killMarker: 0, hurt: 0, flash: 0, stickX: 0, stickY: 0, scoped: false,
  recoil: 0, vmKick: 0, shake: 0, bloom: 0, vx: 0, vz: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0,
  burstLeft: 0, critMarker: 0, target: null,
};
// first-person guns (you only). Every gun has precision hits (aim for the head: bigger, yellow numbers and a
// bright ping), predictable mostly-vertical recoil that settles fast, and bullet magnetism that bends near misses
// onto the body. trooper = 3-round pulse rifle, heavy = pump shotgun, sniper = precision rail, elite = auto rifle.
const GUNS = {
  trooper: { name: 'Pulse rifle', rate: 0.3, burst: 3, burstGap: 0.065, dmg: 9, prec: 1.7, spread: 0.007, pellets: 1, kick: 0.009, drift: 0.0015, shake: 0.03, speed: 140, magnet: 0.03 },
  heavy: { name: 'Shotgun', rate: 0.62, dmg: 9, prec: 1.4, spread: 0.06, pellets: 8, kick: 0.06, drift: 0, shake: 0.18, speed: 110, magnet: 0 },
  sniper: { name: 'Rail rifle', rate: 0.85, dmg: 60, prec: 2.8, spread: 0.02, pellets: 1, kick: 0.075, drift: 0.004, shake: 0.09, speed: 260, magnet: 0.02 },
  elite: { name: 'Auto rifle', rate: 0.085, dmg: 6, prec: 1.5, spread: 0.012, pellets: 1, kick: 0.007, drift: 0.001, shake: 0.022, speed: 140, magnet: 0.025 },
};
// health bar height over an alien in first person
const barY = e => (e.type === 'sniper' ? 2.0 : e.type === 'heavy' || e.type === 'elite' || e.type === 'shielder' ? 1.7 : 1.15) * (e.baseScale || 1);
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
  if (t.shieldHP > 0) { const a = Math.min(t.shieldHP, amount); t.shieldHP -= a; amount -= a; if (t.bubble) t.bubble.visible = t.shieldHP > 0; if (amount <= 0) { burst(t.x, 1, t.z, 0.6, 0x7fc8ff); return; } }
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
  campaignKill(e, src);
  burst(e.x, e.isBase ? 2 : 1, e.z, e.isBase ? 6 : 1.2, e.isBase ? 0xffaa44 : e.team === PLAYER ? 0xffc080 : 0x9cff3a);
  feathers(e.x, e.z, e.isBase ? (e.team === PLAYER ? 0x9aa0a8 : 0x6aff2a) : e.team === PLAYER ? 0x8a9098 : 0x7aff3a, e.isBase ? 40 : 14);
  if (e.isBase) sfx('boom', e.x, e.z); else if (e.team === ENEMY && mode === 'fps' && Math.hypot(e.x - camera.position.x, e.z - camera.position.z) < 30) gunSound('screech'); else sfx(e.team === PLAYER ? 'quack' : 'bawk', e.x, e.z);
  if (e.team === ENEMY && !e.isBase && !e.isTower) dropLoot(e);
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
  if (turn.on && !turn.live && !u.isTower) { turnUnit(u, dt); return; }
  // ducks patch themselves up after 4s out of the fight
  if (!turn.on && u.team === PLAYER && u.hp < u.maxHp && game.time - (u.hurtAt ?? -99) > REGEN_DELAY) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * REGEN_RATE * dt);
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
    if ((tac.on || turn.live) && o.type === 'idle') { // in tactics, idle means hold this spot: step out a little to answer fire, never wander
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
  } else if ((tac.on || turn.live) && o.type === 'idle' && u.anchor && Math.hypot(u.x - u.anchor.x, u.z - u.anchor.z) > 0.8) {
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
  if (camp.m && camp.m.story && story.def) { // story maps: a dropship drops reinforcements at your last checkpoint
    const [cx, cz] = story.def[story.checkpoint].cp;
    const u = makeUnit(PLAYER, type, cx + (Math.random() - 0.5) * 3, cz + (Math.random() - 0.5) * 3);
    smoke(u.x, 0.4, u.z, 1.6, 6);
    radio(`Reinforcement ${NAMES[PLAYER][type].toLowerCase()} dropped at ${story.def[story.checkpoint].name}`, 'good', { dropAt: u });
    if (turn.on) { u.ap = 2; u.gren = type === 'trooper' ? 1 : 0; }
    return u;
  }
  const u = makeUnit(PLAYER, type, (Math.random() - 0.5) * 3, 21.5);
  if (tac.on || turn.on) { u.x = (Math.random() - 0.5) * 6; u.z = 19 + Math.random(); if (turn.on) { u.ap = 2; u.gren = type === 'trooper' ? 1 : 0; } return u; } // ready to be ordered
  commandMove([u], (Math.random() - 0.5) * 8, 17 - Math.random() * 2, 'move', true);
  return u;
}

function buy(type) {
  if (mode !== 'rts' || (tac.on && tac.phase !== 'plan') || (turn.on && (turn.side !== 'player' || turn.busy))) return;
  if (TOWERS.includes(type)) {
    if (!tac.on) return;
    if (game.cp < COSTS[type]) { toast(`${NAMES[PLAYER][type]} costs ${COSTS[type]} ore`, 1); return; }
    setTool(tac.tool === 'place:' + type ? 'move' : 'place:' + type); return; // tapping the button again cancels
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
  if (!enemyBase.dead && !(camp.m && camp.m.story)) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveNum++;
      waveTimer = Math.max(16, 26 - waveNum) * ((camp.m && camp.m.waveMul) || 1);
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
// first-person weapons: one model per kit with rounded edges and real gun anatomy, held in gloved hands
{
  const metal = toon({ color: 0x3b4149, roughness: 0.34, metalness: 0.62 });
  const dark = toon({ color: 0x1f2328, roughness: 0.5, metalness: 0.4 });
  const poly = toon({ color: 0x2a2e33, roughness: 0.7, metalness: 0.08 });
  const paint = toon({ color: 0x6f6b52, roughness: 0.6, metalness: 0.2 });     // olive panels
  const edge = toon({ color: 0x9aa3ad, roughness: 0.25, metalness: 0.65 });    // worn bright edges
  const brass = toon({ color: 0xc8a050, roughness: 0.3, metalness: 0.65 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.7, 2.8) });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0b1820, emissive: 0x2a6080, emissiveIntensity: 0.35, roughness: 0.02, metalness: 0.5, transparent: true, opacity: 0.55 });
  const reticle = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 0.3) });
  const sleeve = toon({ color: 0x6b7a66, roughness: 0.5, metalness: 0.45 });
  const glove = toon({ color: 0x24272c, roughness: 0.8, metalness: 0.05 });
  const knuckle = toon({ color: 0x3a3f46, roughness: 0.5, metalness: 0.4 });
  const R = (w, h, d, r = 0.008) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const box = (g, mat, w, h, d, x, y, z, rx = 0, r) => { const m = new THREE.Mesh(R(w, h, d, r), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const tube = (g, mat, r1, r2, len, x, y, z, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  const ring = (g, mat, r, t, x, y, z) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 20), mat); m.position.set(x, y, z); g.add(m); return m; };
  const rail = (g, len, y, z) => { box(g, dark, 0.034, 0.01, len, 0, y, z, 0, 0.003); for (let t = -len / 2 + 0.012; t < len / 2; t += 0.024) box(g, dark, 0.04, 0.008, 0.01, 0, y + 0.008, z + t, 0, 0.002); };
  const hands = (g, gripZ, foreZ, foreY) => {
    // right hand wrapped around the grip, index finger on the trigger guard
    box(g, glove, 0.062, 0.085, 0.07, 0.006, -0.088, gripZ + 0.012, -0.3, 0.02);
    for (let f = 0; f < 3; f++) box(g, glove, 0.018, 0.022, 0.05, -0.028, -0.06 - f * 0.024, gripZ - 0.024, -0.3, 0.008);
    box(g, glove, 0.016, 0.018, 0.055, -0.028, -0.035, gripZ - 0.05, 0, 0.007);
    box(g, knuckle, 0.05, 0.03, 0.04, 0.03, -0.07, gripZ + 0.02, -0.3, 0.01);
    const s1 = tube(g, sleeve, 0.046, 0.056, 0.34, 0.03, -0.15, gripZ + 0.2, 12); s1.rotation.x = Math.PI / 2 - 0.55;
    ring(g, edge, 0.05, 0.007, 0.022, -0.11, gripZ + 0.1).rotation.x = Math.PI / 2 - 0.55;
    // left hand under the handguard, thumb over the top
    box(g, glove, 0.07, 0.055, 0.1, -0.008, foreY - 0.05, foreZ, 0, 0.02);
    box(g, glove, 0.018, 0.02, 0.07, -0.042, foreY - 0.005, foreZ - 0.01, 0, 0.008);
    for (let f = 0; f < 3; f++) box(g, glove, 0.02, 0.02, 0.022, 0.04, foreY - 0.02, foreZ - 0.035 + f * 0.026, 0, 0.008);
    const s2 = tube(g, sleeve, 0.044, 0.054, 0.38, -0.14, foreY - 0.14, foreZ + 0.13, 12); s2.rotation.set(Math.PI / 2 - 0.6, 0, -0.75);
  };
  const kits = {};
  { // Marine: compact pulse rifle with a holographic sight
    const g = new THREE.Group();
    box(g, metal, 0.07, 0.085, 0.3, 0, 0, -0.12, 0, 0.012);                 // upper receiver
    box(g, paint, 0.074, 0.05, 0.18, 0, -0.035, -0.12, 0, 0.012);           // lower receiver
    box(g, dark, 0.012, 0.03, 0.06, 0.037, 0.012, -0.06, 0, 0.004);         // ejection port cover
    box(g, edge, 0.02, 0.012, 0.03, -0.04, 0.03, -0.02, 0, 0.004);          // charging handle
    rail(g, 0.34, 0.05, -0.16);
    box(g, poly, 0.068, 0.07, 0.24, 0, -0.002, -0.4, 0, 0.018);             // handguard
    for (let k = 0; k < 4; k++) { box(g, dark, 0.072, 0.008, 0.028, 0, 0.02, -0.33 - k * 0.05, 0, 0.003); box(g, glow, 0.073, 0.004, 0.02, 0, 0.004, -0.33 - k * 0.05, 0, 0.001); }
    tube(g, metal, 0.015, 0.015, 0.16, 0, 0.005, -0.58);                    // barrel
    tube(g, edge, 0.025, 0.022, 0.055, 0, 0.005, -0.67, 8);                 // muzzle brake
    for (let k = 0; k < 3; k++) box(g, dark, 0.052, 0.006, 0.008, 0, 0.005, -0.655 - k * 0.014, 0, 0.002);
    box(g, poly, 0.044, 0.14, 0.07, 0, -0.11, -0.19, 0.22, 0.012);          // magazine
    box(g, glow, 0.046, 0.01, 0.016, 0, -0.16, -0.205, 0.22, 0.003);        // ammo counter strip
    box(g, poly, 0.04, 0.095, 0.05, 0, -0.08, 0.0, -0.3, 0.012);            // grip
    box(g, dark, 0.008, 0.035, 0.05, 0, -0.055, -0.045, 0, 0.003);          // trigger guard
    box(g, poly, 0.052, 0.075, 0.15, 0, -0.008, 0.12, 0, 0.02);             // stock
    box(g, glove, 0.058, 0.09, 0.025, 0, -0.008, 0.2, 0, 0.01);             // butt pad
    box(g, metal, 0.03, 0.03, 0.06, 0.04, -0.01, -0.42, 0, 0.006);          // laser module
    box(g, glow, 0.012, 0.012, 0.003, 0.04, -0.01, -0.452, 0, 0.002);
    // holo sight: a frame you look through, with a glowing red reticle
    box(g, dark, 0.05, 0.012, 0.075, 0, 0.065, -0.1, 0, 0.004);
    box(g, metal, 0.006, 0.045, 0.06, 0.024, 0.095, -0.1, 0, 0.003); box(g, metal, 0.006, 0.045, 0.06, -0.024, 0.095, -0.1, 0, 0.003);
    box(g, metal, 0.054, 0.006, 0.06, 0, 0.12, -0.1, 0, 0.003);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.04), lens); gl.position.set(0, 0.095, -0.12); g.add(gl);
    const rt = new THREE.Mesh(new THREE.RingGeometry(0.003, 0.0045, 16), reticle); rt.position.set(0, 0.095, -0.121); g.add(rt);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 8), reticle); dot.position.set(0, 0.095, -0.1215); g.add(dot);
    hands(g, 0.0, -0.4, -0.004);
    kits.trooper = { g, muzzle: -0.71, sightY: 0.095, port: [0.04, 0.012, -0.06], mag: 32, reload: 1.5 };
  }
  { // Juggernaut: a heavy tri-barrel plasma cannon with glowing coils and a power cell
    const g = new THREE.Group();
    box(g, metal, 0.12, 0.12, 0.4, 0, 0, -0.16, 0, 0.025);
    box(g, paint, 0.126, 0.06, 0.24, 0, 0.022, -0.17, 0, 0.018);
    rail(g, 0.28, 0.066, -0.16);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + Math.PI / 2;
      tube(g, metal, 0.02, 0.021, 0.32, Math.cos(a) * 0.034, Math.sin(a) * 0.034 + 0.005, -0.5, 12);
      tube(g, dark, 0.012, 0.012, 0.33, Math.cos(a) * 0.034, Math.sin(a) * 0.034 + 0.005, -0.5, 8);
    }
    for (let k = 0; k < 3; k++) ring(g, glow, 0.064, 0.008, 0, 0.005, -0.42 - k * 0.07);
    tube(g, edge, 0.068, 0.062, 0.05, 0, 0.005, -0.66, 18);
    tube(g, poly, 0.042, 0.042, 0.22, 0.092, -0.03, -0.12, 14);
    ring(g, glow, 0.044, 0.006, 0.092, -0.03, -0.06); ring(g, glow, 0.044, 0.006, 0.092, -0.03, -0.18);
    box(g, poly, 0.046, 0.1, 0.06, 0, -0.1, 0.0, -0.25, 0.014);
    box(g, poly, 0.06, 0.04, 0.12, 0, -0.085, -0.27, 0, 0.012);
    box(g, metal, 0.1, 0.095, 0.12, 0, -0.005, 0.1, 0, 0.022);
    box(g, dark, 0.05, 0.03, 0.08, 0, 0.09, -0.08, 0, 0.008);                  // sight block
    const rt = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.008, 16), reticle); rt.position.set(0, 0.11, -0.122); g.add(rt);
    hands(g, 0.0, -0.27, -0.065);
    kits.heavy = { g, muzzle: -0.7, sightY: 0.11, port: [0.07, 0.03, -0.1], mag: 8, reload: 2.0 };
  }
  { // Ranger: a long rail rifle with a big scope and a folding bipod
    const g = new THREE.Group();
    box(g, metal, 0.058, 0.078, 0.34, 0, 0, -0.12, 0, 0.012);
    box(g, paint, 0.062, 0.04, 0.2, 0, -0.016, -0.12, 0, 0.01);
    box(g, poly, 0.054, 0.064, 0.26, 0, -0.004, -0.42, 0, 0.016);
    for (let k = 0; k < 5; k++) box(g, glow, 0.058, 0.006, 0.022, 0, 0.012, -0.33 - k * 0.045, 0, 0.002);
    tube(g, metal, 0.013, 0.016, 0.4, 0, 0.0, -0.74, 12);
    tube(g, edge, 0.021, 0.021, 0.08, 0, 0.0, -0.96, 10);
    tube(g, dark, 0.028, 0.028, 0.24, 0, 0.1, -0.14, 18);
    tube(g, dark, 0.038, 0.028, 0.05, 0, 0.1, -0.28, 18);
    tube(g, dark, 0.034, 0.028, 0.04, 0, 0.1, -0.005, 18);
    ring(g, edge, 0.03, 0.004, 0, 0.1, -0.2);
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.033, 18), lens); l.position.set(0, 0.1, -0.306); l.rotation.y = Math.PI; g.add(l);
    box(g, metal, 0.02, 0.05, 0.026, 0, 0.06, -0.08, 0, 0.005); box(g, metal, 0.02, 0.05, 0.026, 0, 0.06, -0.2, 0, 0.005);
    box(g, poly, 0.038, 0.1, 0.045, 0, -0.08, 0.0, -0.3, 0.012);
    box(g, poly, 0.04, 0.1, 0.06, 0, -0.1, -0.16, 0.15, 0.012);
    box(g, poly, 0.046, 0.03, 0.2, 0, 0.02, 0.15, 0, 0.01); box(g, poly, 0.046, 0.03, 0.18, 0, -0.06, 0.15, 0.25, 0.01); box(g, glove, 0.05, 0.12, 0.028, 0, -0.02, 0.255, 0, 0.01);
    box(g, edge, 0.01, 0.01, 0.16, 0.018, -0.05, -0.5, 0, 0.003); box(g, edge, 0.01, 0.01, 0.16, -0.018, -0.05, -0.5, 0, 0.003);
    hands(g, 0.0, -0.42, -0.008);
    kits.sniper = { g, muzzle: -1.0, sightY: 0.1, port: [0.035, 0.01, -0.08], mag: 5, reload: 2.2 };
  }
  for (const k in kits) { kits[k].g.visible = false; viewmodel.add(kits[k].g); }
  viewmodel.userData.kits = kits;
  viewmodel.userData.wing = { material: sleeve };
  viewmodel.userData.brass = brass;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.71); viewmodel.add(muzzle);
  viewmodel.userData.muzzle = muzzle;
  const port = new THREE.Object3D(); viewmodel.add(port); viewmodel.userData.port = port;
  const flash = new THREE.Group();
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.6, 3.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) { // a star of crossed quads plus a forward cone
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), flashMat); q.rotation.z = k * Math.PI / 4; flash.add(q);
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 8, 1, true), flashMat); cone.rotation.x = -Math.PI / 2; cone.position.z = -0.1; flash.add(cone);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  flash.add(core);
  flash.position.set(0, 0.005, -0.75); flash.visible = false; viewmodel.add(flash);
  viewmodel.userData.flash = flash;
  // the muzzle flash lights up the gun, your hands and the ground around you for a frame
  const flashLight = new THREE.PointLight(0x9fdcff, 0, 7, 2); flashLight.position.set(0, 0.05, -0.8); viewmodel.add(flashLight);
  viewmodel.userData.flashLight = flashLight;
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
  viewmodel.userData.kit = kit;
  viewmodel.userData.muzzle.position.z = kit.muzzle;
  viewmodel.userData.flash.position.z = kit.muzzle - 0.04;
  viewmodel.userData.flashLight.position.z = kit.muzzle - 0.1;
  viewmodel.userData.port.position.set(...kit.port);
}


const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();

function possess(u) {
  if (turn.on && !turn.live) return; // the campaign is played from the command view, except during a live drop-in
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
  fps.vx = fps.vz = fps.recoil = fps.bloom = fps.vy = fps.burstLeft = 0; fps.target = null; fps.dash = null; u.y = 0; fps.lastYaw = fps.yaw; fps.lastPitch = fps.pitch;
  viewmodel.userData.wing.material.color.copy(u.bodyMat.color).multiplyScalar(0.7);
  setViewGun(u.type);
  if (u.ammo === undefined) u.ammo = viewmodel.userData.kit.mag;
  fps.reloadT = 0; fps.adsWant = false;
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
  if (tac.on || turn.on) { toast('One hero per round', 1); return; }
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
  u.ult = Math.min(100, before + amt * (u.ultRate || 1));
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

function startReload(u) {
  const kit = viewmodel.userData.kit;
  if (!u || fps.reloadT > 0 || u.ammo >= kit.mag) return;
  fps.reloadT = fps.reloadMax = kit.reload;
  gunSound('reload');
}
function playerShoot(u) {
  const gun = GUNS[u.type];
  const kit = viewmodel.userData.kit;
  if (fps.reloadT > 0) return;
  if (u.ammo <= 0) { fps.burstLeft = 0; startReload(u); return; }
  u.ammo--;
  if (gun.burst) { if (!(fps.burstLeft > 0)) fps.burstLeft = gun.burst; fps.burstLeft--; }
  u.cool += gun.burst && fps.burstLeft > 0 ? gun.burstGap : gun.rate; if (u.cool < 0) u.cool = 0; // keeps the fire rate exact at any frame rate
  camera.updateMatrixWorld(true);
  const targets = (hawk.t > 0 ? [ground] : staticShootables).concat(entities.filter(e => !e.dead && !e.possessed).map(e => e.mesh));
  const mz = fps.scoped ? camera.position.clone().add(new THREE.Vector3(0, -0.15, 0)) : viewmodel.userData.muzzle.getWorldPosition(new THREE.Vector3());
  const spreadBase = fps.scoped ? 0.0008 : gun.spread * (1 + fps.bloom * 1.5) * (1 - 0.65 * fps.ads);
  let hits = 0, killed = false, crits = 0;
  for (let i = 0; i < gun.pellets; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spreadBase;
    raycaster.setFromCamera({ x: Math.cos(a) * r, y: Math.sin(a) * r }, camera);
    raycaster.far = 120;
    let hit = raycaster.intersectObjects(targets, true)[0];
    if (gun.magnet && !(hit && hit.object.userData.entity && hit.object.userData.entity.team !== u.team)) { // bullet magnetism
      const m = magnetTarget(u, raycaster.ray, gun.magnet * (isTouch ? 1.6 : 1) * (1 + fps.ads * 0.4));
      if (m) {
        const o = raycaster.ray.origin.clone(), dir = new THREE.Vector3(m.x, 0.6 * (m.baseScale || 1), m.z).sub(o).normalize();
        raycaster.set(o, dir);
        const h2 = raycaster.intersectObjects(targets, true)[0];
        if (h2 && h2.object.userData.entity === m) hit = h2;
      }
    }
    const end = hit ? hit.point.clone() : raycaster.ray.at(120, new THREE.Vector3());
    const ent = hit && hit.object.userData.entity;
    const enemy = ent && ent.team !== u.team ? ent : null;
    if (enemy) {
      let dmg = gun.dmg;
      const crit = !!hit.object.userData.prec;
      if (crit) { dmg *= gun.prec; crits++; }
      const hpBefore = enemy.hp;
      const wasShielded = enemy.isBase && enemy.shield;
      damage(enemy, dmg, u);
      if (!wasShielded) dmgNumber(end, dmg, crit);
      if (enemy.dead) { killed = true; chargeUlt(u, 10); killPop(enemy, crit); }
      hits++;
      if (!enemy.isBase) fps.target = { e: enemy, t: 2.2, trail: Math.max(fps.target && fps.target.e === enemy ? fps.target.trail : 0, hpBefore / enemy.maxHp) };
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
      else { impactPuff(end, surf, gun.pellets > 1 ? 2 : 4); if (surf !== 0x8a5a3c) burst(end.x, end.y, end.z, 0.16, 0xffc070); } // sparks off metal
    }, gun.pellets > 1 ? 0.8 : 1.2);
  }
  if (hits) { fps.hitMarker = 0.14; fps.critMarker = crits ? 0.18 : 0; gunSound(killed ? 'kill' : crits ? 'crit' : 'hit'); }
  if (killed) fps.killMarker = 0.5;
  viewmodel.userData.flashLight.intensity = gun.pellets > 1 ? 9 : 6;
  // feel: flash, light, kick, shake, bloom, a popcorn shell
  const fl = viewmodel.userData.flash;
  fl.visible = true; fl.scale.setScalar((gun.pellets > 1 ? 1.8 : 1) * (0.8 + Math.random() * 0.7)); fl.rotation.z = Math.random() * 6;
  fps.flash = 0.05;
  const steady = 1 - 0.45 * fps.ads;
  // predictable recoil: straight up with a small, consistent drift to the right, settling back fast
  fps.recoil += gun.kick * (0.9 + Math.random() * 0.2) * steady;
  fps.yaw -= (gun.drift + (Math.random() - 0.5) * gun.kick * 0.12) * steady;
  fps.vmRoll = (Math.random() - 0.5) * 0.12;
  fps.vmKick = Math.min(1.5, fps.vmKick + (gun.pellets > 1 ? 1.4 : u.type === 'sniper' ? 1.2 : 0.55));
  fps.shake = Math.min(0.3, fps.shake + gun.shake);
  fps.bloom = Math.min(1, fps.bloom + (u.type === 'trooper' || u.type === 'elite' ? 0.08 : 0.5));
  if (!fps.scoped) { // a hot casing flips out of the ejection port
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const port = viewmodel.userData.port.getWorldPosition(new THREE.Vector3());
    spawnDebris(port, right.multiplyScalar(1.6 + Math.random() * 1.2).add(new THREE.Vector3(0, 1.8 + Math.random(), 0)), 0xc8a050, 0.028, 1.2);
  }
  gunSound(u.type);
  if (u.ammo <= 0) setTimeout(() => { if (possessed === u) startReload(u); }, 120);
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
  const sp = u.speed * 1.15 * (fps.scoped ? 0.45 : 1) * (1 - 0.35 * fps.ads);
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
  if (fps.reloadT > 0) { fps.reloadT -= dt; if (fps.reloadT <= 0) { u.ammo = viewmodel.userData.kit.mag; gunSound('ready'); } }
  if ((fps.firing || fps.burstLeft > 0) && fps.reloadT <= 0) { let n = 0; while (u.cool <= 0 && n++ < 3 && (fps.firing || fps.burstLeft > 0)) playerShoot(u); } // catch up on slow frames; a burst always finishes
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
// title screen: a slow cinematic dolly behind the squad, looking out at the hive under the alien sky
const menuLook = new THREE.Vector3();
function menuPose() {
  const t = performance.now() / 1000;
  const a = Math.sin(t * 0.05) * 0.5;
  dummy.position.set(Math.sin(a) * 6 + 13, 3.4 + Math.sin(t * 0.13) * 0.4, 20 + Math.cos(a) * 2);
  menuLook.set(Math.sin(a) * 3 - 3, 2.4, -16);
  dummy.lookAt(menuLook);
  return { pos: dummy.position.clone(), quat: dummy.quaternion.clone(), fov: 46 };
}
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
function fpsPose() {
  const u = possessed;
  const bob = Math.sin(fps.bob) * 0.04;
  const sh = fps.shake;
  euler.set(fps.pitch + fps.recoil + (Math.random() - 0.5) * sh * 0.08, fps.yaw + (Math.random() - 0.5) * sh * 0.08, (Math.random() - 0.5) * sh * 0.04);
  const roll = fps.dash && fps.dash.roll ? Math.sin((0.32 - fps.dash.t) / 0.32 * Math.PI) : 0;
  return { pos: new THREE.Vector3(u.x + (Math.random() - 0.5) * sh * 0.05, (u.y || 0) + EYE + bob - roll * 0.7, u.z), quat: new THREE.Quaternion().setFromEuler(euler), fov: fps.scoped ? 22 : 72 - 20 * fps.ads };
}

function setMode(m, arc = 0) {
  const prev = mode;
  mode = m;
  document.body.classList.toggle('fps', m === 'fps');
  document.body.classList.toggle('inMenu', m === 'menu');
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
  const pose = mode === 'fps' && possessed ? fpsPose() : mode === 'menu' ? menuPose() : turn.cam ? actionPose() : rtsPose();
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
  // aim down sights: slide the sight onto the crosshair; reload: dip and tilt the gun
  const wantAds = fps.adsWant || (isTouch && fps.firing) ? (isTouch && !fps.adsWant ? 0.55 : 1) : 0;
  fps.ads += ((fps.reloadT > 0 ? 0 : wantAds) - fps.ads) * Math.min(1, dt * 13);
  const kitNow = viewmodel.userData.kit;
  const rl = fps.reloadT > 0 ? Math.sin(Math.min(1, 1 - fps.reloadT / fps.reloadMax) * Math.PI) : 0;
  const vs = portrait ? 0.42 : 0.5;
  viewmodel.scale.setScalar(vs);
  fps.vmRoll = (fps.vmRoll || 0) * Math.exp(-dt * 12);
  viewmodel.userData.flashLight.intensity *= Math.exp(-dt * 40);
  viewmodel.position.set(
    (portrait ? 0.09 : 0.17) + fps.swayX + Math.cos(fps.bob * 0.5) * 0.012 * walk,
    (portrait ? -0.12 : -0.17) + fps.swayY - Math.abs(Math.sin(fps.bob * 0.5)) * 0.014 * walk - fps.vmKick * 0.012,
    -0.35 + fps.vmKick * 0.07);
  const hipX = viewmodel.position.x, hipY = viewmodel.position.y, a = fps.ads;
  viewmodel.position.x = hipX * (1 - a) + fps.swayX * 0.3 * a;
  viewmodel.position.y = hipY * (1 - a) + (-(kitNow ? kitNow.sightY : 0.1) * vs - fps.vmKick * 0.006) * a - rl * 0.12;
  viewmodel.position.z += -0.04 * a + rl * 0.05;
  viewmodel.rotation.set(fps.vmKick * (0.18 - 0.1 * a) - rl * 0.7, fps.swayX * 1.5 * (1 - 0.7 * a), -fps.swayX * 2 * (1 - 0.7 * a) + fps.vmRoll + rl * 0.5);
  fps.flash -= dt;
  if (fps.flash <= 0) viewmodel.userData.flash.visible = false;
  const ch = $('crosshair');
  ch.style.transform = fps.scoped ? '' : `scale(${1 + fps.bloom * 0.9})`;
  ch.style.opacity = fps.scoped ? 1 : Math.max(0, 1 - fps.ads * 1.6); // the holo sight takes over when aiming
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
    if (e.dead || hiddenFoe(e)) continue;
    if (turn.on && e.team === PLAYER && turn.sel && turn.sel.ap > 0) { // don't steal a move order aimed right next to a marine
      const s = toScreen(e.x, 0.9 * (e.big || 1), e.z); if (Math.hypot(s.x - sx, s.y - sy) > 20) continue;
    }
    const s = toScreen(e.x, e.isBase ? 1.6 : 0.8 * (e.big || 1), e.z);
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
  if (mode === 'rts' && !turn.on && (e.button === 0 || e.pointerType === 'touch') && pointers.size === 1) {
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
    else if (e.button === 2 && possessed) { if (possessed.type === 'sniper') useAbility(0); else fps.adsWant = true; }
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
    if (turn.on) { gesture = { mx: p.x, my: p.y, dist: 0, touch: false }; return; } // in the campaign one finger pans the map
    if (p.unit && !p.unit.dead) {
      if (!orderDrag) { if (!selection.includes(p.unit)) { selection = [p.unit]; updateButtons(); } }
      orderDrag = { x: p.x, y: p.y };
    } else boxSel = { x0: p.sx, y0: p.sy, x1: p.x, y1: p.y };
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (mode === 'fps') { if (e.pointerType === 'mouse' && e.button === 0) fps.firing = false; if (e.pointerType === 'mouse' && e.button === 2) fps.adsWant = false; return; } // a lifted look finger must not stop the FIRE button
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
  if (turn.on) { turnTap(ent, gp, { secondary, touch }); return; }
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
  if (mode === 'rts' && turn.on) turnKey(e.code);
  else if (mode === 'rts' && tac.on) {
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
    else if (e.code === 'KeyR') startReload(possessed);
    else if (e.code === 'KeyG') rally();
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
tapButton($('btnGfx'), () => { gfx.auto = false; setGfx((gfx.level + 1) % 3); });
for (const t of [groundTex.col, groundTex.nrm, plateTex.col, rockTex.col]) { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; } // crisp ground at grazing angles
setGfx(gfx.level, null, false);
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
  $('selInfo').textContent = sel.length === 1 && sel[0].callsign ? `${sel[0].callsign} · ${NAMES[PLAYER][sel[0].type]}` : sel.length ? `${sel.length} selected · ${Object.entries(counts).map(([t, n]) => `${n} ${NAMES[PLAYER][t].toLowerCase()}`).join(', ')}` : 'No marines selected';
  renderPortraits(sel);
  $('btnAMove').classList.toggle('armed', amoveArmed);
}

// unit card: one portrait per selected bird with health, level and hero star. Tap one to pick just that bird.
const ICONS = { trooper: '🪖', heavy: '🛡️', sniper: '🎯', turret: '🔫', mortar: '💥', scarecrow: '🌀' };
let portraitUnits = [];
function renderPortraits(sel) {
  const box = $('portraits'); if (!box) return;
  portraitUnits = sel.slice(0, 24);
  box.innerHTML = portraitUnits.map((u, i) => `<button class="pt${u === tac.hero ? ' hero' : ''}" data-i="${i}" title="${u.callsign || nameOf(u)}"><i>${ICONS[u.type] || '🐤'}</i>${u.rank ? `<u>${['', '▲', '▲▲', '★'][u.rank]}</u>` : ''}${(u.lvl || 1) > 1 ? `<b>${'★'.repeat(u.lvl - 1)}</b>` : ''}<em><s style="width:${Math.round(Math.max(0, u.hp / u.maxHp) * 100)}%"></s></em></button>`).join('')
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
  const timer = camp.m && camp.m.story ? '' : tac.on || turn.on ? `<span class="chip">👾 ${countUnits(ENEMY)} vs 🪖 ${countUnits(PLAYER)}</span>` : `<span class="chip">👾 wave in ${Math.ceil(waveTimer)}s</span>`;
  $('status').innerHTML = `<span class="nests">${points.map(nest).join('')}</span>${bar('Outpost', pb, 'ours')}${bar('Hive', eb, 'enemy', enemyBase.shield ? '<i title="Bio-shield: hold all 3 relays">🛡</i>' : '<i title="Cracked!">💥</i>')}${timer}${campaignObjective()}`;
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
  if (!(camp.m && camp.m.story) && !turn.on) setTimeout(() => radio('Only YOU can capture a relay: drop into a marine and stand on relay B', 'good', { dropAt: points[1] }), 1200);
}

function endGame(won, text) {
  if (mode === 'over') return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (possessed) { possessed.possessed = false; possessed.mesh.visible = true; possessed = null; }
  setMode('over');
  document.body.classList.remove('fps', 'scoped');
  $('overTitle').textContent = won ? 'Hive destroyed!' : 'Outpost overrun.';
  $('overText').textContent = text || (won ? `The hive burned after ${waveNum} waves. The colony is safe.` : `The swarm overran the outpost during wave ${waveNum}.`);
  if (camp.m && camp.m.story && !won) { // a story mission restarts from its last checkpoint; nobody is lost for good on a failed attempt
    camp.done = true;
    $('overTitle').textContent = 'Squad lost';
    $('overDebrief').innerHTML = `<p class="recruits">Restart from <b>${STORIES[camp.m.story][story.checkpoint].name}</b> with the same marines.</p>`;
    $('btnRetryCp').classList.remove('hidden'); $('btnToMap').classList.remove('hidden'); $('btnRestart').classList.add('hidden');
  } else if (camp.m) { // campaign: write the results into the squad and show the debrief
    const d = campaignEnd(won);
    $('overTitle').textContent = d.title;
    $('overDebrief').innerHTML = d.html;
    $('btnToMap').classList.remove('hidden'); $('btnRestart').classList.add('hidden');
  }
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
  if (!canPlace(x, z)) { toast('Build on open ground on your half of the map', 1.2); return false; }
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
    const n = Math.min(2 + tac.round + ((camp.m && camp.m.surge) || 0), ENEMY_CAP - countUnits(ENEMY));
    for (let i = 0; i < n; i++) {
      const type = i % 4 === 3 ? 'sniper' : i % 3 === 2 ? 'heavy' : 'trooper';
      const h = makeUnit(ENEMY, type, (Math.random() - 0.5) * 10, -20 - Math.random() * 2);
      if (tac.round >= 4) { h.maxHp = h.hp = Math.round(h.maxHp * (1 + (tac.round - 3) * 0.12)); }
    }
    const tyr = tac.round % ((camp.m && camp.m.tyrantEvery) || 5) === 0;
    if (tyr && !entities.some(e => e.elite && !e.dead)) makeUnit(ENEMY, 'elite', 0, -20);
    radio(`+${income} ore (${held} relay${held === 1 ? '' : 's'} held) · ${n} new aliens${tyr ? ' and the Hive Tyrant' : ''}`, 'good');
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
  if (t.startsWith('place:')) toast(`${isTouch ? 'Tap' : 'Click'} your half of the map to build the ${NAMES[PLAYER][t.slice(6)]}`, 1.4);
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
  if (planning && tac.tool.startsWith('place:')) {
    // tapping a unit, or right-clicking, cancels building so the board never gets stuck in build mode
    if (secondary) { setTool('move'); return; }
    if (ent && ent.team === PLAYER) setTool('move');
    else {
      const type = tac.tool.slice(6);
      if (gp && placeTower(type, gp.x, gp.z) && !shift) setTool('move');
      return;
    }
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
  storyOverlay();
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
    if (e.dead || e.possessed || hiddenFoe(e)) continue;
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
      if (!(camp.m && camp.m.story)) octx.fillText(`BIO-SHIELD · hold ${points.length - playerPointCount()} more relay${points.length - playerPointCount() === 1 ? '' : 's'}`, s.x, s.y - 6);
    }
    if (e.armorT > 0) { octx.fillStyle = '#7fb8ff'; octx.fillRect(s.x - w / 2, s.y + h + 1, w, 2); }
    if (e.stunT > 0) { octx.font = '14px system-ui'; octx.fillText('💫', s.x, s.y - 6); }
    if (e.lvl > 1) { octx.font = '700 10px system-ui'; octx.fillStyle = '#ffd84a'; octx.fillText('★'.repeat(e.lvl - 1), s.x, s.y - 3); }
  }
  if (turn.on) drawTurnUI(); else drawOrderUI();
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
    octx.strokeStyle = kill ? '#ff4a3a' : fps.critMarker > 0 ? '#ffd84a' : '#ffffff'; octx.lineWidth = kill ? 3.5 : fps.critMarker > 0 ? 3 : 2;
    octx.beginPath();
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { octx.moveTo(cx + a * 7 * g, cy + b * 7 * g); octx.lineTo(cx + a * 15 * g, cy + b * 15 * g); }
    octx.stroke();
  }
  if (mode === 'fps' && fps.target && fps.target.t > 0) { // the last thing you shot: a health bar that drains in two steps
    const T = fps.target, e = T.e;
    if (!e.dead) {
      const s = toScreen(e.x, barY(e), e.z);
      if (!s.behind) {
        const w = 54, hpf = Math.max(0, e.hp / e.maxHp);
        octx.globalAlpha = Math.min(1, T.t * 2);
        octx.fillStyle = 'rgba(0,0,0,.6)'; octx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, 7);
        octx.fillStyle = '#ffffff'; octx.fillRect(s.x - w / 2, s.y, w * T.trail, 5);
        octx.fillStyle = e.elite || e.type === 'elite' ? '#ffb020' : '#ff5a3c'; octx.fillRect(s.x - w / 2, s.y, w * hpf, 5);
        octx.globalAlpha = 1;
      }
    }
  }
  {
    octx.textAlign = 'center';
    for (const n of dmgNums) {
      if (mode !== 'fps' && !n.color) continue; // damage numbers only in first person, pickup labels everywhere
      const s = toScreen(n.x, n.y + (0.8 - n.life) * 1.2, n.z);
      if (s.behind) continue;
      octx.globalAlpha = Math.min(1, n.life * 3);
      octx.font = `900 ${n.crit ? 22 : 15}px system-ui`;
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.7)';
      octx.strokeText(n.text, s.x + n.dx * (0.8 - n.life), s.y);
      octx.fillStyle = n.color || (n.crit ? '#ffd84a' : '#f4f6f8');
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
  const mk = storyMarker();
  if (mk) { mctx.fillStyle = '#5fd0ff'; mctx.save(); mctx.translate(X(mk.x), X(mk.z)); mctx.rotate(Math.PI / 4); mctx.fillRect(-4, -4, 8, 8); mctx.restore(); }
  mctx.lineWidth = 1;
  for (const e of entities) {
    if (e.dead || hiddenFoe(e)) continue;
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
  $('cpText').innerHTML = tac.on || turn.on ? `💠 <b>${Math.floor(game.cp)}</b>` : `💠 <b>${Math.floor(game.cp)}</b> <small>+${income.toFixed(1)}/s</small>`;
  for (const [id, t] of [['btnBuyTrooper', 'trooper'], ['btnBuyHeavy', 'heavy'], ['btnBuySniper', 'sniper']]) $(id).classList.toggle('off', game.cp < COSTS[t]);
  setLabel('btnPossess', game.relink > 0 ? `Drop in ${Math.ceil(game.relink)}s` : 'Drop in');
  $('btnPossess').classList.toggle('off', game.relink > 0);
  if (possessed) {
    const k = Math.max(0, possessed.hp / possessed.maxHp);
    $('fpsHpFill').style.width = `${k * 100}%`;
    $('fpsHpText').textContent = `${(possessed.callsign || nameOf(possessed)).toUpperCase()}  ${Math.ceil(possessed.hp)} / ${possessed.maxHp}  ·  ${turn.live ? `LIVE ${Math.max(0, Math.ceil(turn.liveT))}s` : "hero"}`;
    { // ammo counter
      const kit = viewmodel.userData.kit, el = $('ammo');
      if (kit) {
        const rel = fps.reloadT > 0;
        $('ammoN').textContent = rel ? 'RELOADING' : possessed.ammo; $('ammoMax').textContent = rel ? '' : `/ ${kit.mag}`;
        $('ammoBar').style.transform = `scaleX(${rel ? 1 - fps.reloadT / fps.reloadMax : possessed.ammo / kit.mag})`;
        el.classList.toggle('reload', rel); el.classList.toggle('low', !rel && possessed.ammo <= kit.mag * 0.25);
      }
    }
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
  if (e.pulse) e.pulse.scale.setScalar(0.32 + Math.sin(now / 260 + e.animT) * 0.06);
  if (e.eyes && alien) { const b = 1.5 + Math.sin(now / 300 + e.animT) * 0.5; for (const ey of e.eyes) ey.scale.z = 0.03 * b; }
}

// ---------------------------------------------------------------- main loop
function simulate(simDt, dt) {
  game.time += simDt;
  if (!tac.on && !turn.on) game.cp = Math.min(CP_MAX, game.cp + (CP_BASE + CP_PER_POINT * playerPointCount()) * simDt);
  if (game.relink > 0) game.relink -= simDt;
  if (mode === 'fps') updateFPS(dt, simDt);
  for (const e of entities) if (!e.dead && !e.isBase) updateUnit(e, simDt);
  separate();
  if (!turn.on || turn.live) updatePoints(simDt);
  if (tac.on) updateRound(simDt);
  else if (!turn.on) { updateEnemyOrders(simDt); updateBases(simDt); }
  updateGrenades(simDt);
  updateBullets(simDt);
  updateLoot(simDt);
  updateWall(simDt);
  updateDucklings(simDt);
  hawk.t -= simDt;
  entities = entities.filter(e => !e.dead);
  selection = selection.filter(e => !e.dead);
}
// ---------------------------------------------------------------- turn-based squad tactics (the campaign): both sides take turns
// Each marine has 2 action points: move (1), dash (2), or move then shoot. Shooting, overwatch, hunkering and grenades end its turn.
// Hit chance comes from aim, range and cover (half or full, measured from the shooter's side); a target without cover is flanked
// and easier to crit. Then every alien that has spotted you acts, and overwatch fires at anything that moves in range.
const TBS = {
  trooper: { move: 8, dmg: [22, 30] }, heavy: { move: 6.5, dmg: [34, 46] }, sniper: { move: 7, dmg: [44, 58] }, elite: { move: 9, dmg: [30, 42] },
  burrower: { move: 11, dmg: [38, 50] }, shielder: { move: 6, dmg: [16, 22] }, eggsac: { move: 0, dmg: [0, 0] },
};
// perks: at each promotion a marine picks one of two (on the sector map). Effects are read straight off u.perks.
const PERKS = {
  sprint: { name: 'Sprinter', text: '+3 move' },
  grenade: { name: 'Grenadier', text: '+1 frag grenade' },
  shred: { name: 'Shredder', text: '+15% crit chance' },
  hunter: { name: 'Flanker', text: '+15 aim against flanked aliens' },
  rapid: { name: 'Double tap', text: 'Shooting as your first action leaves 1 action' },
  reflex: { name: 'Lightning reflexes', text: 'Overwatch shots at you get −25 aim' },
  iron: { name: 'Iron skin', text: 'Takes 25% less damage' },
  breach: { name: 'Breacher', text: '+20 aim within 6m' },
  squad: { name: 'Squadsight', text: 'Shoot any alien in sight, any range (−10 aim past range)' },
  deadeye: { name: 'Deadeye', text: '+10 aim' },
};
const PERK_TREE = {
  trooper: [['sprint', 'grenade'], ['shred', 'hunter'], ['rapid', 'reflex']],
  heavy: [['iron', 'breach'], ['sprint', 'hunter'], ['shred', 'reflex']],
  sniper: [['squad', 'deadeye'], ['rapid', 'hunter'], ['shred', 'reflex']],
};
const hasPerk = (u, k) => !!(u.perks && u.perks.includes(k));
const moveR = u => (TBS[u.type] || TBS.trooper).move + (hasPerk(u, 'sprint') ? 3 : 0);
// class abilities in turns
const ABIL = { trooper: { name: 'Grenade' }, heavy: { name: 'Shield wall', cd: 3 }, sniper: { name: 'Aimed shot', cd: 2 } };
const FOCUS_MAX = 4, LIVE_COST = 2;
const TB_ALIEN_DMG = 0.62, TB_BASE_DMG = 3; // aliens hit a bit softer; the hive takes triple damage so it can be burned in a few turns
const turn = { fp: 2, fast: false, tut: -1, live: false, liveT: 0, liveUsed: false, on: false, side: 'player', n: 1, sel: null, busy: false, tool: 'move', pending: null, hover: null, hoverKey: '', cam: null, focusT: 0, focus: new THREE.Vector3(), spawnT: 0 };
const tbSurvive = st => Math.ceil(st.survive / 12);
const wait = ms => new Promise(r => setTimeout(r, ms * (window.__tbFast || 1) * (turn.fast && turn.side === 'enemy' ? 0.35 : 1)));
try { turn.fast = localStorage.getItem('hivefall.fast') === '1'; } catch (e) { /* default off */ }
// fog of war: an alien is seen while a marine has it in sight (or it just revealed itself by attacking)
const sightR = () => (camp.m && camp.m.fog ? 11 : 16);
function hiddenFoe(e) { return turn.on && !turn.live && e.team === ENEMY && !e.isBase && !e.seen; }
function tbVision() {
  const mine = tbMine(), R = sightR();
  for (const h of tbFoes()) h.seen = !h.burrowed && ((h.revealN || 0) >= turn.n || mine.some(u => Math.hypot(u.x - h.x, u.z - h.z) < R && tbLOS(u, h)));
}
// soldier barks on the radio
const BARKS = {
  kill: ['Target down!', 'Got it!', 'Scratch one!', 'That one\'s done.', 'Stay down!'],
  crit: ['Right in the eye!', 'Clean hit!', 'Did you see that?'],
  miss: ['Missed!', 'Damn, it moved!', 'Can\'t get a bead!'],
  hurt: ['I\'m hit!', 'Argh, it got me!', 'Taking fire!'],
  down: ['Man down!', 'We lost one!', 'No! Not like this!'],
  contact: ['Contacts!', 'Movement ahead!', 'They\'re here!'],
  ow: ['Overwatch, firing!', 'Got movement, engaging!'],
  live: ['Going in!', 'I\'ve got this.', 'Cover me!'],
};
function bark(u, kind) {
  if (!u || Math.random() < 0.25) return;
  const lines = BARKS[kind], line = lines[Math.floor(Math.random() * lines.length)];
  radio(`${u.callsign || nameOf(u)}: "${line}"`, kind === 'hurt' || kind === 'down' ? 'warn' : 'good', { key: 'bark', gap: 1.5 });
}
const tbMine = () => entities.filter(e => !e.dead && e.team === PLAYER && !e.isBase && !e.isTower);
const tbFoes = () => entities.filter(e => !e.dead && e.team === ENEMY && !e.isBase);

const TB_MARINE_SCALE = 2, TB_ALIEN_SCALE = 1.5;
function startTurns() {
  turn.on = true; turn.n = 1; turn.side = 'player';
  document.body.classList.add('xcom');
  for (const u of tbMine()) { u.ap = 2; u.gren = u.type === 'trooper' ? 1 + (hasPerk(u, 'grenade') ? 1 : 0) : 0; }
  turn.fp = 2;
  tbUISetup();
  startGame();
  setTimeout(tutStart, 1500);
  toast(isTouch ? 'Tap a marine, then a spot or an alien' : 'Click a marine, then a spot or an alien', 3.5);
  setTimeout(() => beginPlayerTurn(true), 400);
}
// line of sight that lets you lean out from cover: a box hugging either end of the line does not block it
function tbLOS(a, b, ax = a.x, az = a.z) {
  for (const box of boxes) {
    if (box.owner === b || box.owner === a) continue;
    if (!segHitsBox(ax, az, b.x, b.z, box)) continue;
    const near = (x, z) => Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minZ - z, 0, z - box.maxZ)) < 1.5;
    if (near(ax, az) || near(b.x, b.z)) continue;
    return false;
  }
  return true;
}
// cover the target has against a shooter at (sx, sz): 0 none (flanked), 1 half (low barriers), 2 full (containers, huts, rock)
function coverFrom(tx, tz, sx, sz) {
  const d = Math.hypot(sx - tx, sz - tz) || 1, ux = (sx - tx) / d, uz = (sz - tz) / d;
  let best = 0;
  for (const b of boxes) {
    if (b.owner) continue;
    if (Math.hypot(Math.max(b.minX - tx, 0, tx - b.maxX), Math.max(b.minZ - tz, 0, tz - b.maxZ)) > 1.4) continue;
    if (!segHitsBox(tx, tz, tx + ux * 1.9, tz + uz * 1.9, b)) continue;
    best = Math.max(best, (b.h ?? 3) >= 2 ? 2 : 1);
  }
  return best;
}
function shotInfo(a, t, ax = a.x, az = a.z, overwatch = false, aimed = false) {
  if (a.type === 'eggsac' || a.burrowed) return null;
  if (a.team === PLAYER && hiddenFoe(t)) return null;
  const d = Math.hypot(t.x - ax, t.z - az) - (t.isBase ? t.radius : 0);
  if (a.type === 'burrower') return d <= 2.6 ? { chance: 85, crit: 20, cover: 0, d, melee: true } : null; // claws ignore cover
  const squad = hasPerk(a, 'squad') && t.seen;
  const maxR = squad ? 99 : a.range * (a.type === 'sniper' ? 2 : 1.5);
  if (d > maxR || !tbLOS(a, t, ax, az)) return null;
  if (t.isBase) return { chance: 95, crit: 0, cover: 0, d };
  let aim = a.acc * 100 * (a.team === ENEMY ? 0.85 : 1);
  if (d > a.range) aim -= squad && d > a.range * 2 ? 10 + a.range * 3 : (d - a.range) * 3;
  if (a.type === 'heavy' && d < 5) aim += 15;
  if (a.type === 'sniper' && d < 4) aim -= 15;
  const cover = coverFrom(t.x, t.z, ax, az);
  aim -= [0, 20, 40][cover] + (t.hunker ? (cover ? 20 : 10) : 0) + (t.wall ? 20 : 0);
  if (overwatch) aim -= 15 + (hasPerk(t, 'reflex') ? 25 : 0);
  if (hasPerk(a, 'deadeye')) aim += 10;
  if (hasPerk(a, 'breach') && d < 6) aim += 20;
  if (hasPerk(a, 'hunter') && !cover) aim += 15;
  if (aimed) aim += 20;
  const crit = (cover ? 10 : 45 + (a.type === 'sniper' ? 15 : 0)) + (hasPerk(a, 'shred') ? 15 : 0) + (aimed ? 20 : 0);
  return { chance: Math.round(Math.max(5, Math.min(95, aim))), crit: Math.min(100, crit), cover, d };
}
function tbDamage(a) {
  const s = TBS[a.type] || TBS.trooper;
  const k = a.dmg / TYPES[a.type].dmg * (a.team === ENEMY && !a.elite ? TB_ALIEN_DMG : 1);
  return Math.round((s.dmg[0] + Math.random() * (s.dmg[1] - s.dmg[0])) * k);
}
const pathLen = (u, path) => { let L = 0, x = u.x, z = u.z; for (const p of path) { L += Math.hypot(p.x - x, p.z - z); x = p.x; z = p.z; } return L; };
function floatText(x, z, text, color, big = false) {
  dmgNums.push({ x, y: 2.2, z, text, life: 1.6, crit: big, dx: 0, color });
}
function focusOn(x, z) { turn.focus.set(x, 0, z + (camera.aspect < 1 ? 2 : 0)); turn.focusT = 0.9; }

// ---- per frame: units walk their paths, overwatch reacts to anything that moves
function turnUnit(u, dt) {
  u.invulnT = (u.invulnT || 0) - dt;
  if (u.pauseT > 0) { u.pauseT -= dt; return; }
  if (!u.path) return;
  const sp = u.speed; u.speed *= u.burrowed || u.fastMove ? 3.5 : turn.fast && u.team === ENEMY ? 3.5 : 1.8;
  if (u.burrowed && Math.random() < 0.35) puff(u.x + (Math.random() - 0.5) * 0.6, 0.12, u.z + (Math.random() - 0.5) * 0.6, 0.7, 0x9a7058, 0.9, 0.4, 0.6); // something moves under the ground
  const done = moveAlong(u, dt);
  u.speed = sp;
  if (u.moving) for (const w of entities) {
    if (w.dead || !w.ow || w.team === u.team || w.isBase) continue;
    if (Math.hypot(w.x - u.x, w.z - u.z) > w.range * 1.3) continue;
    const info = shotInfo(w, u, w.x, w.z, true); if (!info) continue;
    w.ow = false; u.pauseT = 0.8;
    floatText(w.x, w.z, 'OVERWATCH', '#ffd36a', true);
    if (w.team === PLAYER) bark(w, 'ow');
    tbShoot(w, u, { overwatch: true, cam: false });
  }
  if (done || u.dead) { u.path = null; if (u.moveDone) { const f = u.moveDone; u.moveDone = null; f(); } }
}
function tbMove(u, x, z, path) {
  return new Promise(res => {
    u.path = path || findPath(u.x, u.z, x, z); u.pathGoal = { x, z }; u.order = { type: 'idle' };
    u.moveDone = res;
    const safety = setInterval(() => { if (u.dead || !u.path) { clearInterval(safety); if (u.moveDone) { u.moveDone = null; res(); } } }, 200);
  });
}
async function tbShoot(a, t, opt = {}) {
  if (a.team === ENEMY) { a.revealN = turn.n + 1; tbVision(); } // attacking gives an alien away
  const info = shotInfo(a, t, a.x, a.z, opt.overwatch, opt.aimed) || { chance: 5, crit: 0, cover: 0 };
  a.facing = facingFor(t.x - a.x, t.z - a.z);
  if (opt.cam !== false) setActionCam(a, t);
  await wait(opt.cam === false ? 120 : a.team === ENEMY ? 450 : 650);
  if (a.dead) { setActionCam(null); return; }
  a.facing = facingFor(t.x - a.x, t.z - a.z);
  const hit = Math.random() * 100 < info.chance, crit = hit && Math.random() * 100 < info.crit;
  (window.__tblog = window.__tblog || []).push(`${a.team ? 'alien' : 'marine'} ${a.type} > ${t.type || 'base'} ${info.chance}% ${hit ? 'hit' : 'miss'}`);
  let dmg = Math.round(tbDamage(a) * (crit ? 1.5 : 1) * (t.isBase ? TB_BASE_DMG : 1) * (hasPerk(t, 'iron') ? 0.75 : 1));
  if (info.melee) { // a burrower lunges
    a.fireT = 0.4; sfx('bawk', a.x, a.z);
    await wait(250);
    if (hit && !t.dead) { damage(t, dmg, a); floatText(t.x, t.z, crit ? `CRIT ${dmg}` : String(dmg), '#ff5a3c', crit); impactPuff(new THREE.Vector3(t.x, 1, t.z), 0xffc080, 8); if (t.team === PLAYER) bark(t, t.dead ? 'down' : 'hurt'); }
    else if (!hit) floatText(t.x, t.z, 'MISS', '#cfd8e3', false);
    await wait(opt.cam === false ? 250 : 500);
    if (opt.cam !== false) setActionCam(null);
    return;
  }
  const n = a.type === 'trooper' || a.elite ? 3 : 1;
  const kind = a.elite ? 'gold' : a.team === PLAYER ? 'corn' : 'seed', speed = a.type === 'sniper' ? 110 : 70;
  const ty = t.isBase ? 1.5 : 1.0;
  let tx = t.x, tz = t.z;
  if (t.isBase) { const d = Math.hypot(a.x - t.x, a.z - t.z) || 1, r = t.shield ? 4.4 : 2.4; tx = t.x + (a.x - t.x) / d * r; tz = t.z + (a.z - t.z) / d * r; }
  let landed;
  const arrived = new Promise(r => { landed = r; });
  for (let i = 0; i < n; i++) {
    const m = muzzlePos(a), from = new THREE.Vector3(m.x, m.y, m.z);
    const last = i === n - 1;
    let to = new THREE.Vector3(tx, ty + (Math.random() - 0.5) * 0.3, tz);
    if (!hit) { to.set(tx + (Math.random() - 0.5) * 2.6, ty + (Math.random() - 0.2) * 1.2, tz + (Math.random() - 0.5) * 2.6); to.sub(from).multiplyScalar(1.5).add(from); to.y = Math.max(0.05, to.y); }
    shootBullet(from, to, kind, speed, last ? () => landed() : null);
    if (a.type === 'sniper') tracer(m.x, m.y, m.z, to.x, to.y, to.z, a.team === PLAYER ? 0xfff07a : 0xffffff, 0.25);
    a.fireT = 0.3;
    if (a.team === PLAYER && opt.cam !== false) gunSound(a.type); else sfx(a.type === 'heavy' ? 'blast' : 'pop', a.x, a.z);
    if (opt.cam !== false) fps.shake = Math.min(0.25, fps.shake + 0.05);
    if (!last) await wait(a.type === 'trooper' ? 95 : 120);
  }
  await Promise.race([arrived, wait(900)]);
  let killed = false;
  if (hit && !t.dead) {
    const sh = t.shieldHP > 0;
    damage(t, dmg, a);
    floatText(t.x, t.z, sh ? (t.shieldHP > 0 ? 'SHIELDED' : `SHIELD BROKEN · ${dmg}`) : crit ? `CRIT ${dmg}` : String(dmg), sh ? '#7fc8ff' : crit ? '#ff5a3c' : '#fff07a', crit);
    impactPuff(new THREE.Vector3(tx, ty, tz), t.team === ENEMY ? 0x9cff3a : 0xffc080, 6);
    killed = t.dead;
    if (killed && a.team === PLAYER) { floatText(t.x, t.z + 0.01, 'KILL', '#ff8a6a', true); if (opt.cam !== false) game.slowmo = 0.95; bark(a, 'kill'); }
    else if (crit && a.team === PLAYER) { bark(a, 'crit'); if (turn.fp < FOCUS_MAX) turn.fp++; }
    if (t.team === PLAYER) bark(t, t.dead ? 'down' : 'hurt');
  } else if (!hit) { floatText(t.x, t.z, 'MISS', '#cfd8e3', false); if (a.team === PLAYER) bark(a, 'miss'); }
  await wait(opt.cam === false ? 250 : a.team === ENEMY ? 450 : killed ? 1300 : 650);
  if (opt.cam !== false) setActionCam(null);
}
// over-the-shoulder action camera for shots, eased in and out
function setActionCam(a, t) {
  if (mode !== 'rts') return;
  trans = { t: 0, dur: 0.45, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), fromFov: camera.fov, arc: 0 };
  turn.cam = a ? { a, t } : null;
}
const camLook = new THREE.Vector3();
function actionPose() {
  const { a, t } = turn.cam;
  const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  const back = Math.min(3.2, 1.6 + d * 0.08);
  dummy.position.set(a.x - ux * back + uz * 1.1, 2.1 + d * 0.04, a.z - uz * back - ux * 1.1);
  camLook.set(a.x + dx * 0.7, 1.0, a.z + dz * 0.7);
  dummy.lookAt(camLook);
  return { pos: dummy.position.clone(), quat: dummy.quaternion.clone(), fov: 55 };
}

// ---- pods: aliens wake up when they see you, and scramble for cover
async function tbActivate() {
  const woke = [];
  for (const h of tbFoes()) {
    if (h.alert) continue;
    if (h.seen || h.hp < h.maxHp) woke.push(h);
  }
  for (const h of woke.slice()) for (const o of tbFoes()) if (!o.alert && !woke.includes(o) && Math.hypot(o.x - h.x, o.z - h.z) < 7) woke.push(o);
  if (!woke.length) return;
  for (const h of woke) h.alert = true;
  radio(woke.length > 1 ? `Contact! ${woke.length} aliens spotted us` : 'Contact! An alien spotted us', 'warn');
  sfx('bawk', woke[0].x, woke[0].z);
  for (const h of woke) { h.revealN = turn.n; floatText(h.x, h.z, '!', '#ff5a3c', true); }
  const spotter = tbMine().sort((a, b) => Math.hypot(a.x - woke[0].x, a.z - woke[0].z) - Math.hypot(b.x - woke[0].x, b.z - woke[0].z))[0];
  bark(spotter, 'contact');
  if (spotter && turn.side === 'player') { setActionCam(spotter, woke[0]); await wait(1300); setActionCam(null); } // the reveal: look over a shoulder at what just showed up
  focusOn(woke[0].x, woke[0].z);
  await wait(400);
  tutEvent('contact');
  await Promise.all(woke.filter(h => h.type !== 'eggsac' && h.type !== 'burrower').map(h => { const s = pickSpot(h, 0.6); return s ? tbMove(h, s.x, s.z, s.path) : null; })); // the scramble
}

// ---- player turn
function beginPlayerTurn(first = false) {
  if (mode === 'over') return;
  turn.side = 'player'; turn.busy = false; turn.tool = 'move'; turn.pending = null; turn.liveUsed = false;
  for (const u of tbMine()) { u.ap = 2; u.hunker = false; u.ow = false; u.wall = false; }
  showTurnBanner(first ? 'YOUR SQUAD' : 'YOUR TURN', `Turn ${turn.n}`);
  tbSelect(tbMine()[0] || null);
  updateButtons();
}
function tbSelect(u) {
  turn.sel = u; turn.pending = null; turn.tool = 'move';
  selection = u ? [u] : [];
  updateButtons();
  if (u) focusOn(u.x, u.z);
}
function tbNext() {
  const mine = tbMine().filter(u => u.ap > 0);
  if (!mine.length) { tbEndTurn(); return; }
  const i = mine.indexOf(turn.sel);
  tbSelect(mine[(i + 1) % mine.length]);
}
function tbAfterAction() {
  turn.busy = false;
  if (mode === 'over' || turn.side !== 'player') return;
  if (!tbMine().length) return;
  if (turn.sel && !turn.sel.dead && turn.sel.ap > 0) { tbSelect(turn.sel); return; }
  const left = tbMine().filter(u => u.ap > 0);
  if (left.length) tbSelect(left.sort((a, b) => Math.hypot(a.x - turn.sel.x, a.z - turn.sel.z) - Math.hypot(b.x - turn.sel.x, b.z - turn.sel.z))[0]);
  else setTimeout(() => { if (turn.side === 'player' && !turn.busy && !tbMine().some(u => u.ap > 0)) tbEndTurn(); }, 700);
}
async function tbAct(fn) {
  if (turn.busy || turn.side !== 'player') return;
  turn.busy = true; turn.pending = null;
  try { await fn(); } catch (err) { console.error(err); }
  if (mode !== 'over') await tbActivate();
  tbAfterAction();
}
function moveCost(u, x, z) {
  if (!isFree(toCell(x), toCell(z))) return null;
  if (entities.some(e => !e.dead && e !== u && !e.isBase && Math.hypot(e.x - x, e.z - z) < 0.9)) return null;
  const path = findPath(u.x, u.z, x, z);
  const L = pathLen(u, path), R = moveR(u);
  const ap = L <= R ? 1 : L <= R * 2 && u.ap >= 2 ? 2 : 0;
  return ap && ap <= u.ap ? { path, ap, L } : { path, ap: 0, L };
}
function coverAtSpot(x, z) { // best cover against the aliens that know about you
  const seen = tbFoes().filter(h => h.alert && h.seen);
  if (!seen.length) return -1;
  return Math.min(...seen.map(h => coverFrom(x, z, h.x, h.z)));
}
function turnTap(ent, gp, { secondary, touch }) {
  if (turn.side !== 'player' || turn.busy) { if (turn.side !== 'player') toast('Alien turn', 0.8); return; }
  if (secondary) { turn.pending = null; turn.tool = 'move'; return; }
  if (!ent && gp) { // a tap near an alien counts as tapping the alien
    let best = null, bd = 2.0;
    for (const h of tbFoes()) { if (hiddenFoe(h)) continue; const d = Math.hypot(h.x - gp.x, h.z - gp.z); if (d < bd) { bd = d; best = h; } }
    ent = best;
  }
  const u = turn.sel;
  if (ent && ent.team === PLAYER && !ent.isBase && !ent.isTower) { tbSelect(ent); return; }
  if (!u || u.dead) { toast('Pick a marine first', 1); return; }
  if (u.ap <= 0) { toast(`${u.callsign || nameOf(u)} is done this turn`, 1); return; }
  if (turn.tool === 'grenade') {
    if (!gp) return;
    if (Math.hypot(gp.x - u.x, gp.z - u.z) > 11) { toast('Too far to throw', 1); return; }
    const p = turn.pending;
    if (touch && !(p && p.kind === 'gren' && Math.hypot(p.x - gp.x, p.z - gp.z) < 1.5)) { turn.pending = { kind: 'gren', x: gp.x, z: gp.z }; return; }
    tbAct(async () => {
      u.ap = 0; u.gren--; turn.tool = 'move';
      setActionCam(u, { x: gp.x, z: gp.z });
      await wait(400);
      lobEgg(u, gp.x, gp.z, 0.9, 3.4, 45);
      sfx('pop', u.x, u.z);
      await wait(1700);
      setActionCam(null);
    });
    return;
  }
  if (ent && (ent.team === ENEMY || ent.isBase && ent.team === ENEMY)) {
    const aimed = turn.tool === 'aimed';
    if (aimed && u.ap < 2) { toast('Aimed shot takes both actions', 1); return; }
    const info = shotInfo(u, ent, u.x, u.z, false, aimed);
    if (!info) { toast(ent.isBase ? 'No clear shot at the hive from here' : 'No line of sight, or out of range', 1.2); return; }
    const p = turn.pending;
    if (!(p && p.kind === 'shot' && p.t === ent)) { turn.pending = { kind: 'shot', t: ent, info, aimed }; return; } // first tap: show the odds
    tbAct(async () => {
      if (aimed) { u.cdAbil = turn.n + ABIL.sniper.cd; turn.tool = 'move'; floatText(u.x, u.z, 'AIMED SHOT', '#ffd36a', true); }
      u.ap = !aimed && u.ap === 2 && hasPerk(u, 'rapid') ? 1 : 0;
      await tbShoot(u, ent, { aimed });
      tutEvent('shot');
    });
    return;
  }
  if (!gp) return;
  const mc = moveCost(u, gp.x, gp.z);
  if (!mc) { toast('Can\'t stand there', 0.8); return; }
  if (!mc.ap) { toast(u.ap >= 2 ? 'Too far, even dashing' : 'Too far for one action', 1); return; }
  const p = turn.pending;
  if (touch && !(p && p.kind === 'move' && Math.hypot(p.x - gp.x, p.z - gp.z) < 1.2)) { turn.pending = { kind: 'move', x: gp.x, z: gp.z, ...mc }; return; }
  tbAct(async () => { u.ap -= mc.ap; await tbMove(u, gp.x, gp.z, mc.path); tutEvent('move'); });
}
// ---- drop in: once per turn, a marine with actions left can be played live in first person for 20 seconds.
// Everything fights in real time (both sides hold their ground and shoot back), then the battle freezes and the turns resume.
const LIVE_TIME = 20;
function tbDropIn() {
  const u = turn.sel;
  if (!u || u.dead || u.ap <= 0 || turn.busy || turn.side !== 'player') return;
  if (turn.liveUsed) { toast('One live drop-in per turn', 1.2); return; }
  if (turn.fp < LIVE_COST) { toast(`Drop in costs ${LIVE_COST} Focus. Kills and crits earn Focus.`, 1.6); return; }
  turn.fp -= LIVE_COST; bark(u, 'live'); tutEvent('live');
  turn.liveUsed = true; turn.busy = true; turn.pending = null; turn.tool = 'move';
  turn.live = true; turn.liveT = LIVE_TIME; game.relink = 0;
  for (const e of entities) if (!e.dead && !e.isBase) { e.order = { type: 'idle' }; e.path = null; e.anchor = null; e.ow = false; }
  possess(u);
  showTurnBanner('LIVE', `${LIVE_TIME} seconds`);
  radio(`${u.callsign || nameOf(u)} is live for ${LIVE_TIME} seconds. Make them count.`, 'good');
}
function liveTick(dt) {
  if (!turn.live) return;
  if (mode === 'over') { turn.live = false; return; }
  if (mode === 'fps' && !(game.slowmo > 0.5)) turn.liveT -= dt;
  const tag = $('modeTag'); tag.innerHTML = `<b>LIVE</b> ${Math.max(0, Math.ceil(turn.liveT))}s then back to turns`; tag.className = 'op';
  if (turn.liveT <= 0 || mode !== 'fps' || !possessed) endLive();
}
async function endLive() {
  if (!turn.live) return;
  const u = possessed;
  turn.live = false; game.relink = 0;
  if (mode === 'fps') exitFPS();
  for (const e of entities) if (!e.dead && !e.isBase) { e.order = { type: 'idle' }; e.path = null; e.anchor = null; }
  for (const h of tbFoes()) if (h.hp < h.maxHp || tbMine().some(m => Math.hypot(m.x - h.x, m.z - h.z) < 15)) h.alert = true;
  if (u && !u.dead) u.ap = 0;
  if (mode === 'over') return;
  showTurnBanner('BACK TO TURNS', 'Live time is up');
  await wait(600);
  tbAfterAction();
}
function tbOverwatch() {
  const u = turn.sel; if (!u || u.ap <= 0 || turn.busy || turn.side !== 'player') return;
  u.ow = true; u.ap = 0; floatText(u.x, u.z, 'OVERWATCH', '#ffd36a', true); sfx('chime');
  tbAfterAction();
}
function tbHunker() {
  const u = turn.sel; if (!u || u.ap <= 0 || turn.busy || turn.side !== 'player') return;
  u.hunker = true; u.ap = 0; floatText(u.x, u.z, 'HUNKER DOWN', '#7fe0ff', true);
  tbAfterAction();
}
function tbGrenadeTool() {
  const u = turn.sel; if (!u || u.ap <= 0 || turn.side !== 'player' || turn.busy) return;
  const cd = (u.cdAbil || 0) - turn.n;
  if (u.type !== 'trooper' && cd > 0) { toast(`${ABIL[u.type].name} is ready in ${cd} turn${cd > 1 ? 's' : ''}`, 1.2); return; }
  if (u.type === 'heavy') { // shield wall: hunker down and cover every marine within 3.5m
    u.hunker = true; u.ap = 0; u.cdAbil = turn.n + ABIL.heavy.cd;
    for (const m of tbMine()) if (Math.hypot(m.x - u.x, m.z - u.z) < 3.5) { m.wall = true; burst(m.x, 1, m.z, 0.7, 0x7fc8ff); }
    floatText(u.x, u.z, 'SHIELD WALL', '#7fc8ff', true); sfx('chime');
    tbAfterAction(); return;
  }
  if (u.type === 'sniper') {
    if (u.ap < 2) { toast('Aimed shot takes both actions', 1.2); return; }
    turn.tool = turn.tool === 'aimed' ? 'move' : 'aimed'; turn.pending = null;
    if (turn.tool === 'aimed') toast('Aimed shot: +20 aim, +20 crit. Pick a target.', 1.6);
    return;
  }
  if (!u.gren) { toast('No grenades left', 1); return; }
  turn.tool = turn.tool === 'grenade' ? 'move' : 'grenade'; turn.pending = null;
  if (turn.tool === 'grenade') toast(isTouch ? 'Tap where it lands, then Throw' : 'Click where it lands', 1.4);
}

// ---- alien turn
async function tbEndTurn() {
  if (turn.side !== 'player' || turn.busy || mode === 'over') return;
  turn.side = 'enemy'; turn.busy = true; turn.pending = null; turn.sel = null; selection = []; updateButtons();
  tbRelays();
  showTurnBanner('ALIEN TURN', 'The swarm moves');
  await wait(1100);
  tbReinforce();
  await tbActivate();
  for (const h of tbFoes()) h.ow = false;
  tbHiveRules();
  const acting = tbFoes().filter(h => h.alert).sort((a, b) => nearestDist(a) - nearestDist(b));
  for (const h of acting) {
    if (mode === 'over' || !tbMine().length) break;
    if (h.dead) continue;
    await alienAct(h);
  }
  if (mode === 'over') return;
  for (const l of loot) l.life -= 10; // loot left on the field fades after three turns
  turn.n++;
  if (story.def) {
    story.turns = (story.turns || 0) + 1;
    for (const [n, fn] of story.later || []) if (n === story.turns) fn();
  }
  if (!tbMine().length) { if (!(camp.m && camp.m.story) && game.cp < COSTS.trooper) endGame(false, 'The squad was wiped out.'); else if (!(camp.m && camp.m.story)) { beginPlayerTurn(); return; } return; }
  beginPlayerTurn();
}
const nearestDist = h => Math.min(...tbMine().map(u => Math.hypot(u.x - h.x, u.z - h.z)), 99);
function tbTargets(h) {
  const list = tbMine();
  for (const e of entities) if (!e.dead && e.team === PLAYER && (e.isBase || e.isTower)) list.push(e);
  return list;
}
function bestShot(h, x, z) {
  let best = null;
  for (const t of tbTargets(h)) {
    const info = shotInfo(h, t, x, z); if (!info) continue;
    const score = info.chance * (t.isBase ? 0.5 : 1) * (t.hp < tbDamage(h) * 1.2 ? 1.3 : 1);
    if (!best || score > best.score) best = { t, info, score };
  }
  return best;
}
function pickSpot(h, scale = 1) {
  const R = (TBS[h.type] || TBS.trooper).move * scale;
  const tg = tbTargets(h);
  if (!tg.length) return null;
  const goal = tg.slice().sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
  const gd0 = Math.hypot(goal.x - h.x, goal.z - h.z);
  let best = null;
  for (let k = 0; k < 20; k++) for (const f of [0.35, 0.7, 1]) {
    const a = k / 20 * Math.PI * 2 + h.x, x = h.x + Math.cos(a) * R * f, z = h.z + Math.sin(a) * R * f;
    if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) continue;
    if (!isFree(toCell(x), toCell(z))) continue;
    if (entities.some(e => !e.dead && e !== h && !e.isBase && Math.hypot(e.x - x, e.z - z) < 1.1)) continue;
    const gd = Math.hypot(goal.x - x, goal.z - z);
    let s = (gd0 - gd) / R * (h.elite ? 1.4 : 0.8); // close in
    const shot = bestShot(h, x, z);
    if (shot) s += shot.info.chance / 100 * 2 + (shot.info.cover === 0 ? 0.6 : 0);
    const mine = tbMine().filter(u => Math.hypot(u.x - x, u.z - z) < 22);
    if (mine.length) s += Math.min(...mine.map(u => coverFrom(x, z, u.x, u.z))) * 0.55; // stay in cover
    if (h.type === 'sniper' && gd < 7) s -= 1;
    if (h.type === 'shielder') s += tbFoes().filter(o => o !== h && Math.hypot(o.x - x, o.z - z) < 5).length * 0.4;
    s += Math.random() * 0.25;
    if (!best || s > best.s) best = { x, z, s };
  }
  if (!best) return null;
  const path = findPath(h.x, h.z, best.x, best.z);
  if (pathLen(h, path) > R * 1.35) { // walls in the way: walk part of the way along the path instead
    let L = 0, x = h.x, z = h.z; const cut = [];
    for (const p of path) { const seg = Math.hypot(p.x - x, p.z - z); if (L + seg > R) { const k = (R - L) / seg; cut.push({ x: x + (p.x - x) * k, z: z + (p.z - z) * k }); break; } cut.push(p); L += seg; x = p.x; z = p.z; }
    const end = cut[cut.length - 1];
    return end ? { x: end.x, z: end.z, path: cut } : null;
  }
  return { ...best, path };
}
async function alienAct(h) {
  if (h.type === 'eggsac') return;
  h.ap = 2;
  if (h.type === 'burrower') { await burrowerAct(h); return; }
  const vis = () => h.seen;
  if (vis()) { focusOn(h.x, h.z); await wait(200); }
  while (h.ap > 0 && !h.dead && mode !== 'over' && tbMine().length) {
    const shot = bestShot(h, h.x, h.z);
    if (shot && (shot.info.chance >= 45 || (h.ap === 1 && shot.info.chance >= 15))) { h.ap = 0; await tbShoot(h, shot.t); break; }
    if (h.ap === 1 && h.type === 'sniper') { h.ap = 0; h.ow = true; floatText(h.x, h.z, 'OVERWATCH', '#ff8a6a', true); await wait(400); break; }
    const spot = pickSpot(h);
    if (!spot) { if (shot) { h.ap = 0; await tbShoot(h, shot.t); } break; }
    h.ap--;
    const seenBefore = vis();
    if (seenBefore) focusOn(spot.x, spot.z);
    if (!seenBefore) h.fastMove = true;
    await tbMove(h, spot.x, spot.z, spot.path);
    h.fastMove = false;
    if (seenBefore || vis()) await wait(150);
  }
  h.ap = 0;
}
// burrowers tunnel under everything (only a dust trail gives them away), surface next to a marine and claw
async function burrowerAct(h) {
  const near = () => tbMine().sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
  while (h.ap > 0 && !h.dead && mode !== 'over' && tbMine().length) {
    const t = near();
    if (Math.hypot(t.x - h.x, t.z - h.z) <= 2.6 && !h.burrowed) { h.ap = 0; await tbShoot(h, t, { cam: true }); break; }
    const d = Math.hypot(t.x - h.x, t.z - h.z), R = TBS.burrower.move;
    let x, z;
    if (d - 1.5 <= R) { x = t.x + (h.x - t.x) / d * 1.5; z = t.z + (h.z - t.z) / d * 1.5; }
    else { x = h.x + (t.x - h.x) / d * R; z = h.z + (t.z - h.z) / d * R; }
    const [fi, fj] = nearestFree(toCell(x), toCell(z)); x = cellCenter(fi); z = cellCenter(fj);
    h.ap--; h.burrowed = true; h.seen = false;
    await tbMove(h, x, z, [{ x, z }]);
    if (Math.hypot(t.x - h.x, t.z - h.z) <= 3) { // surface
      h.burrowed = false; h.revealN = turn.n + 1; tbVision();
      smoke(h.x, 0.4, h.z, 1.4, 6); sfx('boom', h.x, h.z); focusOn(h.x, h.z); fps.shake = Math.min(0.4, fps.shake + 0.2);
      floatText(h.x, h.z, 'BURROWER!', '#ff8a5a', true);
      await wait(500);
    }
  }
  h.ap = 0;
}
// egg sacs hatch a skitter each turn (3 at most); wardens shield every alien near them
function tbHiveRules() {
  for (const h of tbFoes()) {
    if (h.type === 'eggsac' && (h.alert || h.seen) && (h.hatched || 0) < 3 && tbFoes().length < 16) {
      h.hatched = (h.hatched || 0) + 1;
      const a = Math.random() * Math.PI * 2, [fi, fj] = nearestFree(toCell(h.x + Math.cos(a) * 1.6), toCell(h.z + Math.sin(a) * 1.6));
      const k = makeUnit(ENEMY, 'trooper', cellCenter(fi), cellCenter(fj)); k.alert = true;
      puff(k.x, 0.4, k.z, 1, 0x9cff3a, 0.8, 0.8, 0.7);
      if (h.seen) floatText(h.x, h.z, 'HATCHED', '#9cff3a', true);
    }
    if (h.type === 'shielder' && h.alert) for (const o of tbFoes()) {
      if (o === h || o.type === 'eggsac' || Math.hypot(o.x - h.x, o.z - h.z) > 5) continue;
      o.shieldHP = 20;
      if (!o.bubble) { o.bubble = noRay(new THREE.Mesh(sphere14(), new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }))); o.bubble.scale.setScalar(1.2 * (o.baseScale || 1)); o.bubble.position.y = 0.8; o.mesh.add(o.bubble); }
      o.bubble.visible = true;
    }
  }
}
// relays: a marine (and no alien) standing on one at the end of your turn captures it over two turns
function tbRelays() {
  for (const p of points) {
    const inside = e => Math.hypot(e.x - p.x, e.z - p.z) < POINT_R;
    const mine = tbMine().filter(inside).length, foes = tbFoes().filter(inside).length;
    if (mine && !foes) p.prog = Math.min(1, p.prog + 0.5);
    else if (foes && !mine) p.prog = Math.max(-1, p.prog - 0.5);
    if (mine && !foes) floatText(p.x, p.z, `Relay ${Math.round(Math.max(0, p.prog) * 100)}%`, '#7fe0ff', true);
  }
  updatePoints(0);
}
// arena missions: the hive sends more aliens between turns
function tbReinforce() {
  const m = camp.m; if (!m || m.story) return;
  const rule = m.tb || {};
  const alive = tbFoes().length;
  if (rule.tyrantAt && turn.n === rule.tyrantAt && !entities.some(e => e.elite && !e.dead)) {
    const t = makeUnit(ENEMY, 'elite', 0, -20); t.alert = true; smoke(0, 0.5, -20, 3, 8);
    radio('The Hive Tyrant is out of the hive!', 'warn'); twistBanner('THE TYRANT');
  }
  if (rule.tyrantEvery && turn.n % rule.tyrantEvery === 0 && !entities.some(e => e.elite && !e.dead)) {
    const t = makeUnit(ENEMY, 'elite', 0, -20); t.alert = true; radio('The Hive Tyrant joins the fight', 'warn');
  }
  if (!(turn.n % (rule.every || 1) === 0)) return;
  const n = Math.min((rule.spawn || 2) + (turn.n >= 5 ? 1 : 0), 12 - alive);
  for (let i = 0; i < n; i++) {
    const type = i === 0 && turn.n >= 3 ? (turn.n % 2 ? 'burrower' : 'shielder') : i % 4 === 3 ? 'sniper' : i % 3 === 2 ? 'heavy' : 'trooper';
    const x = (Math.random() - 0.5) * 16, z = -20 - Math.random() * 2;
    const h = makeUnit(ENEMY, type, x, z); h.alert = true;
    smoke(x, 0.4, z, 1.4, 4);
  }
  if (n > 0) radio(`${n} more aliens pour out of the hive`, 'warn');
}
function showTurnBanner(title, sub) {
  const b = $('turnBanner'); if (!b) return;
  b.innerHTML = `<b>${title}</b><small>${sub}</small>`;
  b.className = turn.side === 'enemy' ? 'enemy' : '';
  void b.offsetWidth; b.classList.add('show');
}

// ---- phone-first turn UI: a squad bar, big buttons for the selected marine, a confirm card instead of "tap again",
// a one-line top bar and an alien-turn strip. Built once when the turn-based mission starts (missions load a fresh page).
const TB_ICON = {
  ow: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hunker: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  live: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trooper: '<circle cx="12" cy="14" r="7"/><path d="M12 7V3M9 3h6M17 9l2-2"/>',
  heavy: '<path d="M4 4h16v9c0 4-4 7-8 8-4-1-8-4-8-8z"/><path d="M8 9h8M8 13h8"/>',
  sniper: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  end: '<path d="M5 12h11M12 6l6 6-6 6"/>',
  fast: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/>',
};
const tbSvg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${TB_ICON[k]}</svg>`;
const TB_CLASS = { trooper: 'MAR', heavy: 'JUG', sniper: 'RNG', elite: 'HERO' };
const tbUI = { built: false, sig: '', abil: '' };
function tbUISetup() {
  if (tbUI.built) return; tbUI.built = true;
  const acts = $('tbActs');
  for (const [id, ic] of [['btnTGren', null], ['btnOW', 'ow'], ['btnHunker', 'hunker'], ['btnTLive', 'live']]) {
    const b = $(id); acts.appendChild(b);
    const i = b.querySelector('i'); if (i && ic) i.innerHTML = tbSvg(ic);
  }
  setLabel('btnOW', 'Overwatch'); setLabel('btnHunker', 'Hunker');
  const end = $('btnEndTurn'); $('tbRow').appendChild(end); end.querySelector('i').innerHTML = tbSvg('end');
  const fast = $('btnFast'); $('tbStrip').appendChild(fast); fast.querySelector('i').innerHTML = tbSvg('fast'); setLabel('btnFast', 'Fast');
  for (const id of ['btnBuyTrooper', 'btnBuyHeavy', 'btnBuySniper']) $('tbShop').appendChild($(id));
  tapButton($('tbShopBtn'), () => $('tbShop').classList.toggle('hidden'));
  tapButton($('tbMap'), () => document.body.classList.toggle('tbMapOpen'));
  tapButton($('tbCenter'), tbCenterSquad);
  tapButton($('tbCfNo'), () => { turn.pending = null; });
  tapButton($('tbCfYes'), tbConfirm);
  $('tbSquad').addEventListener('pointerdown', e => {
    const c = e.target.closest('[data-uid]'); if (!c) return;
    e.preventDefault(); e.stopPropagation();
    const u = tbMine().find(m => m.uid === +c.dataset.uid); if (!u) return;
    if (turn.side === 'player' && !turn.busy) tbSelect(u); else focusOn(u.x, u.z);
  });
  document.body.classList.add('tbui');
}
function tbCenterSquad() {
  const mine = tbMine(); if (!mine.length) return;
  const u = turn.sel && !turn.sel.dead ? turn.sel : null;
  if (u) { focusOn(u.x, u.z); return; }
  focusOn(mine.reduce((a, m) => a + m.x, 0) / mine.length, mine.reduce((a, m) => a + m.z, 0) / mine.length);
}
// the confirm card does what a second tap on the same spot used to do
function tbConfirm() {
  const p = turn.pending; if (!p) return;
  if (p.kind === 'shot') turnTap(p.t, null, { touch: true });
  else turnTap(null, { x: p.x, z: p.z }, { touch: true });
}
function tbPendingText(p, u) {
  if (p.kind === 'shot') {
    const i = p.info, dmg = TBS[u.type] || TBS.trooper, k = u.dmg / TYPES[u.type].dmg * (p.t.isBase ? TB_BASE_DMG : 1);
    const cov = i.cover === 2 ? 'Full cover' : i.cover === 1 ? 'Half cover' : 'Flanked: easy crit';
    return { title: `${p.aimed ? 'Aimed shot' : 'Fire'} · ${i.chance}% hit`, info: `${Math.round(dmg.dmg[0] * k)}-${Math.round(dmg.dmg[1] * k)} dmg · ${i.crit}% crit · ${p.t.isBase ? 'the hive' : cov}`, yes: 'Fire', hot: true };
  }
  if (p.kind === 'gren') {
    const n = tbFoes().filter(h => Math.hypot(h.x - p.x, h.z - p.z) < 3.4).length;
    return { title: 'Throw frag', info: `${n} alien${n === 1 ? '' : 's'} in the blast · ends the turn`, yes: 'Throw', hot: true };
  }
  const cov = coverAtSpot(p.x, p.z);
  return { title: `${p.ap === 2 ? 'Dash' : 'Move'} · ${p.ap} action${p.ap > 1 ? 's' : ''}`, info: cov === 2 ? 'Full cover there' : cov === 1 ? 'Half cover there' : 'No cover there', yes: p.ap === 2 ? 'Dash' : 'Move', hot: false };
}
function tbUITick() {
  if (!tbUI.built) return;
  const u = turn.sel, player = turn.side === 'player';
  document.body.classList.toggle('tbEnemy', !player);
  // top line
  $('tbObj').textContent = campaignObjective().replace(/<[^>]+>/g, '').replace('🎯 ', '');
  $('tbTurn').textContent = `T${turn.n}`;
  $('tbFp').textContent = `◆ ${turn.fp}`;
  $('tbOre').textContent = `◇ ${Math.floor(game.cp)}`;
  const moving = tbFoes().filter(h => !hiddenFoe(h)).length;
  $('tbStripN').textContent = moving ? ` · ${moving} in sight` : '';
  // End turn says how many marines still have actions
  const left = tbMine().filter(m => m.ap > 0).length;
  setLabel('btnEndTurn', left ? `End turn · ${left} can act` : 'End turn');
  // confirm card
  const p = player && !turn.busy && u && !u.dead ? turn.pending : null;
  const cf = $('tbConfirm');
  cf.classList.toggle('hidden', !p || !isTouch);
  if (p && isTouch) {
    const t = tbPendingText(p, u);
    $('tbCfTitle').textContent = t.title; $('tbCfInfo').textContent = t.info;
    $('tbCfYes').textContent = t.yes; cf.classList.toggle('hot', t.hot);
  }
  // squad bar: rebuild only when something on it changed
  const mine = tbMine();
  const sig = mine.map(m => [m.uid, Math.ceil(m.hp), m.ap, m.ow ? 1 : 0, m.hunker ? 1 : 0, m === u ? 1 : 0].join(',')).join('|') + player;
  if (sig !== tbUI.sig) {
    tbUI.sig = sig;
    $('tbSquad').innerHTML = mine.map(m => {
      const hp = Math.max(0, m.hp / m.maxHp), col = hp > 0.6 ? '#5dd88a' : hp > 0.3 ? '#ffc24a' : '#ff6a5a';
      const st = m.ow ? 'OW' : m.hunker ? 'HNK' : '';
      const nm = (m.callsign || nameOf(m)).split(' ').pop();
      const done = player && m.ap <= 0;
      return `<button data-uid="${m.uid}" class="${m === u ? 'sel' : ''}${done ? ' done' : ''}" aria-label="${nm}, ${m.ap} actions left">` +
        `<span class="t"><b>${TB_CLASS[m.type] || ''}</b><em>${st}</em></span><span class="n">${nm}</span>` +
        `<span class="hp"><span style="width:${Math.round(hp * 100)}%;background:${col}"></span></span>` +
        `<span class="ap">${player ? '<i class="on"></i>'.repeat(Math.max(0, m.ap)) + '<i></i>'.repeat(Math.max(0, 2 - m.ap)) : ''}</span></button>`;
    }).join('');
  }
  // the class ability button shows its own icon
  if (u && tbUI.abil !== u.type) { tbUI.abil = u.type; const i = $('btnTGren').querySelector('i'); if (i) i.innerHTML = tbSvg(TB_ICON[u.type] ? u.type : 'trooper'); }
}
function turnTick(dt) {
  turn.visT = (turn.visT || 0) - dt;
  if (turn.visT <= 0) { turn.visT = 0.15; tbVision(); }
  if (turn.focusT > 0) { turn.focusT -= dt; rts.focus.lerp(turn.focus, Math.min(1, dt * 4)); }
  if (!turn.cam && trans === null && camera.aspect < 1) rts.zoom = Math.max(rts.zoom, 34);
  const tag = $('modeTag');
  tag.innerHTML = (turn.side === 'player' ? `<b>YOUR TURN</b> ${turn.n}` : `<b>ALIEN TURN</b>${turn.fast ? ' ⏩' : ''}`) + ` <span class="fp" title="Focus: earned by kills and crits, spent to drop in">◆ ${turn.fp}</span>`;
  tag.className = turn.side === 'player' ? 'plan' : 'op';
  const u = turn.sel;
  const can = turn.side === 'player' && !turn.busy && u && !u.dead && u.ap > 0;
  $('btnOW').classList.toggle('off', !can);
  $('btnHunker').classList.toggle('off', !can);
  $('btnTLive').classList.toggle('off', !can || turn.liveUsed || turn.fp < LIVE_COST);
  setLabel('btnTLive', `Drop in · ◆${LIVE_COST}`);
  const cd = u ? (u.cdAbil || 0) - turn.n : 0;
  $('btnTGren').classList.toggle('off', !can || (u.type === 'trooper' ? !u.gren : cd > 0 || (u.type === 'sniper' && u.ap < 2)));
  $('btnTGren').classList.toggle('armed', turn.tool === 'grenade' || turn.tool === 'aimed');
  $('btnEndTurn').classList.toggle('off', turn.side !== 'player' || turn.busy);
  $('btnFast').classList.toggle('armed', turn.fast);
  if (u) setLabel('btnTGren', u.type === 'trooper' ? `Grenade · ${u.gren || 0}` : cd > 0 ? `${ABIL[u.type].name} · ${cd}` : ABIL[u.type].name);
  tbUITick();
  for (const h of tbFoes()) if (h.bubble) h.bubble.visible = h.shieldHP > 0;
  if (u && !u.dead) $('selInfo').textContent = `${u.callsign || nameOf(u)} · ${'●'.repeat(Math.max(0, u.ap))}${'○'.repeat(Math.max(0, 2 - u.ap))} · ${Math.ceil(u.hp)}/${u.maxHp} hp`;
  else if (turn.side === 'enemy') $('selInfo').textContent = 'The swarm is moving…';
}

// ---- drawing: move range, path preview with cover, hit chances, action points
function drawTurnUI() {
  if (mode !== 'rts' || turn.cam) return;
  const u = turn.sel;
  const proj = (x, z) => toScreen(x, 0.1, z);
  // every marine stands on a blue team disc (grey and dashed once it is done this turn); the selected one gets a gold
  // ring, an arrow and its name. Overwatch and hunker show as small chips over the head.
  octx.textAlign = 'center';
  for (const m of tbMine()) {
    const r = 0.45 * (m.big || 1), done = turn.side === 'player' && m.ap <= 0;
    groundCircle(m.x, m.z, r, 28);
    if (done) { octx.setLineDash([5, 4]); octx.strokeStyle = 'rgba(160,176,195,.8)'; octx.lineWidth = 2.5; octx.stroke(); octx.setLineDash([]); }
    else { octx.fillStyle = 'rgba(74,168,255,.22)'; octx.fill(); octx.strokeStyle = '#4aa8ff'; octx.lineWidth = 3; octx.stroke(); }
    if (m === u) {
      groundCircle(m.x, m.z, r + 0.3, 32); octx.save(); octx.shadowColor = 'rgba(255,211,106,.9)'; octx.shadowBlur = 12;
      octx.strokeStyle = '#ffd36a'; octx.lineWidth = 4; octx.stroke(); octx.restore();
    }
    const s = toScreen(m.x, 2.3 + 1.9 * ((m.big || 1) - 1), m.z); if (s.behind) continue;
    if (m === u) {
      octx.fillStyle = '#ffd36a'; octx.strokeStyle = '#0b1119'; octx.lineWidth = 2;
      octx.beginPath(); octx.moveTo(s.x - 10, s.y - 18); octx.lineTo(s.x + 10, s.y - 18); octx.lineTo(s.x, s.y - 2); octx.closePath(); octx.fill(); octx.stroke();
      const nm = `${(m.callsign || nameOf(m)).split(' ').pop().toUpperCase()} · ${'●'.repeat(Math.max(0, m.ap))}${'○'.repeat(Math.max(0, 2 - m.ap))}`;
      octx.font = '800 12px system-ui'; const w = octx.measureText(nm).width + 14;
      octx.beginPath(); octx.roundRect ? octx.roundRect(s.x - w / 2, s.y - 42, w, 20, 6) : octx.rect(s.x - w / 2, s.y - 42, w, 20); octx.fill();
      octx.fillStyle = '#0b1119'; octx.fillText(nm, s.x, s.y - 28);
    }
    const chips = (m.ow ? 'OW ' : '') + (m.hunker ? 'HNK' : '');
    if (chips) { octx.font = '900 11px system-ui'; octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.75)'; const y = s.y + (m === u ? -48 : -4); octx.strokeText(chips.trim(), s.x, y); octx.fillStyle = '#ffd36a'; octx.fillText(chips.trim(), s.x, y); }
  }
  // aliens you have seen: an arrow at the screen edge when they are off screen, a "last seen" marker when they vanish
  {
    const top = 52, bot = innerHeight - (($('tbPanel') && $('tbPanel').offsetHeight) || 0) - 8;
    for (const h of tbFoes()) {
      if (hiddenFoe(h)) {
        if (!h.lastSeen) continue;
        const q = toScreen(h.lastSeen.x, 0.6, h.lastSeen.z); if (q.behind) continue;
        octx.setLineDash([4, 4]); octx.strokeStyle = 'rgba(255,138,61,.75)'; octx.lineWidth = 2;
        octx.beginPath(); octx.arc(q.x, q.y, 14, 0, Math.PI * 2); octx.stroke(); octx.setLineDash([]);
        octx.font = '900 13px system-ui'; octx.fillStyle = '#ffb27a'; octx.fillText('?', q.x, q.y + 5);
        continue;
      }
      h.lastSeen = { x: h.x, z: h.z };
      if (h.type !== 'eggsac') { // a red disc under every alien you can see, and its health
        groundCircle(h.x, h.z, 0.55 * (h.big || 1) * (h.elite ? 1.3 : 1), 24);
        octx.fillStyle = 'rgba(255,90,60,.2)'; octx.fill(); octx.strokeStyle = '#ff6a4a'; octx.lineWidth = 2.5; octx.stroke();
      }
      { const hb = toScreen(h.x, 1.25 * (h.big || 1) * (h.elite ? 1.4 : 1), h.z);
        if (!hb.behind) { const w = 30, f = Math.max(0, h.hp / h.maxHp);
          octx.fillStyle = 'rgba(0,0,0,.65)'; octx.fillRect(hb.x - w / 2 - 1, hb.y - 1, w + 2, 6);
          octx.fillStyle = h.shieldHP > 0 ? '#7fc8ff' : '#ff5a3c'; octx.fillRect(hb.x - w / 2, hb.y, w * f, 4); } }
      const q = toScreen(h.x, 0.6, h.z);
      const off = q.behind || q.x < 8 || q.x > innerWidth - 8 || q.y < top || q.y > bot;
      if (!off) continue;
      let x = q.x, y = q.y;
      if (q.behind) { x = innerWidth - x; y = bot; }
      x = Math.max(22, Math.min(innerWidth - 22, x)); y = Math.max(top + 14, Math.min(bot - 14, y));
      const ang = Math.atan2(q.y - y, q.x - x) || (q.behind ? Math.PI / 2 : 0);
      octx.save(); octx.translate(x, y); octx.rotate(ang);
      octx.fillStyle = 'rgba(40,14,6,.85)'; octx.strokeStyle = '#ff8a3d'; octx.lineWidth = 2.5;
      octx.beginPath(); octx.moveTo(14, 0); octx.lineTo(-8, -11); octx.lineTo(-3, 0); octx.lineTo(-8, 11); octx.closePath(); octx.fill(); octx.stroke();
      octx.restore();
    }
  }
  for (const h of tbFoes()) { // name the special aliens so you learn what they do
    if (hiddenFoe(h) || !['burrower', 'shielder', 'eggsac', 'elite'].includes(h.type)) continue;
    const s = toScreen(h.x, h.type === 'elite' ? 3.4 : 2.2, h.z); if (s.behind) continue;
    octx.font = '800 11px system-ui'; octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.7)';
    const t = { burrower: 'BURROWER · tunnels', shielder: 'WARDEN · shields allies', eggsac: `EGG SAC · hatches ${3 - (h.hatched || 0)}`, elite: 'HIVE TYRANT' }[h.type];
    octx.strokeText(t, s.x, s.y); octx.fillStyle = '#ffb48a'; octx.fillText(t, s.x, s.y);
  }
  for (const h of tbFoes()) {
    if (!h.ow || hiddenFoe(h)) continue;
    const s = toScreen(h.x, 2.4, h.z); if (s.behind) continue;
    octx.font = '900 12px system-ui'; octx.fillStyle = '#ff8a6a';
    octx.fillText('👁 OVERWATCH', s.x, s.y);
  }
  if (turn.side !== 'player' || !u || u.dead) return;
  // move range: blue for one action, yellow for a dash
  const R = moveR(u);
  if (u.ap > 0 && turn.tool === 'move') {
    octx.lineWidth = 2;
    groundCircle(u.x, u.z, R, 48); octx.strokeStyle = 'rgba(90,190,255,.75)'; octx.fillStyle = 'rgba(90,190,255,.07)'; octx.fill(); octx.stroke();
    if (u.ap >= 2) { octx.setLineDash([7, 6]); groundCircle(u.x, u.z, R * 2, 64); octx.strokeStyle = 'rgba(255,210,90,.6)'; octx.stroke(); octx.setLineDash([]); }
  }
  // hit chances on every alien this marine can shoot
  for (const h of tbFoes().concat(enemyBase && !enemyBase.dead ? [enemyBase] : [])) {
    if (u.ap <= 0) break;
    const info = shotInfo(u, h, u.x, u.z, false, turn.tool === 'aimed'); if (!info) continue;
    const s = toScreen(h.x, h.isBase ? 6 : 2.7, h.z); if (s.behind) continue;
    const sel = turn.pending && turn.pending.t === h;
    label(s.x, s.y, `${info.chance}%${info.cover === 0 && !h.isBase ? ' · FLANKED' : info.cover === 1 ? ' · ◐' : info.cover === 2 ? ' · ●' : ''}`, sel ? '#ffffff' : info.chance >= 65 ? '#9dffc4' : info.chance >= 40 ? '#ffd36a' : '#ff9a8a');
  }
  // the preview: hover on desktop, the first tap on phones
  let pv = turn.pending;
  if (!pv && turn.hover && !isTouch && turn.tool === 'move') {
    const gp = groundPoint(turn.hover.x, turn.hover.y);
    if (gp) {
      const key = `${toCell(gp.x)},${toCell(gp.z)}`;
      if (key !== turn.hoverKey) { turn.hoverKey = key; turn.hoverMc = moveCost(u, gp.x, gp.z); turn.hoverAt = gp; }
      if (turn.hoverMc) pv = { kind: 'move', x: turn.hoverAt.x, z: turn.hoverAt.z, ...turn.hoverMc };
    }
  }
  if (turn.tool === 'grenade') {
    const g = pv && pv.kind === 'gren' ? pv : turn.hover && !isTouch ? groundPoint(turn.hover.x, turn.hover.y) : null;
    octx.setLineDash([5, 5]); groundCircle(u.x, u.z, 11, 48); octx.strokeStyle = 'rgba(255,170,85,.6)'; octx.stroke(); octx.setLineDash([]);
    if (g) {
      groundCircle(g.x, g.z, 3.4, 32); octx.fillStyle = 'rgba(255,140,60,.18)'; octx.strokeStyle = '#ffaa55'; octx.fill(); octx.stroke();
      const n = tbFoes().filter(h => Math.hypot(h.x - g.x, h.z - g.z) < 3.4).length;
      const c = proj(g.x, g.z); label(c.x, c.y - 30, `Frag · ${n} in blast`, '#ffcf9a');
    }
    return;
  }
  if (pv && pv.kind === 'shot') {
    const a = proj(u.x, u.z), b = proj(pv.t.x, pv.t.z);
    octx.strokeStyle = '#ff6a5a'; octx.lineWidth = 2; octx.setLineDash([4, 5]); octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.setLineDash([]);
    const i = pv.info, dmg = TBS[u.type] || TBS.trooper, k = u.dmg / TYPES[u.type].dmg * (pv.t.isBase ? TB_BASE_DMG : 1);
    label(b.x, b.y + 34, `${pv.aimed ? 'Aimed shot' : 'Shoot'} · ${i.chance}% hit · ${i.crit}% crit · ${Math.round(dmg.dmg[0] * k)}-${Math.round(dmg.dmg[1] * k)} dmg${isTouch ? '' : ' · click again'}`, '#ffd0c8');
    return;
  }
  if (pv && pv.kind === 'move') {
    const a = proj(u.x, u.z);
    const ok = pv.ap > 0, col = !ok ? '#ff7a6a' : pv.ap === 2 ? '#ffd36a' : '#7fd0ff';
    octx.strokeStyle = col; octx.lineWidth = 2.5; octx.setLineDash([6, 6]);
    octx.beginPath(); octx.moveTo(a.x, a.y); for (const p of pv.path) { const q = proj(p.x, p.z); octx.lineTo(q.x, q.y); } octx.stroke(); octx.setLineDash([]);
    groundCircle(pv.x, pv.z, 0.55, 20); octx.fillStyle = col + '55'; octx.fill(); octx.stroke();
    const cov = coverAtSpot(pv.x, pv.z);
    const c = proj(pv.x, pv.z);
    const txt = !ok ? 'Too far' : `${pv.ap === 2 ? 'Dash' : 'Move'}${cov === 2 ? ' · ● full cover' : cov === 1 ? ' · ◐ half cover' : cov === 0 ? ' · ⚠ no cover' : ''}`;
    label(c.x, c.y - 30, txt, cov === 0 ? '#ffb4a0' : col);
    // shields on the sides that would protect you there
    if (ok) for (const h of tbFoes().filter(f => f.alert)) {
      const cv = coverFrom(pv.x, pv.z, h.x, h.z); if (!cv) continue;
      const d = Math.hypot(h.x - pv.x, h.z - pv.z) || 1, q = toScreen(pv.x + (h.x - pv.x) / d * 0.9, 0.9, pv.z + (h.z - pv.z) / d * 0.9);
      octx.font = '900 16px system-ui'; octx.fillStyle = cv === 2 ? '#7fd0ff' : '#cfe8ff'; octx.fillText(cv === 2 ? '⛊' : '◐', q.x, q.y);
    }
  }
}
canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') turn.hover = { x: e.clientX, y: e.clientY }; });
tapButton($('btnOW'), tbOverwatch);
tapButton($('btnTLive'), tbDropIn);
function toggleFast() { turn.fast = !turn.fast; try { localStorage.setItem('hivefall.fast', turn.fast ? '1' : '0'); } catch (e) { /* ignore */ } toast(turn.fast ? 'Alien turns: fast' : 'Alien turns: normal speed', 1); }
tapButton($('btnFast'), toggleFast);
// first-mission coach: one short card at a time, advanced by doing the thing it describes
const TUT = [
  'Your squad. The blue ring is how far a marine moves for 1 action; the dashed yellow ring is a dash (2 actions). Tap inside the blue ring to move.',
  'Rocks and containers give cover where you stand: ⛊ full, ◐ half. Aliens stay hidden until a marine sees them. Move the others, then End turn.',
  'Contact! Tap an alien to see your hit chance, then Fire. If it has no cover on your side it is FLANKED: an easy crit.',
  'Overwatch shoots the first alien that moves. Each class has an ability: Grenade, Shield wall, Aimed shot. Kills earn ◆ Focus; spend 2 to Drop in and fight live for 20s.',
];
function tutShow(i) {
  turn.tut = i;
  const c = $('coach'); if (!c) return;
  c.innerHTML = `<p>${TUT[i]}</p><button id="coachX">${i === TUT.length - 1 ? 'Got it' : 'Hide tips'}</button>`;
  c.classList.remove('hidden');
  $('coachX').onclick = () => tutDone();
}
function tutDone() { turn.tut = -1; $('coach').classList.add('hidden'); try { localStorage.setItem('hivefall.tut', 'done'); } catch (e) { /* ignore */ } }
function tutStart() {
  let done = false; try { done = localStorage.getItem('hivefall.tut') === 'done'; } catch (e) { /* ignore */ }
  if (!done && camp.m && camp.m.story && story.checkpoint === 0) tutShow(0);
}
function tutEvent(ev) {
  if (turn.tut < 0) return;
  const i = { move: 1, contact: 2, shot: 3 }[ev];
  if (ev === 'live') tutDone(); else if (i > turn.tut) tutShow(i);
}
tapButton($('btnHunker'), tbHunker);
tapButton($('btnTGren'), tbGrenadeTool);
tapButton($('btnTNext'), tbNext);
tapButton($('btnEndTurn'), () => tbEndTurn());
function turnKey(code) {
  if (code === 'Enter' || code === 'Backspace') tbEndTurn();
  else if (code === 'KeyO' || code === 'KeyY') tbOverwatch();
  else if (code === 'KeyH') tbHunker();
  else if (code === 'KeyF') tbDropIn();
  else if (code === 'Space') toggleFast();
  else if (code === 'KeyG') tbGrenadeTool();
  else if (code === 'Tab' || code === 'KeyN') tbNext();
  else if (code === 'Escape') { turn.pending = null; turn.tool = 'move'; }
  else if (code === 'Digit1') buy('trooper');
  else if (code === 'Digit2') buy('heavy');
  else if (code === 'Digit3') buy('sniper');
}

// ---------------------------------------------------------------- campaign: five missions across the Kepler sector, with a squad that remembers
// Marines have names, earn rank from kills and missions, and a marine who falls in a mission is gone for good.
// Everything lives in localStorage; the page reloads between missions so each one starts from a clean world.
const CAMP_KEY = 'hivefall.campaign';
const MISSIONS = [
  { id: 'crash', name: 'Crash Site', where: 'Kepler canyons', kind: 'live', story: 'crash', squad: 4, ore: 0,
    goal: { type: 'story' }, goalText: 'Fight through the canyons to the colony relay and find the survivor',
    twist: 'Story mission with checkpoints: if your squad is wiped out, you restart from the last one. Ore buys reinforcements, dropped at your last checkpoint.',
    brief: 'The colony went dark three days ago. On approach, something hit our dropship. We are going down in the canyons, miles from anywhere.' },
  { id: 'holdline', name: 'Hold the Line', where: 'Refinery approach', kind: 'tactics', squad: 6, ore: 80,
    goal: { type: 'rounds', n: 6 }, goalText: 'Hold the outpost for 6 turns',
    twist: 'Swarm surge: more aliens every turn', surge: 2, tyrantEvery: 99, tb: { turns: 6, spawn: 3, every: 1 },
    brief: 'The refinery crews are evacuating through our outpost. Buy them six rounds. Turrets are your friend.' },
  { id: 'hunt', name: 'Tyrant Hunt', where: 'Crashed freighter', kind: 'live', squad: 5, ore: 60,
    goal: { type: 'tyrant' }, goalText: 'Kill the Hive Tyrant',
    twist: 'The Tyrant comes out on turn 3, with 50% more health', waveMul: 1.2, firstWave: 20, tyrantAt: 45, tyrantHp: 1.5, tb: { spawn: 2, every: 2, tyrantAt: 3 },
    brief: 'Something big is directing the swarm. Draw it out and put it down. Drop in and fight it yourself if you have to.' },
  { id: 'blackout', name: 'Blackout', where: 'Habitat domes', kind: 'live', squad: 6, ore: 60,
    goal: { type: 'time', t: 180 }, goalText: 'Survive for 8 turns', tb: { turns: 8, spawn: 2, every: 1 },
    twist: 'Dust storm: you can barely see past your squad', fog: [6, 34], waveMul: 0.85, firstWave: 12, tyrantAt: 120,
    brief: 'A storm is rolling over the domes and the swarm moves with it. Hold the outpost until the dropship can land.' },
  { id: 'hivefall', name: 'Hivefall', where: 'The main hive', kind: 'tactics', squad: 6, ore: 120,
    goal: { type: 'hive' }, goalText: 'Break the bio-shield and destroy the hive',
    twist: 'The Hive Tyrant joins the fight every 4 turns', surge: 1, tyrantEvery: 3, tb: { spawn: 2, every: 2, tyrantEvery: 4 },
    brief: 'This is it. Hold the relays, drop the shield and burn the hive. Bring your best marines home.' },
];
const SURNAMES = ['Reyes', 'Okafor', 'Lindqvist', 'Tanaka', 'Moreau', 'Brandt', 'Kowalski', 'Haddad', 'Nakamura', 'Petrov', 'Mbeki', 'Silva',
  "O'Neill", 'Castillo', 'Novak', 'Adeyemi', 'Larsen', 'Choi', 'Duarte', 'Varga', 'Ito', 'Achterberg', 'Mensah', 'Rossi', 'Kaur', 'Fischer', 'Quinn', 'Sato'];
const RANKS = [{ tag: 'Pvt', name: 'Private', xp: 0 }, { tag: 'Cpl', name: 'Corporal', xp: 5 }, { tag: 'Sgt', name: 'Sergeant', xp: 12 }, { tag: 'Lt', name: 'Lieutenant', xp: 22 }];
const rankOf = xp => { let r = 0; RANKS.forEach((k, i) => { if (xp >= k.xp) r = i; }); return r; };
const callsign = m => `${RANKS[rankOf(m.xp)].tag}. ${m.name}`;
const chevrons = r => ['', '▲', '▲▲', '★'][r] || '';
const camp = { m: null, idx: -1, t: 0, deployed: [], done: false };

function campLoad() {
  try { const s = JSON.parse(localStorage.getItem(CAMP_KEY)); if (s && s.v === 1) return s; } catch (e) { /* fresh */ }
  return null;
}
function campSave(s) { try { localStorage.setItem(CAMP_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: progress lasts this page only */ } }
function freshName(s) {
  const used = new Set(s.roster.map(m => m.name));
  const free = SURNAMES.filter(n => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : SURNAMES[s.nextId % SURNAMES.length] + ' ' + (2 + Math.floor(s.nextId / SURNAMES.length));
}
function recruit(s, type) {
  const m = { id: s.nextId++, name: freshName(s), type, xp: 0, kills: 0, missions: 0, status: 'active' };
  s.roster.push(m);
  return m;
}
function topUp(s) { // keep at least six marines, with one juggernaut and one ranger, so a bad mission never ends the campaign
  const active = () => s.roster.filter(m => m.status === 'active');
  const added = [];
  while (active().length < 6) {
    const a = active();
    const type = !a.some(m => m.type === 'heavy') ? 'heavy' : !a.some(m => m.type === 'sniper') ? 'sniper' : 'trooper';
    added.push(recruit(s, type));
  }
  return added;
}
function campNew() {
  const s = { v: 1, unlocked: 0, won: [], roster: [], nextId: 1, log: [] };
  for (const t of ['trooper', 'trooper', 'trooper', 'heavy', 'sniper', 'trooper']) recruit(s, t);
  campSave(s);
  return s;
}
let campState = campLoad();

// ---- sector map + briefing
let campSel = 0, campPick = null;
function openCampaign() {
  if (!campState) campState = campNew();
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
  $('camp').classList.remove('hidden');
  campSel = Math.min(campState.unlocked, MISSIONS.length - 1);
  campPick = null;
  renderCampaign();
}
function defaultPick(m) {
  const active = campState.roster.filter(r => r.status === 'active').sort((a, b) => b.xp - a.xp);
  const pick = [];
  for (const t of ['heavy', 'sniper']) { const r = active.find(x => x.type === t); if (r && pick.length < m.squad) pick.push(r.id); }
  for (const r of active) if (pick.length < m.squad && !pick.includes(r.id)) pick.push(r.id);
  return pick;
}
function perkRow(r, rk) { // chosen perks, and a pick between two when a promotion is waiting
  const have = r.perks || [];
  const chosen = have.length ? `<p class="perks">Perks: ${have.map(k => `<b title="${PERKS[k].text}">${PERKS[k].name}</b>`).join(' · ')}</p>` : '';
  if (have.length >= rk || !PERK_TREE[r.type]) return chosen;
  const opts = PERK_TREE[r.type][have.length];
  return `${chosen}<div class="perkPick"><span>★ Promotion: pick a perk for ${r.name}</span>${opts.map(k => `<button class="perkOpt" data-id="${r.id}" data-perk="${k}"><b>${PERKS[k].name}</b><small>${PERKS[k].text}</small></button>`).join('')}</div>`;
}
function renderCampaign() {
  const s = campState, m = MISSIONS[campSel];
  if (!campPick) campPick = defaultPick(m);
  const nodes = MISSIONS.map((x, i) => {
    const locked = i > s.unlocked, won = s.won.includes(x.id);
    return `<button class="node${i === campSel ? ' on' : ''}${locked ? ' locked' : ''}${won ? ' won' : ''}" data-i="${i}" ${locked ? 'disabled' : ''}>
      <b>${won ? '✓' : locked ? '🔒' : i + 1}</b><span>${x.name}</span></button>`;
  }).join('<i class="link"></i>');
  const active = s.roster.filter(r => r.status === 'active').sort((a, b) => b.xp - a.xp);
  const fallen = s.roster.filter(r => r.status === 'kia');
  const row = r => {
    const rk = rankOf(r.xp), on = campPick.includes(r.id);
    const next = RANKS[rk + 1];
    return `<div class="marWrap"><button class="mar${on ? ' on' : ''}" data-id="${r.id}"><i>${ICONS[r.type]}</i><span><b>${callsign(r)}</b><small>${NAMES[PLAYER][r.type]} · ${r.kills} kills · ${r.missions} missions${(r.relics || []).length ? ` · ${r.relics.length} relic${r.relics.length > 1 ? "s" : ""}` : ""}${next ? ` · ${next.xp - r.xp} xp to ${next.tag}` : ''}</small></span><em>${chevrons(rk)}</em></button>${perkRow(r, rk)}</div>`;
  };
  $('campMap').innerHTML = nodes;
  $('campBrief').innerHTML = `
    <h2>${campSel + 1}. ${m.name} <small>${m.where}</small></h2>
    <p class="brief">${m.brief}</p>
    <p class="goal"><b>🎯 ${m.goalText}</b></p>
    <p class="twist">⚠ ${m.twist}</p>
    <p class="kind">Turn-based: 2 actions per marine, cover, flanking and overwatch, then the swarm moves · start with 💠 ${m.ore}</p>
    <h3>Squad <small>${campPick.length} / ${m.squad} deployed · tap to swap</small></h3>
    <div class="roster">${active.map(row).join('')}</div>
    ${fallen.length ? `<p class="fallen">Fallen: ${fallen.map(r => `${callsign(r)} (${r.diedIn})`).join(' · ')}</p>` : ''}`;
  $('btnLaunch').disabled = !campPick.length;
}
$('campMap').addEventListener('click', e => {
  const b = e.target.closest('.node'); if (!b || b.disabled) return;
  campSel = +b.dataset.i; campPick = null; renderCampaign();
});
$('campBrief').addEventListener('click', e => {
  const po = e.target.closest('.perkOpt');
  if (po) { const r = campState.roster.find(x => x.id === +po.dataset.id); if (r) { (r.perks = r.perks || []).push(po.dataset.perk); campSave(campState); toast(`${r.name}: ${PERKS[po.dataset.perk].name}`, 1.2); } renderCampaign(); return; }
  const b = e.target.closest('.mar'); if (!b) return;
  const id = +b.dataset.id, m = MISSIONS[campSel];
  if (campPick.includes(id)) campPick = campPick.filter(x => x !== id);
  else if (campPick.length < m.squad) campPick.push(id);
  else toast(`This mission takes ${m.squad} marines`, 1.2);
  renderCampaign();
});
tapButton($('btnCamp'), openCampaign);
tapButton($('btnHow'), () => { $('menu').classList.add('hidden'); $('how').classList.remove('hidden'); });
tapButton($('btnHowBack'), () => { $('how').classList.add('hidden'); $('menu').classList.remove('hidden'); });
tapButton($('btnCampBack'), () => { $('camp').classList.add('hidden'); $('menu').classList.remove('hidden'); });
tapButton($('btnCampReset'), () => {
  if (!confirm('Start a new campaign? Your squad and progress will be lost.')) return;
  campState = campNew(); campSel = 0; campPick = null; renderCampaign();
});
tapButton($('btnLaunch'), () => relaunch(campSel, campPick, 0));
// every mission starts from a fresh page, so story missions can build their own map (and checkpoints can restart cleanly)
function relaunch(i, pick, checkpoint) {
  try { sessionStorage.setItem('hivefall.launch', JSON.stringify({ mission: i, pick, checkpoint, story: MISSIONS[i].story || null })); } catch (e) { launchMission(i, pick, checkpoint); return; }
  location.reload();
}

function launchMission(i, pick, checkpoint = 0) {
  const m = MISSIONS[i];
  camp.m = m; camp.idx = i; camp.t = 0; camp.done = false; camp.pick = pick;
  $('camp').classList.add('hidden');
  // swap the default squad for the marines you picked
  for (const e of entities) if (e.team === PLAYER && !e.isBase && !e.isTower) { e.dead = true; scene.remove(e.mesh); }
  entities = entities.filter(e => !e.dead);
  let spots = [[-4.5, 17], [4.5, 17], [-1.5, 17], [1.5, 17], [-3, 19.5], [3, 19.5], [0, 19.5], [-6, 19.5]]; // roomy: marines are drawn big in turns
  if (m.story) { // the swarm here is scripted: clear the default aliens and start at the checkpoint
    for (const e of entities) if (e.team === ENEMY && !e.isBase) { e.dead = true; scene.remove(e.mesh); }
    entities = entities.filter(e => !e.dead);
    const [cx, cz] = STORIES[m.story][checkpoint].cp;
    spots = [[-1, 0], [1, 0], [0, 1.5], [-1.5, 1.5], [1.5, 1.5], [0, -1.5], [-2, -1], [2, -1]].map(([a, b]) => [cx + a * 1.6, cz + b * 1.6]);
  }
  camp.deployed = [];
  pick.forEach((id, k) => {
    const r = campState.roster.find(x => x.id === id); if (!r) return;
    const [x, z] = spots[k % spots.length];
    const u = makeUnit(PLAYER, r.type, x, z);
    applyRank(u, r);
    camp.deployed.push(u);
  });
  if (m.fog) { scene.traverse(o => { if (o.material === skyMat) o.visible = false; }); scene.fog.near = m.fog[0]; scene.fog.far = m.fog[1]; scene.background.setHex(0x8a6a58); scene.fog.color.setHex(0x8a6a58); }
  // every campaign mission is turn-based: arena missions start with a pack of aliens already coming for you
  if (!m.story) {
    for (const e of entities) if (e.team === ENEMY && !e.isBase) { e.dead = true; scene.remove(e.mesh); }
    entities = entities.filter(e => !e.dead);
    const extra = { hunt: [['burrower', 0, -10]], blackout: [['shielder', 0, -16]], hivefall: [['eggsac', -6, -16], ['eggsac', 6, -16], ['shielder', 0, -17]] }[m.id] || [];
    for (const [t, x, z] of [['trooper', -14, -15], ['trooper', 14, -15], ['trooper', -4, -13], ['trooper', 4, -13], ['heavy', -9, -18], ['heavy', 9, -18], ['sniper', -2, -20], ['sniper', 2, -20], ...extra]) makeUnit(ENEMY, t, x, z).alert = true;
  }
  game.cp = m.ore;
  startTurns();
  if (m.story) { storyStart(checkpoint); return; }
  setTimeout(() => radio(`Mission ${i + 1}: ${m.name}. ${m.goalText}.`, 'good'), m.kind === 'tactics' ? 3200 : 2600);
}
function applyRank(u, r) {
  const rk = rankOf(r.xp);
  u.rid = r.id; u.callsign = callsign(r); u.rank = rk;
  const k = 1 + 0.12 * rk;
  u.maxHp = Math.round(u.maxHp * k); u.hp = u.maxHp;
  u.dmg *= 1 + 0.1 * rk;
  if (rk >= 3) u.acc = Math.min(0.95, u.acc + 0.05);
  for (const k of r.relics || []) applyRelic(u, k);
  u.relics = (r.relics || []).slice();
  u.perks = (r.perks || []).slice();
}

// ---- during a mission
function campaignTick(dt) {
  const m = camp.m; if (!m || camp.done || mode === 'over') return;
  if (!(tac.on && tac.phase === 'plan')) camp.t += dt;
  if (m.fog) { // the storm closes in around the camera, wherever it is
    const d = mode === 'fps' ? 0 : camera.position.distanceTo(rts.focus);
    scene.fog.near = Math.max(2, d + m.fog[0] - (d ? 10 : 0)); scene.fog.far = d + m.fog[1] - (d ? 14 : 0);
  }
  const g = m.goal;
  if (g.type === 'story') storyTick(dt);
  if (g.type === 'relays' && points.every(p => p.owner === PLAYER)) campaignWin('All three relays are ours. The fleet has a signal.');
  if (turn.on && (g.type === 'time' || g.type === 'rounds') && turn.side === 'player' && turn.n > m.tb.turns) campaignWin(g.type === 'time' ? 'The storm passes and the dropship lands. Outpost held.' : `The refinery crews are out. ${m.tb.turns} turns held.`);
  if (turn.on) return;
  if (g.type === 'time' && camp.t >= g.t) campaignWin('The storm passes and the dropship lands. Outpost held.');
  if (g.type === 'rounds' && tac.on && tac.phase === 'plan' && tac.round > g.n) campaignWin(`The refinery crews are out. ${g.n} rounds held.`);
}
function campaignObjective() {
  const m = camp.m; if (!m) return '';
  const g = m.goal;
  let txt = m.goalText;
  if (g.type === 'relays') txt = `Relays ${points.filter(p => p.owner === PLAYER).length}/3`;
  if (g.type === 'time') txt = `Survive ${Math.max(0, Math.ceil(g.t - camp.t))}s`;
  if (g.type === 'rounds') txt = `Round ${Math.min(tac.round, g.n)}/${g.n}`;
  if (g.type === 'tyrant') txt = entities.some(e => e.elite && !e.dead) ? 'Kill the Tyrant!' : `Tyrant in ${Math.max(0, Math.ceil(eliteTimer))}s`;
  if (g.type === 'hive') txt = enemyBase.shield ? 'Drop the shield' : 'Destroy the hive!';
  if (g.type === 'story') txt = storyGoal();
  if (turn.on && (g.type === 'time' || g.type === 'rounds')) txt = `Hold out: turn ${Math.min(turn.n, m.tb.turns)}/${m.tb.turns}`;
  if (turn.on && g.type === 'tyrant' && !entities.some(e => e.elite && !e.dead)) txt = `Tyrant arrives on turn ${m.tb.tyrantAt}`;
  return `<span class="chip obj">🎯 ${txt}</span>`;
}
function campaignWin(text) { if (!camp.done) endGame(true, text); }
function campaignKill(e, src) {
  if (!camp.m) return;
  if (e.team === ENEMY && src && src.rid) src.kills = (src.kills || 0) + 1;
  if (turn.on && e.team === ENEMY && src && src.team === PLAYER && turn.fp < FOCUS_MAX) { turn.fp++; floatText(e.x, e.z - 0.01, '+1 ◆', '#c9a0ff', false); }
  if (e.team === ENEMY && e.elite && camp.m.goal.type === 'tyrant') setTimeout(() => campaignWin('The Hive Tyrant is dead. The swarm is leaderless.'), 1200);
  if (e.team === PLAYER && e.callsign) radio(`${e.callsign} is down. KIA.`, 'warn');
}

// ---- debrief: write the results into the roster and show what happened to everyone
function campaignEnd(won) {
  camp.done = true;
  const s = campState, m = camp.m;
  const lines = [];
  for (const u of camp.deployed) {
    const r = s.roster.find(x => x.id === u.rid); if (!r) continue;
    const kills = u.kills || 0;
    if (u.dead) {
      r.status = 'kia'; r.diedIn = m.name; r.kills += kills;
      lines.push(`<li class="kia"><i>${ICONS[r.type]}</i><b>${callsign(r)}</b><span>${kills} kills · killed in action</span></li>`);
      continue;
    }
    const found = (u.relics || []).slice((r.relics || []).length);
    r.relics = (u.relics || []).slice();
    const before = rankOf(r.xp);
    r.kills += kills; r.missions++;
    r.xp += kills + 2 + (won ? 2 : 0);
    const after = rankOf(r.xp);
    lines.push(`<li><i>${ICONS[r.type]}</i><b>${callsign(r)}</b><span>${kills} kills${after > before ? ` · <em>promoted to ${RANKS[after].name}! Pick a perk on the map</em>` : ''}${found.length ? ` · <em class="relic">found ${found.map(k => RELICS[k].name).join(', ')}</em>` : ''}</span></li>`);
  }
  // reinforcements you deployed during the mission and who made it join the roster
  const fresh = entities.filter(e => !e.dead && e.team === PLAYER && !e.isBase && !e.isTower && !e.rid);
  for (const u of fresh.slice(0, Math.max(0, 10 - s.roster.filter(r => r.status === 'active').length))) {
    const r = recruit(s, u.type); r.kills = u.kills || 0; r.xp = r.kills + 2; r.missions = 1;
    lines.push(`<li class="new"><i>${ICONS[r.type]}</i><b>${callsign(r)}</b><span>reinforcement, joins the squad</span></li>`);
  }
  if (won && !s.won.includes(m.id)) s.won.push(m.id);
  if (won) s.unlocked = Math.max(s.unlocked, Math.min(MISSIONS.length - 1, camp.idx + 1));
  const recruits = topUp(s);
  s.log.push({ m: m.id, won, at: Date.now() });
  campSave(s);
  const finale = won && camp.idx === MISSIONS.length - 1;
  return {
    title: finale ? 'Campaign complete!' : won ? 'Mission accomplished' : 'Mission failed',
    html: `<ul class="debrief">${lines.join('')}</ul>${recruits.length ? `<p class="recruits">New recruits: ${recruits.map(callsign).join(', ')}</p>` : ''}`,
  };
}
tapButton($('btnRetryCp'), () => relaunch(camp.idx, camp.pick, story.checkpoint));
tapButton($('btnToMap'), () => { try { sessionStorage.setItem('hivefall.openMap', '1'); } catch (e) { /* ignore */ } location.reload(); });
if (LAUNCH) setTimeout(() => { if (!campState) campState = campNew(); launchMission(LAUNCH.mission, LAUNCH.pick, LAUNCH.checkpoint || 0); }, 0);
try { if (sessionStorage.getItem('hivefall.openMap')) { sessionStorage.removeItem('hivefall.openMap'); openCampaign(); } } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- story missions: scripted objectives, checkpoints, radio dialogue and plot twists
// Each step has a checkpoint position (cp: where the squad restarts), an objective and a script that runs when it begins.
// Finish conditions: reach a spot (at + r), clear the area around it (clear), reboot a relay (relay), or survive (survive seconds).
const STORIES = {
  crash: [
    { name: 'Crash site', cp: [0, 21], at: [-16, 13], r: 4.5, goal: 'Reach checkpoint Alpha',
      run() {
        say([['Pilot', 'Mayday, mayday! We are going down!'], ['Sgt', 'Everyone out, form up on me. Check your gear.'],
          ['Command', 'Your only way to the colony is the canyon to the west. Move to checkpoint Alpha.']]);
        foes([['trooper', -14, 4], ['trooper', -12, 5], ['trooper', -16, 6]], 'idle');
      } },
    { name: 'Checkpoint Alpha', cp: [-16, 12], at: [14, -2], r: 6, clear: 11, goal: 'Clear the mining camp',
      run() {
        say([['Command', 'Checkpoint Alpha. Your progress is saved.'], ['Ranger', 'Tracks everywhere. Something dragged equipment out of here.'],
          ['Command', 'Mining camp to the east. Clear it. There could be survivors.']]);
        foes([['trooper', 12, -6], ['trooper', 16, -3], ['heavy', 14, 2], ['sniper', 19, -5], ['sniper', 9, 0], ['eggsac', 17, -8]], 'idle');
      } },
    { name: 'Checkpoint Bravo', cp: [12, -1], at: [2, -15], r: 5, goal: 'Reach the comms relay',
      run() {
        say([['Command', 'Checkpoint Bravo. Camp clear?'], ['Sgt', 'Clear. No survivors. Just empty bunks.'],
          ['???', '...this is Ada Brecht at the north relay... please, they are everywhere... please hurry...'],
          ['Sgt', 'You heard her. Move up to the relay, double time.']]);
        foes([['trooper', 19, -13], ['shielder', 18, -15], ['trooper', 17, -16], ['sniper', 8, -19], ['trooper', -6, -18]], 'idle');
      } },
    { name: 'The relay', cp: [12, -13], relay: 0.35, goal: 'Reboot the relay: end a turn with a marine on it', marker: 'relay',
      run() {
        say([['Command', 'Checkpoint Charlie. Saved.'], ['Sgt', 'Nobody here. Where is Brecht?'],
          ['Command', 'Reboot the relay so the fleet can find you. Someone has to stand on it.']]);
      } },
    { name: 'Ambush', twist: true, survive: 45, goal: 'Survive until the relay is back online', marker: 'relay',
      run() {
        say([['Ranger', 'Sarge... the message. Brecht\'s message. It\'s a recording.'], ['Command', 'Confirmed. It has been looping for three days.'],
          ['Sgt', 'It was never a survivor. It\'s a LURE! Contacts, all around us!']], 1.6);
        twistBanner('IT WAS A TRAP');
        const ring = [[15, -14], [16, -19], [10, -21], [-6, -21], [-11, -18], [-11, -12], [-5, -11], [9, -11], [13, -11], [19, -11], [4, -21]]
          .map(([x, z], k) => [k === 1 || k === 6 ? 'burrower' : k === 8 ? 'shielder' : k % 4 === 3 ? 'sniper' : k % 5 === 2 ? 'heavy' : 'trooper', x, z]);
        setTimeout(() => { for (const [, x, z] of ring) smoke(x, 0.5, z, 2, 6); foes(ring, 'hunt'); }, 1800);
        const tyrant = () => { if (!camp.done) { say([['Command', 'Something big is coming out of the hive. Hold on!']]); foes([['elite', 0, -24]], 'hunt'); } };
        if (turn.on) story.later.push([2, tyrant]); else setTimeout(tyrant, 22000);
      } },
  ],
};
const story = { def: null, step: -1, t: 0, checkpoint: 0, beam: null, queue: [], sayT: 0 };
function storyStart(checkpoint) {
  document.body.classList.add('story');
  story.def = STORIES[camp.m.story]; story.checkpoint = checkpoint;
  const [cx, cz] = story.def[checkpoint].cp;
  rts.focus.set(cx, 0, cz - 6);
  const beam = noRay(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 30, 16, 1, true), new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.4, 1.4, 2.4), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
  beam.position.y = 15; scene.add(beam); story.beam = beam;
  storyStep(checkpoint);
}
function storyStep(i) {
  story.step = i; story.t = 0; story.turns = 0; story.later = []; story.queue = []; story.sayT = 0; // stale lines from the last step are dropped
  const st = story.def[i];
  if (st.cp && i > 0) story.checkpoint = i; // reaching a step with a checkpoint saves it
  st.run();
}
function storyMarker() {
  if (!story.def || story.step < 0 || camp.done) return null;
  const st = story.def[story.step];
  if (st.marker === 'relay' || st.relay) return { x: points[0].x, z: points[0].z, name: st.twist ? 'HOLD' : 'Relay' };
  return st.at ? { x: st.at[0], z: st.at[1], name: st.clear ? 'Camp' : story.def[story.step + 1] ? story.def[story.step + 1].name : 'Goal' } : null;
}
function storyGoal() {
  if (!story.def || story.step < 0) return '';
  const st = story.def[story.step];
  if (st.survive && turn.on) { const n = Math.max(0, tbSurvive(st) - (story.turns || 0)); return `${st.goal}: ${n} turn${n === 1 ? '' : 's'}`; }
  if (st.survive) return `${st.goal}: ${Math.max(0, Math.ceil(st.survive - story.t))}s`;
  if (st.relay) return `${st.goal} (${Math.round(Math.max(0, points[0].prog) / st.relay * 100)}%)`;
  return st.goal;
}
function storyTick(dt) {
  if (!story.def || story.step < 0) return;
  story.t += dt;
  // dialogue plays line by line
  story.sayT -= dt;
  if (story.queue.length && story.sayT <= 0) { const [who, line, gap] = story.queue.shift(); radio(`${who}: ${line}`, who === '???' ? 'warn' : 'good'); story.sayT = gap; }
  const mk = storyMarker();
  if (story.beam) { story.beam.visible = !!mk; if (mk) story.beam.position.set(mk.x, 15, mk.z); }
  if (!playerUnits().length) { endGame(false, 'The squad was wiped out.'); return; }
  const st = story.def[story.step];
  let done = false;
  if (st.at) {
    const near = playerUnits().some(u => Math.hypot(u.x - st.at[0], u.z - st.at[1]) < st.r);
    done = near && (!st.clear || !entities.some(e => !e.dead && e.team === ENEMY && !e.isBase && Math.hypot(e.x - st.at[0], e.z - st.at[1]) < st.clear));
  }
  if (st.relay) done = points[0].prog >= st.relay;
  if (st.survive) done = turn.on ? (story.turns || 0) >= tbSurvive(st) && turn.side === 'player' : story.t >= st.survive;
  if (!done) return;
  if (story.step + 1 < story.def.length) storyStep(story.step + 1);
  else campaignWin('The relay is up. The fleet is coming, and now they know: the hive is smart enough to set traps.');
}
function say(lines, gap = 2.6) {
  for (const [who, line] of lines) story.queue.push([who, line, gap + line.length * 0.025]);
  if (story.sayT > 0.6) story.sayT = 0.6;
}
function foes(list, how) {
  const out = [];
  for (const [t, x, z] of list) {
    const u = makeUnit(ENEMY, t, x, z);
    if (turn.on) { if (how === 'hunt') u.alert = true; }
    else if (how === 'hunt') { const tgt = possessed || playerUnits()[0]; if (tgt) commandMove([u], tgt.x, tgt.z, 'amove', true); }
    out.push(u);
  }
  return out;
}
function twistBanner(text) {
  const b = $('twist'); if (!b) return;
  b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  sfx('boom'); fps.shake = Math.min(0.5, fps.shake + 0.4);
}
function storyOverlay() {
  const mk = storyMarker(); if (!mk) return;
  const ref = possessed || rts.focus;
  const d = Math.round(Math.hypot(mk.x - ref.x, mk.z - ref.z));
  const sp = toScreen(mk.x, 3.2, mk.z);
  if (sp.behind) return;
  octx.textAlign = 'center'; octx.font = '800 13px Rajdhani, system-ui';
  octx.lineWidth = 4; octx.strokeStyle = 'rgba(0,0,0,.75)';
  const txt = `▼ ${mk.name.toUpperCase()} · ${d}m`;
  octx.strokeText(txt, sp.x, sp.y); octx.fillStyle = '#7fe0ff'; octx.fillText(txt, sp.x, sp.y);
}

// ---------------------------------------------------------------- music: a dark cinematic score, synthesized live with WebAudio
// Layers over a slow minor progression: a low drone and string ensemble (always), a pulsing low ostinato with distant
// pings (in the field), and war drums with brass swells (when aliens close in). Layers cross-fade with the battle.
const music = { on: true, started: false, step: 0, next: 0, bus: null, layers: null, intensity: 0, target: 0, timer: null };
try { music.on = localStorage.getItem('hivefall.music') !== 'off'; } catch (e) { /* default on */ }
const BPM = 70, SIXTEENTH = 60 / BPM / 4, BAR = SIXTEENTH * 16;
// D minor, two bars per chord: Dm(add9) - Bbmaj7 - Gm - Asus4/A
const CHORDS = [[38, 50, 53, 57, 64], [34, 50, 53, 57, 58], [31, 50, 55, 58, 62], [33, 50, 52, 57, 61]];
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
function musicStart() {
  if (!audio || music.started) return;
  music.started = true;
  const comp = audio.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
  const master = audio.createGain(); master.gain.value = music.on ? 0.6 : 0;
  // a long hall reverb (generated) makes the synths sound like an orchestra in a big space
  const len = audio.sampleRate * 3.5, ir = audio.createBuffer(2, len, audio.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2) * (i < 800 ? i / 800 : 1); }
  const hall = audio.createConvolver(); hall.buffer = ir;
  const wet = audio.createGain(); wet.gain.value = 0.55; hall.connect(wet); wet.connect(master);
  master.connect(comp); comp.connect(audio.destination);
  const layer = (v, send) => { const g = audio.createGain(); g.gain.value = v; g.connect(master); const s = audio.createGain(); s.gain.value = send; g.connect(s); s.connect(hall); return g; };
  music.bus = master;
  music.layers = { strings: layer(0.5, 0.8), pulse: layer(0, 0.6), drums: layer(0, 0.35) };
  // the drone runs continuously: two detuned low saws with a slowly breathing filter
  const droneF = audio.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 220; droneF.Q.value = 3;
  const lfo = audio.createOscillator(), lfoG = audio.createGain(); lfo.frequency.value = 0.05; lfoG.gain.value = 120; lfo.connect(lfoG); lfoG.connect(droneF.frequency); lfo.start();
  const droneG = audio.createGain(); droneG.gain.value = 0.18; droneF.connect(droneG); droneG.connect(music.layers.strings);
  for (const d of [-6, 5]) { const o = audio.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(26); o.detune.value = d; o.connect(droneF); o.start(); }
  const sub = audio.createOscillator(); sub.frequency.value = mtof(26); const subG = audio.createGain(); subG.gain.value = 0.12; sub.connect(subG); subG.connect(music.layers.strings); sub.start();
  music.drone = { osc: [sub] };
  music.next = audio.currentTime + 0.1;
  music.timer = setInterval(musicSchedule, 60);
}
function musicSetOn(on) {
  music.on = on;
  try { localStorage.setItem('hivefall.music', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  const b = $('btnMusic'); if (b) b.textContent = on ? '♪ Music: on' : '♪ Music: off';
  if (music.bus) music.bus.gain.setTargetAtTime(on ? 0.6 : 0, audio.currentTime, 0.4);
}
function musicSchedule() {
  if (!audio || audio.state !== 'running') return;
  let target = 0;
  if (mode === 'rts' || mode === 'fps') {
    target = 1;
    const mine = playerUnits();
    if (entities.some(e => !e.dead && e.team === ENEMY && !e.isBase && mine.some(u => Math.hypot(u.x - e.x, u.z - e.z) < 16))) target = 2;
    if (tac.on && tac.phase === 'plan') target = 1;
  }
  if (mode === 'over') target = 0;
  music.target = target;
  music.intensity += (target - music.intensity) * 0.03;
  const L = music.layers, now = audio.currentTime, k = music.intensity;
  L.strings.gain.setTargetAtTime(0.5 + Math.max(0, k - 1) * 0.15, now, 0.8);
  L.pulse.gain.setTargetAtTime(Math.min(1, k) * 0.5, now, 1.2);
  L.drums.gain.setTargetAtTime(Math.max(0, k - 1) * 0.85, now, 0.8);
  while (music.next < now + 0.3) { musicStep(music.step, music.next); music.step++; music.next += SIXTEENTH; }
}
function musicStep(i, t) {
  const bar = Math.floor(i / 16), s = i % 16, chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
  const L = music.layers;
  if (s === 0 && bar % 2 === 0) { // strings: a slow swell over two bars
    chord.slice(1).forEach((n, k) => strings(mtof(n), t + k * 0.05, BAR * 2.05, L.strings, k === chord.length - 2 ? 0.6 : 1));
    strings(mtof(chord[0] + 12), t, BAR * 2.05, L.strings, 0.9);
  }
  if (music.intensity > 0.05) {
    if (s % 2 === 0) ostinato(mtof(chord[0] + (s === 8 || s === 14 ? 12 : 0)), t, L.pulse);
    if (s === 6 && bar % 2 === 1) sonarPing(mtof(chord[2 + (bar % 3)] + 12), t, L.pulse);
  }
  if (music.intensity > 1.05) { // war drums and brass
    if (s === 0 || s === 3 || s === 8 || (s === 11 && bar % 2) || (s === 14 && bar % 4 === 3)) taiko(t, L.drums, s === 0 ? 1 : 0.7);
    if (s === 4 || s === 12) rimShot(t, L.drums);
    if (s === 0 && bar % 2 === 0) brass(chord.slice(0, 3).map(n => mtof(n + 12)), t, L.drums);
  }
}
function env(g, t, a, hold, r, peak) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
}
function strings(freq, t, dur, out, v = 1) {
  const g = audio.createGain(); env(g, t, dur * 0.35, dur * 0.3, dur * 0.35, 0.022 * v);
  const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.5;
  const vib = audio.createOscillator(), vibG = audio.createGain(); vib.frequency.value = 4.8 + Math.random(); vibG.gain.value = 5; vib.connect(vibG);
  for (const d of [-11, -3, 4, 12]) {
    const o = audio.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d; vibG.connect(o.detune);
    o.connect(f); o.start(t); o.stop(t + dur + 0.1);
  }
  vib.start(t); vib.stop(t + dur + 0.1);
  f.connect(g); g.connect(out);
}
function ostinato(freq, t, out) {
  const o = audio.createOscillator(), f = audio.createBiquadFilter(), g = audio.createGain();
  o.type = 'sawtooth'; o.frequency.value = freq; f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.18);
  env(g, t, 0.005, 0.05, 0.14, 0.09);
  o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.25);
}
function sonarPing(freq, t, out) { // a distant metallic ping, like sonar in a cave
  for (const [m, v] of [[1, 0.05], [2.76, 0.015], [5.4, 0.008]]) {
    const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = freq * m;
    env(g, t, 0.003, 0.02, 1.8, v); o.connect(g); g.connect(out); o.start(t); o.stop(t + 2);
  }
}
function taiko(t, out, v) {
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.65);
  const src = audio.createBufferSource(); src.buffer = noiseBuf; const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  const ng = audio.createGain(); ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  src.connect(f); f.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.25);
}
function rimShot(t, out) {
  const src = audio.createBufferSource(); src.buffer = noiseBuf; const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 3;
  const g = audio.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + 0.1);
}
function brass(freqs, t, out) { // a low swelling brass chord
  for (const fr of freqs) {
    const o = audio.createOscillator(), f = audio.createBiquadFilter(), g = audio.createGain();
    o.type = 'sawtooth'; o.frequency.value = fr / 2; f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(1400, t + 0.9); f.frequency.linearRampToValueAtTime(300, t + 2.4);
    env(g, t, 0.8, 0.6, 1.2, 0.05);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 2.7);
  }
}
// browsers only allow sound after the first tap or key press: start the soundtrack then
function firstGesture() {
  initAudio();
  if (audio && audio.state === 'suspended') audio.resume();
  musicStart();
}
addEventListener('pointerdown', firstGesture, { capture: true });
addEventListener('keydown', firstGesture, { capture: true });
tapButton($('btnMusic'), () => { firstGesture(); musicSetOn(!music.on); });
musicSetOn(music.on);

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
    if (!e.isTower) { // on the turn map units are drawn bigger so you can find them on a phone: marines 2x, aliens 1.5x
      const want = turn.on && !turn.live && mode === 'rts' ? (e.team === PLAYER ? TB_MARINE_SCALE : TB_ALIEN_SCALE) : 1;
      e.big = (e.big || 1) + (want - (e.big || 1)) * Math.min(1, dt * 8);
    }
    if (turn.on && !turn.live && e.ring) e.ring.visible = false; // the turn UI draws its own team discs and selection ring
    { const q = Math.max(0, e.flash) * 1.4, b = (e.baseScale || 1) * (e.big || 1); e.mesh.scale.set(b * (1 + q), b * (1 - q), b * (1 + q)); } // squash when hit
    if (e.upper && !(tac.on && tac.phase === 'plan')) animateBird(e, dt, now);
    e.mesh.rotation.y = e.facing;
    // in first person, a squadmate brushing past the camera would fill the screen with armour for a frame: hide anyone that close
    e.mesh.visible = !e.possessed && !hiddenFoe(e) && !(mode === 'fps' && possessed && e.team === PLAYER && !e.isTower && Math.hypot(e.x - possessed.x, e.z - possessed.z) < 1.15);
    e.ring.visible = selection.includes(e) && mode !== 'fps';
    if (!e.elite) {
      e.bodyMat.emissive.setHex(e.flash > 0 ? 0xffffff : e.armorT > 0 ? 0x2266ff : 0);
      e.bodyMat.emissiveIntensity = e.flash > 0 ? 0.6 : e.armorT > 0 ? 0.5 : 0;
    }
    e.flash -= dt;
  }
  for (const p of points) { p.flag.rotation.y = now / 600 + p.x; p.flag.position.y = 1.25 + Math.sin(now / 400 + p.x) * 0.1; p.halo.rotation.z = -now / 900; p.halo.position.y = p.flag.position.y; }
  fps.hitMarker -= dt; fps.critMarker -= dt;
  if (fps.target) { fps.target.t -= dt; if (fps.target.t < 1.7) fps.target.trail = Math.max(fps.target.e.hp / fps.target.e.maxHp, fps.target.trail - dt * 0.8); if (fps.target.t <= 0 || fps.target.e.dead) fps.target = null; }
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
  if (camp.m) campaignTick(dt);
  if (turn.on && mode === 'rts') turnTick(dt);
  if (turn.on) liveTick(dt);
  if (mode !== 'menu') updateHud(dt); else if (toastTimer > 0) toastTimer -= dt;
  renderFrame(dt);
  drawOverlay();
  drawMinimap();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hook for automated smoke tests
window.__game = {
  camp, MISSIONS, openCampaign, launchMission, getCamp: () => campState, story, rts,
  get mode() { return mode; }, get entities() { return entities; }, get selection() { return selection; },
  get possessed() { return possessed; }, get enemyBase() { return enemyBase; }, points,
  game, fps, possess, exitFPS, startGame, commandMove, buy, useAbility, dropInNear, damage,
  setEliteTimer: t => { eliteTimer = t; }, setWaveTimer: t => { waveTimer = t; },
  dmgNums, raycaster, turn, tbDropIn, tbEndTurn, turnTap, shotInfo, tbOverwatch, tbGrenadeTool, tbMove, pickSpot, bestShot, tbLOS, coverFrom, alienAct, findPath, boxes, loot, scene, camera, simulate, makeUnit, tac, goLive, startTactics, toScreen, useUlt, wall, hawk, ducklings, buy, upgradeSelected, placeTower,
};
