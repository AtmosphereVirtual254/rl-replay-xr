import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArena, buildCar, buildBall, buildPad, TEAM } from './arena.js';

const SAMPLE = 'https://cdn.jsdelivr.net/gh/rlrml/subtr-actor@de36d0683f9c3fd1b4c8318f79537e636b51307a/assets/post-eac-ranked-doubles-2026-04-28.replay';
const $ = s => document.querySelector(s);
const ui = {
  file: $('#file'), sample: $('#sample'), status: $('#status'), play: $('#play'), seek: $('#seek'), marks: $('#marks'),
  speed: $('#speed'), cam: $('#cam'), clock: $('#clock'), s0: $('#s0'), s1: $('#s1'), banner: $('#banner'),
  vr: $('#vr'), ar: $('#ar'), drop: $('#drop'), info: $('#info'), bar: $('#bar'),
};

// ── Scene ────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const bg = new THREE.Color('#0b0e13');
scene.background = bg;
scene.add(new THREE.HemisphereLight('#cfe3ff', '#1a1410', 1.4));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(3, 10, 4);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 2000);
camera.position.set(95, 45, 0);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.49;

// stage: placement/scale in metres. root: RL frame (z-up, left-handed) → three (y-up, right-handed).
const stage = new THREE.Group(), root = new THREE.Group();
root.rotation.x = -Math.PI / 2;
root.scale.set(-1, 1, 1);
stage.add(root);
stage.scale.setScalar(0.01);
scene.add(stage);
root.add(buildArena());

const ball = buildBall();
const trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3)),
  new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
trail.frustumCulled = false;
const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: '#ff5a3c', transparent: true }));
root.add(ball, trail, boom);

// ── Replay state ─────────────────────────────────────────────────────────────
let R = null, cars = [], pads = [], t = 0, playing = false, speed = 1, follow = -1;
const worker = new Worker(new URL('./replay-worker.js', import.meta.url), { type: 'module' });

function load(bytes, label) {
  ui.status.textContent = `Parsing ${label}…`;
  playing = false;
  worker.onmessage = ({ data }) => data.error ? (ui.status.textContent = `Couldn't parse: ${data.error}`) : setReplay(data.replay, label);
  worker.postMessage(bytes, [bytes]);
}

async function loadUrl(url) {
  ui.status.textContent = 'Downloading…';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    load(await r.arrayBuffer(), url.split('/').pop());
  } catch (e) { ui.status.textContent = `Download failed (${e.message})`; }
}

function label(text, team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(520, 146, 1);
  s.renderOrder = 10;
  s.userData = { c, text, team, boost: -1 };
  return s;
}

function drawLabel(s, boost) {
  const { c, text, team } = s.userData;
  if (s.userData.boost === boost) return;
  s.userData.boost = boost;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 72);
  x.font = '600 28px system-ui, sans-serif';
  x.textAlign = 'center';
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, 256, 72);
  x.fillStyle = '#fff'; x.fillText(text.slice(0, 16), 128, 32);
  x.fillStyle = '#333'; x.fillRect(16, 46, 224, 12);
  x.fillStyle = `#${TEAM[team].getHexString()}`; x.fillRect(16, 46, 224 * boost / 255, 12);
  s.material.map.needsUpdate = true;
}

function setReplay(rep, name) {
  for (const o of [...cars, ...pads]) root.remove(o.obj ?? o);
  R = rep;
  cars = R.players.map(p => {
    const obj = buildCar(p.team, p.hitbox), tag = label(p.name, p.team);
    root.add(obj, tag);
    return { obj, tag, p };
  });
  pads = R.pads.map(p => { const o = buildPad(p.big); o.position.set(p.pos[0], p.pos[1], 0); o.userData.events = p.events; root.add(o); return o; });
  t = R.time[0];
  ui.seek.min = R.time[0]; ui.seek.max = R.time[R.T - 1]; ui.seek.step = 'any';
  ui.marks.innerHTML = R.goals.map(g => `<i style="left:${pct(R.time[g.frame])}%;background:#${TEAM[g.team].getHexString()}" title="${g.player ?? ''}"></i>`).join('');
  ui.cam.innerHTML = '<option value="-1">Orbit</option>' + R.players.map((p, i) => `<option value="${i}">${i + 1} · ${p.name}</option>`).join('');
  ui.info.textContent = [R.info.playlist, R.info.map, R.info.date].filter(Boolean).join(' · ');
  ui.status.textContent = name;
  ui.bar.hidden = false;
  playing = true;
  drawPanel(true);
}
const pct = time => 100 * (time - R.time[0]) / (R.time[R.T - 1] - R.time[0]);

// ── Sampling ─────────────────────────────────────────────────────────────────
function frameAt(time) {                                 // largest i with time[i] <= t
  let lo = 0, hi = R.T - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; R.time[m] <= time ? (lo = m) : (hi = m - 1); }
  return lo;
}

const _q = new Float32Array(4);
function pose(arr, valid, i, a, obj) {
  const j = Math.min(i + 1, R.T - 1);
  if (!valid[i] && !valid[j]) return false;
  const k0 = valid[i] ? i : j, k1 = valid[j] ? j : i, b = k0 === k1 ? 0 : a;
  const o0 = k0 * 7, o1 = k1 * 7;
  obj.position.set(arr[o0] + (arr[o1] - arr[o0]) * b, arr[o0 + 1] + (arr[o1 + 1] - arr[o0 + 1]) * b, arr[o0 + 2] + (arr[o1 + 2] - arr[o0 + 2]) * b);
  THREE.Quaternion.slerpFlat(_q, 0, arr, o0 + 3, arr, o1 + 3, b);
  obj.quaternion.fromArray(_q).normalize();
  return true;
}

function padUp(events, f) {                              // last event at or before f decides
  let lo = 0, hi = events.length - 1, r = 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (events[m][0] <= f) { r = events[m][1]; lo = m + 1; } else hi = m - 1; }
  return r;
}

let lastGoal = -1, bannerUntil = 0;
function apply() {
  const i = frameAt(t), a = i < R.T - 1 ? THREE.MathUtils.clamp((t - R.time[i]) / (R.time[i + 1] - R.time[i] || 1), 0, 1) : 0;
  ball.visible = pose(R.ball, R.ballValid, i, a, ball);

  const tp = trail.geometry.attributes.position;
  for (let k = 0; k < 48; k++) {
    const f = frameAt(t - (47 - k) * 0.03), o = f * 7;
    tp.setXYZ(k, R.ball[o], R.ball[o + 1], R.ball[o + 2]);
  }
  tp.needsUpdate = true;

  for (const { obj, tag, p } of cars) {
    obj.visible = tag.visible = pose(p.body, p.valid, i, a, obj);
    obj.userData.flame.visible = !!(p.flags[i] & 1);
    obj.userData.flame.scale.y = 0.8 + Math.random() * 0.5;
    tag.position.copy(obj.position).z += 230;
    drawLabel(tag, p.boost[i]);
  }
  for (const pad of pads) pad.userData.orb.visible = !!padUp(pad.userData.events, i);

  const demo = R.demos.find(d => i >= d.frame && R.time[i] - R.time[d.frame] < 0.6);
  boom.visible = !!demo;
  if (demo) {
    const k = (R.time[i] - R.time[demo.frame]) / 0.6;
    boom.position.fromArray(demo.pos);
    boom.scale.setScalar(80 + 420 * k);
    boom.material.opacity = 0.8 * (1 - k);
  }

  const score = [0, 0];
  for (const g of R.goals) if (g.frame <= i) { score[0] = g.score[0]; score[1] = g.score[1]; }
  const goal = R.goals.findLast(g => g.frame <= i);
  if (goal && goal.frame !== lastGoal && playing && R.time[i] - R.time[goal.frame] < 0.5) {
    ui.banner.textContent = `GOAL · ${goal.player ?? (goal.team ? 'Orange' : 'Blue')}`;
    ui.banner.style.color = `#${TEAM[goal.team].getHexString()}`;
    bannerUntil = performance.now() + 2500;
  }
  lastGoal = goal?.frame ?? -1;
  ui.banner.hidden = performance.now() > bannerUntil;

  const sec = R.clock[i];
  hud.clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  hud.score = score;
  ui.clock.textContent = hud.clock;
  ui.s0.textContent = score[0]; ui.s1.textContent = score[1];
  if (!scrubbing) ui.seek.value = t;
}
const hud = { clock: '5:00', score: [0, 0] };

// ── Desktop camera ───────────────────────────────────────────────────────────
const _c = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
function chase() {
  const car = cars[follow]?.obj;
  if (!car?.visible) return;
  _c.copy(car.position); _b.copy(ball.position);
  _d.subVectors(_b, _c); _d.z *= 0.3; _d.normalize();
  const eye = _c.clone().addScaledVector(_d, -320); eye.z += 120;
  root.localToWorld(eye); root.localToWorld(_b);
  camera.position.lerp(eye, 0.15);
  orbit.target.lerp(_b, 0.15);
  camera.lookAt(orbit.target);
}

// ── XR ───────────────────────────────────────────────────────────────────────
const MODES = {
  table: { scale: 1.5 / 10240, pos: [0, 0.82, -0.95], panel: [0, 0.72, -0.34] },
  stadium: { scale: 0.01, pos: [0, -2.5, -47], panel: [0, 1.0, -0.65] },
};
let xrMode = 'table';
const panelCanvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 360 });
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.197),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(panelCanvas), transparent: true }));
panel.visible = false;
scene.add(panel);
const BTN = [['−10', () => seekBy(-10)], ['play', () => (playing = !playing)], ['+10', () => seekBy(10)],
  ['speed', () => setSpeed(speed >= 4 ? 0.25 : speed * 2)], ['mode', () => setXrMode(xrMode === 'table' ? 'stadium' : 'table')],
  ['⟲', () => (stage.rotation.y += Math.PI / 4)]];

let panelKey = '';
function drawPanel(force) {
  const key = [hud.clock, hud.score, playing, speed, xrMode, R && Math.round(pct(t) * 4)].join();
  if (!force && key === panelKey) return;
  panelKey = key;
  const x = panelCanvas.getContext('2d'), W = 1024;
  x.clearRect(0, 0, W, 360);
  x.fillStyle = 'rgba(12,16,22,.86)'; x.beginPath(); x.roundRect(0, 0, W, 360, 36); x.fill();
  x.font = '700 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = `#${TEAM[0].getHexString()}`; x.fillText(hud.score[0], 380, 64);
  x.fillStyle = `#${TEAM[1].getHexString()}`; x.fillText(hud.score[1], 644, 64);
  x.fillStyle = '#fff'; x.fillText(hud.clock, 512, 64);
  x.font = '600 40px system-ui, sans-serif';
  BTN.forEach(([k], n) => {
    const bx = 32 + n * 162;
    x.fillStyle = '#232a35'; x.beginPath(); x.roundRect(bx, 128, 148, 100, 20); x.fill();
    x.fillStyle = '#e8eef7';
    x.fillText(k === 'play' ? (playing ? '❚❚' : '▶') : k === 'speed' ? `${speed}×` : k === 'mode' ? (xrMode === 'table' ? 'Table' : 'Pitch') : k, bx + 74, 178);
  });
  x.fillStyle = '#2b3340'; x.fillRect(48, 276, W - 96, 40);
  if (R) {
    x.fillStyle = '#7f8da3'; x.fillRect(48, 276, (W - 96) * pct(t) / 100, 40);
    for (const g of R.goals) { x.fillStyle = `#${TEAM[g.team].getHexString()}`; x.fillRect(48 + (W - 96) * pct(R.time[g.frame]) / 100 - 4, 266, 8, 60); }
  }
  panel.material.map.needsUpdate = true;
}

function panelPress(uv) {
  const px = uv.x * 1024, py = (1 - uv.y) * 360;
  if (py > 250 && R) return seekTo(R.time[0] + THREE.MathUtils.clamp((px - 48) / 928, 0, 1) * (R.time[R.T - 1] - R.time[0]));
  if (py > 120 && py < 240) BTN[THREE.MathUtils.clamp(Math.floor((px - 32) / 162), 0, BTN.length - 1)]?.[1]();
  drawPanel(true);
}

function setXrMode(m) {
  xrMode = m;
  const M = MODES[m];
  stage.scale.setScalar(M.scale);
  stage.position.fromArray(M.pos);
  stage.rotation.set(0, Math.PI / 2, 0);
  panel.position.fromArray(M.panel);
  panel.rotation.set(m === 'table' ? -0.7 : -0.2, 0, 0);
}

// Pointers: ray on the panel presses/scrubs; elsewhere pinch-drag moves the arena, two hands scale + rotate it.
const ray = new THREE.Raycaster(), grabs = new Map(), _m = new THREE.Matrix4();
const pointers = [0, 1].map(n => {
  const ctrl = renderer.xr.getController(n), grip = renderer.xr.getControllerGrip(n);
  scene.add(ctrl, grip);
  const hit = () => {
    _m.identity().extractRotation(ctrl.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(_m);
    return ray.intersectObject(panel)[0];
  };
  const hand = () => (grip.visible ? grip : ctrl).getWorldPosition(new THREE.Vector3());
  ctrl.addEventListener('selectstart', () => {
    const h = hit();
    if (h) { panelPress(h.uv); if ((1 - h.uv.y) * 360 > 250) grabs.set(n, { scrub: true, hit }); }
    else grabs.set(n, { last: hand(), hand });
  });
  ctrl.addEventListener('selectend', () => grabs.delete(n));
  ctrl.addEventListener('squeezestart', () => grabs.set(n, { last: hand(), hand }));
  ctrl.addEventListener('squeezeend', () => grabs.delete(n));
  return ctrl;
});

let pair = null;
function updateGrabs() {
  for (const g of grabs.values()) if (g.scrub) { const h = g.hit(); if (h) panelPress(h.uv); }
  const moving = [...grabs.values()].filter(g => g.hand);
  if (moving.length === 2) {
    const [a, b] = moving.map(g => g.hand()), d = a.distanceTo(b), ang = Math.atan2(b.z - a.z, b.x - a.x);
    if (pair) {
      stage.scale.multiplyScalar(THREE.MathUtils.clamp(d / pair.d, 0.9, 1.1));
      stage.rotation.y -= ang - pair.ang;
    }
    pair = { d, ang };
    moving.forEach(g => (g.last = g.hand()));
  } else {
    pair = null;
    for (const g of moving) {
      const p = g.hand();
      stage.position.addScaledVector(p.clone().sub(g.last), xrMode === 'table' ? 1 : 25);
      g.last = p;
    }
  }
  // Thumbsticks: x scrubs, y changes speed.
  for (const src of renderer.xr.getSession()?.inputSources ?? []) {
    const ax = src.gamepad?.axes;
    if (ax?.length >= 4 && Math.abs(ax[2]) > 0.3) seekTo(t + ax[2] * 0.5);
  }
  if (xrMode === 'table') panel.position.copy(stage.position).add(panelOffset);
}
const panelOffset = new THREE.Vector3().fromArray(MODES.table.panel).sub(new THREE.Vector3().fromArray(MODES.table.pos));

async function enterXR(kind) {
  const session = await navigator.xr.requestSession(kind, { optionalFeatures: ['local-floor', 'hand-tracking'] });
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  scene.background = kind === 'immersive-ar' ? null : bg;
  panel.visible = true;
  setXrMode('table');
  drawPanel(true);
  session.addEventListener('end', () => {
    scene.background = bg; panel.visible = false;
    stage.position.set(0, 0, 0); stage.rotation.set(0, 0, 0); stage.scale.setScalar(0.01);
  });
}
for (const [btn, kind] of [[ui.vr, 'immersive-vr'], [ui.ar, 'immersive-ar']])
  navigator.xr?.isSessionSupported(kind).then(ok => { btn.hidden = !ok; btn.onclick = () => enterXR(kind).catch(e => (ui.status.textContent = e.message)); });

// ── Controls ─────────────────────────────────────────────────────────────────
const seekTo = v => R && (t = THREE.MathUtils.clamp(v, R.time[0], R.time[R.T - 1]));
const seekBy = d => seekTo(t + d);
const setSpeed = s => { speed = s; ui.speed.value = s; };

ui.file.onchange = () => ui.file.files[0]?.arrayBuffer().then(b => load(b, ui.file.files[0].name));
ui.sample.onclick = () => loadUrl(SAMPLE);
ui.play.onclick = () => (playing = !playing);
let scrubbing = false;
ui.seek.oninput = () => seekTo(+ui.seek.value);
ui.seek.onpointerdown = () => (scrubbing = true);
addEventListener('pointerup', () => (scrubbing = false));
ui.speed.onchange = () => setSpeed(+ui.speed.value);
ui.cam.onchange = () => { follow = +ui.cam.value; orbit.enabled = follow < 0; ui.cam.blur(); };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key;
  if (k === ' ') { playing = !playing; e.preventDefault(); }
  else if (k === 'ArrowLeft') seekBy(-5);
  else if (k === 'ArrowRight') seekBy(5);
  else if (k >= '0' && k <= '8' && R) { ui.cam.value = follow = Math.min(+k - 1, R.players.length - 1); orbit.enabled = follow < 0; }
});
addEventListener('dragover', e => { e.preventDefault(); ui.drop.hidden = false; });
addEventListener('dragleave', e => { if (!e.relatedTarget) ui.drop.hidden = true; });
addEventListener('drop', e => {
  e.preventDefault(); ui.drop.hidden = true;
  const f = e.dataTransfer.files[0];
  f?.arrayBuffer().then(b => load(b, f.name));
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const q = new URLSearchParams(location.search).get('replay');
if (q) loadUrl(q === 'sample' ? SAMPLE : q);

// ── Loop ─────────────────────────────────────────────────────────────────────
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  if (R) {
    if (playing) { t += dt * speed; if (t >= R.time[R.T - 1]) { t = R.time[R.T - 1]; playing = false; } }
    apply();
    ui.play.textContent = playing ? '❚❚' : '▶';
  }
  if (renderer.xr.isPresenting) { updateGrabs(); drawPanel(); }
  else if (follow >= 0) chase(); else orbit.update();
  renderer.render(scene, camera);
});
