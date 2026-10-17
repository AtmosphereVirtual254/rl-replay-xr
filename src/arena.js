// Soccar arena in Rocket League units (uu), RL's own z-up frame.
import * as THREE from 'three';

export const TEAM = [new THREE.Color('#2f7bff'), new THREE.Color('#ff8a1f')];
const X = 4096, Y = 5120, H = 2044, C = 1152;          // half-width, half-length, wall height, corner leg
const GX = 893, GZ = 643, GD = 880;                     // goal half-width, height, depth

function quads(rects) {                                 // rects: [[a(xy), b(xy), z0, z1]] → vertical quads
  const p = [];
  for (const [[ax, ay], [bx, by], z0, z1] of rects)
    p.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z0, bx, by, z1, ax, ay, z1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

const lines = (pts, mat) => new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))), mat);

export function buildArena() {
  const g = new THREE.Group();
  // Floor octagon, split into team halves.
  for (const [team, s] of [[0, -1], [1, 1]]) {
    const sh = new THREE.Shape([[-X, 0], [X, 0], [X, s * (Y - C)], [X - C, s * Y], [-X + C, s * Y], [-X, s * (Y - C)]].map(([x, y]) => new THREE.Vector2(x, y)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({
      color: new THREE.Color('#16201c').lerp(TEAM[team], 0.12), roughness: 0.9, side: THREE.DoubleSide,
    }));
    g.add(floor);
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(2 * GX, GD), floor.material);
    gf.position.set(0, s * (Y + GD / 2), 0);
    g.add(gf);
  }
  // Walls: translucent panels with a goal-sized hole in each back wall.
  const ring = [[-X, -Y + C], [-X, Y - C], [-X + C, Y], [X - C, Y], [X, Y - C], [X, -Y + C], [X - C, -Y], [-X + C, -Y]];
  const rects = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (a[1] === b[1] && Math.abs(a[1]) === Y) {           // back wall: split around goal
      const s = Math.sign(b[0] - a[0]);
      rects.push([a, [-s * GX, a[1]], 0, H], [[s * GX, a[1]], b, 0, H], [[-s * GX, a[1]], [s * GX, a[1]], GZ, H]);
    } else rects.push([a, b, 0, H]);
  });
  const wallMat = new THREE.MeshBasicMaterial({ color: '#9fd4ff', transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
  g.add(new THREE.Mesh(quads(rects), wallMat));

  const edge = new THREE.LineBasicMaterial({ color: '#cfe7ff', transparent: true, opacity: 0.35 });
  const outline = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    for (const z of [0, H]) outline.push([...a, z], [...b, z]);
    outline.push([...a, 0], [...a, H]);
  });
  g.add(lines(outline, edge));

  // Field markings.
  const mark = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 });
  const m = [[-X, 0, 1], [X, 0, 1]];
  const circ = (r, n = 48) => { for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; m.push([r * Math.cos(a0), r * Math.sin(a0), 1], [r * Math.cos(a1), r * Math.sin(a1), 1]); } };
  circ(1000); circ(120, 12);
  for (const s of [-1, 1]) {                             // goal box
    const y0 = s * Y, y1 = s * (Y - 1400);
    m.push([-1800, y0, 1], [-1800, y1, 1], [-1800, y1, 1], [1800, y1, 1], [1800, y1, 1], [1800, y0, 1]);
  }
  g.add(lines(m, mark));

  // Goals: team-coloured frames (team 0 defends -y).
  for (const [team, s] of [[0, -1], [1, 1]]) {
    const mat = new THREE.LineBasicMaterial({ color: TEAM[team] });
    const y0 = s * Y, y1 = s * (Y + GD);
    const box = [[-GX, y0, 0], [-GX, y0, GZ], [-GX, y0, GZ], [GX, y0, GZ], [GX, y0, GZ], [GX, y0, 0],
      [-GX, y1, 0], [-GX, y1, GZ], [-GX, y1, GZ], [GX, y1, GZ], [GX, y1, GZ], [GX, y1, 0],
      [-GX, y0, GZ], [-GX, y1, GZ], [GX, y0, GZ], [GX, y1, GZ], [-GX, y0, 0], [-GX, y1, 0], [GX, y0, 0], [GX, y1, 0]];
    g.add(lines(box, mat));
    const net = new THREE.Mesh(quads([[[-GX, y1], [GX, y1], 0, GZ], [[-GX, y0], [-GX, y1], 0, GZ], [[GX, y0], [GX, y1], 0, GZ]]),
      new THREE.MeshBasicMaterial({ color: TEAM[team], transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    g.add(net);
  }
  return g;
}

// Hitbox [length, width, height] and centre offset [x, z] per family.
const HITBOX = {
  Octane: [118, 84.2, 36.2, 13.9, 20.8], Dominus: [127.9, 83.3, 31.3, 9, 15.8], Plank: [128.8, 84.7, 29.4, 9, 12.1],
  Breakout: [131.5, 80.5, 30.3, 12.5, 11.8], Hybrid: [127, 82.2, 34.2, 13.9, 20.8], Merc: [120.7, 76.7, 41.7, 11.4, 21.5],
};

export function buildCar(team, family) {
  const [L, W, Hh, ox, oz] = HITBOX[family] ?? HITBOX.Octane;
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: TEAM[team], roughness: 0.4, metalness: 0.3, emissive: TEAM[team], emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, W, Hh * 0.7), paint);
  body.position.set(ox, 0, oz - Hh * 0.15);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.45, W * 0.8, Hh * 0.45),
    new THREE.MeshStandardMaterial({ color: '#1a1d24', roughness: 0.2, metalness: 0.6 }));
  cabin.position.set(ox - L * 0.12, 0, oz + Hh * 0.35);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(L * 0.08, W * 0.9, Hh * 0.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  nose.position.set(ox + L * 0.47, 0, oz);
  car.add(body, cabin, nose);
  const wheel = new THREE.CylinderGeometry(14, 14, 10, 14), tire = new THREE.MeshStandardMaterial({ color: '#0c0c0c' });
  for (const x of [ox + L * 0.3, ox - L * 0.32]) for (const y of [-W * 0.45, W * 0.45]) {
    const w = new THREE.Mesh(wheel, tire);
    w.position.set(x, y, -3);
    car.add(w);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 10), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85 }));
  flame.rotation.z = Math.PI / 2;                       // cone points -x (out the back)
  flame.position.set(ox - L / 2 - 45, 0, oz);
  flame.visible = false;
  car.add(flame);
  car.userData.flame = flame;
  return car;
}

export function buildBall() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e9e9e9'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#5b5f66';
  for (let i = 0; i < 12; i++) { x.beginPath(); x.arc((i * 47) % 256, 20 + (i * 37) % 90, 11, 0, 7); x.fill(); }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(91.25, 32, 16),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.12 }));
  return ball;
}

export function buildPad(big) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(big ? 160 : 100, big ? 180 : 110, 8, 20),
    new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: '#ffb84d', emissiveIntensity: 0.15 }));
  base.rotation.x = Math.PI / 2;
  const orb = new THREE.Mesh(big ? new THREE.SphereGeometry(70, 16, 10) : new THREE.CylinderGeometry(55, 55, 10, 16),
    new THREE.MeshBasicMaterial({ color: '#ffc04d', transparent: true, opacity: 0.9 }));
  if (big) orb.position.z = 110; else { orb.rotation.x = Math.PI / 2; orb.position.z = 10; }
  g.add(base, orb);
  g.userData.orb = orb;
  return g;
}
