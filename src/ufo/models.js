// Low-poly craft models. Each returns a group plus "light markers": empty
// objects whose world positions drive glow sprites.
import * as THREE from 'three';
import { psx } from '../render/materials.js';

function marker(parent, x, y, z, color, size, role) {
  const m = new THREE.Object3D();
  m.position.set(x, y, z);
  parent.add(m);
  return { obj: m, color, size, role };
}

// Classic silver disc: wide flat saucer, banded dome with dark ports.
export function buildSaucer() {
  const group = new THREE.Group(); // position + tilt
  const body = new THREE.Group(); // slow spin
  group.add(body);
  const silver = psx(new THREE.MeshPhongMaterial({ color: '#c6cad0', specular: '#ffffff', shininess: 70, emissive: '#15171c', side: THREE.DoubleSide, fog: false }));
  const dark = psx(new THREE.MeshPhongMaterial({ color: '#1a1c20', specular: '#555', shininess: 40, fog: false }));
  const under = psx(new THREE.MeshPhongMaterial({ color: '#7a7e86', specular: '#999', shininess: 30, side: THREE.DoubleSide, fog: false }));
  const profile = [
    [0, -1.1], [2.4, -1.1], [2.9, -0.85], [3.3, -0.95], [5.4, -0.6], [6.8, -0.12], [7.0, 0.02],
    [6.85, 0.2], [4.8, 0.62], [3.4, 0.9], [3.2, 1.05], [3.25, 1.2], [3.0, 1.35], [2.7, 1.9], [2.0, 2.5], [1.1, 2.8], [0, 2.88],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  body.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), silver));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.98, 0.08, 6, 56).rotateX(Math.PI / 2), dark);
  body.add(rim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(3.22, 0.06, 6, 40).rotateX(Math.PI / 2), dark);
  band.position.y = 1.2;
  body.add(band);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.45, 24).rotateX(Math.PI / 2), under);
  disc.position.y = -1.12;
  body.add(disc);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.12), dark);
    port.position.set(Math.cos(a) * 2.82, 1.62, Math.sin(a) * 2.82);
    port.rotation.y = -a + Math.PI / 2;
    port.rotation.x = -0.35;
    body.add(port);
  }
  const lights = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lights.push(marker(body, Math.cos(a) * 6.95, -0.08, Math.sin(a) * 6.95, i % 2 ? '#ffb85a' : '#eef6ff', 1.1, 'rim'));
  }
  lights.push(marker(body, 0, -1.6, 0, '#9fd8ff', 9, 'under'));
  return { group, body, lights, materials: [silver, dark, under] };
}

// Long metallic tube with rounded ends.
export function buildCigar() {
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  const body = new THREE.Group();
  group.add(body);
  const metal = psx(new THREE.MeshPhongMaterial({ color: '#b0b5be', specular: '#ffffff', shininess: 130, fog: false, transparent: true }));
  body.add(new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 24, 8, 18).rotateZ(Math.PI / 2), metal));
  const lights = [marker(body, 13.2, 0.7, 0, '#ffffff', 5, 'endGlint'), marker(body, 0, 1.6, 0, '#ffffff', 7, 'glint')];
  return { group, body, lights, materials: [metal] };
}

// Flat matte-black equilateral triangle, lights under each corner.
export function buildTriangle() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const side = 42;
  const R = side / Math.sqrt(3);
  const shape = new THREE.Shape();
  const corners = [90, 210, 330].map((d) => THREE.MathUtils.degToRad(d));
  corners.forEach((a, i) => (i ? shape.lineTo(Math.cos(a) * R, Math.sin(a) * R) : shape.moveTo(Math.cos(a) * R, Math.sin(a) * R)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -1.1, 0);
  const black = psx(new THREE.MeshPhongMaterial({ color: '#0b0b0e', specular: '#2a2a30', shininess: 25, fog: false }));
  body.add(new THREE.Mesh(geo, black));
  const lamp = new THREE.MeshBasicMaterial({ color: '#f2fff4', fog: false });
  const lights = [];
  for (const a of corners) {
    const x = Math.cos(a) * R * 0.78;
    const z = -Math.sin(a) * R * 0.78;
    const d = new THREE.Mesh(new THREE.CircleGeometry(1.2, 14).rotateX(Math.PI / 2), lamp);
    d.position.set(x, -1.13, z);
    body.add(d);
    lights.push(marker(body, x, -1.4, z, '#f4fff6', 4.5, 'corner'));
    lights.push(marker(body, x, -3.5, z, '#6affc8', 16, 'halo'));
  }
  lights.push(marker(body, 0, -1.4, 0, '#ff2a1a', 3.2, 'center'));
  return { group, body, lights, materials: [black] };
}

// Chrome orb with helical grooves. Its envMap is a live cube capture of the
// town (set up by the manager), so it mirrors whatever is around it.
export function buildSphere() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // Diagonal lines become spiral bands when wrapped around a sphere.
  for (let i = -8; i < 16; i++) {
    const x = i * 16;
    g.strokeStyle = '#3a3c42';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 128, 128);
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 3, 0);
    g.lineTo(x + 131, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  const chrome = psx(
    new THREE.MeshPhongMaterial({ color: '#ffffff', map: tex, specular: '#ffffff', shininess: 140, combine: THREE.MixOperation, reflectivity: 0.82, fog: false }),
  );
  body.add(new THREE.Mesh(new THREE.SphereGeometry(2.6, 36, 24), chrome));
  const lights = [marker(body, 0, 0, 0, '#ffffff', 2.5, 'glint'), marker(body, 0, 0, 0, '#cfe8ff', 9, 'aura')];
  return { group, body, lights, materials: [chrome] };
}

// "Boomerang": a huge dark chevron with lights strung along its arms.
export function buildV() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const dark = psx(new THREE.MeshPhongMaterial({ color: '#121318', specular: '#2a2a32', shininess: 30, fog: false }));
  const len = 56;
  const half = THREE.MathUtils.degToRad(26);
  const lights = [marker(body, 0, -1.6, 0, '#fff2d8', 5.5, 'light')];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, len).translate(0, 0, len / 2), dark);
    arm.rotation.y = side * half;
    body.add(arm);
    for (const f of [0.5, 0.96]) {
      const x = Math.sin(side * half) * len * f;
      const z = Math.cos(side * half) * len * f;
      lights.push(marker(body, x, -1.6, z, '#fff2d8', 5.5, 'light'));
    }
  }
  for (let i = 0; i < 5; i++) lights.push(marker(body, lights[i].obj.position.x, -2.6, lights[i].obj.position.z, '#ffd9a0', 15, 'halo'));
  // The apex leads: arms trail toward +z, so the craft flies along -z.
  return { group, body, lights, materials: [dark] };
}

// A loose cluster of white points that circle one another. No hull at all.
export function buildDots(n = 5) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const lights = [];
  for (let i = 0; i < n; i++) lights.push(marker(body, 0, 0, 0, '#f6f8ff', 5, 'dot'));
  return { group, body, lights, materials: [] };
}

// LEGEND: the 1947 craft. A flat, heel-shaped wing (rounded front, swept
// pointed tail, notched trailing edge) with a small fin hanging underneath.
// Long axis is local X; the rounded nose points toward -X.
export function build1947() {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const body = new THREE.Group();
  group.add(body);
  const s = new THREE.Shape();
  s.moveTo(-4, 6);
  s.absarc(-4, 0, 6, Math.PI / 2, (Math.PI * 3) / 2, false);
  s.lineTo(6, -4.5);
  s.lineTo(14, -0.4);
  s.lineTo(13.2, 0.7);
  s.quadraticCurveTo(8, 1.2, 5, 3.6);
  s.lineTo(-4, 6);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 1, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2).translate(0, -0.55, 0);
  const hull = psx(new THREE.MeshPhongMaterial({ color: '#3a3b40', specular: '#c8ccd4', shininess: 60, fog: false, transparent: true }));
  body.add(new THREE.Mesh(geo, hull));
  const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 0.35).translate(0, -2.2, 0), hull);
  fin.position.set(3, 0, 0.3);
  fin.rotation.z = 0.25;
  body.add(fin);
  const lights = [marker(body, -1, 1.2, 0, '#ffffff', 9, 'glint')];
  return { group, body, lights, materials: [hull] };
}

// LEGEND: the Phoenix Lights. A gigantic, nearly invisible chevron carrying
// seven amber lights; later the lights hang in a row over the horizon.
export const PHOENIX_LIGHTS = 7;
export function buildPhoenix() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hullMat = psx(new THREE.MeshBasicMaterial({ color: '#05060a', fog: false, transparent: true }));
  const half = THREE.MathUtils.degToRad(30);
  const len = 175;
  const hull = new THREE.Group();
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(18, 3, len).translate(0, 0, len / 2), hullMat);
    arm.rotation.y = side * half;
    hull.add(arm);
  }
  body.add(hull);
  // Two layouts for the same lights: the flying V and the hanging row.
  const vPos = [new THREE.Vector3(0, -2.5, 0)];
  for (const f of [1 / 3, 2 / 3, 1]) {
    for (const side of [-1, 1]) vPos.push(new THREE.Vector3(Math.sin(side * half) * len * f, -2.5, Math.cos(side * half) * len * f));
  }
  const order = [5, 3, 1, 0, 2, 4, 6]; // left-to-right across the V
  const rowPos = [];
  order.forEach((vi, slot) => {
    const x = -150 + (slot * 300) / 6;
    rowPos[vi] = new THREE.Vector3(x, -18 * (x / 150) * (x / 150) + Math.sin(slot * 1.7) * 3, 0);
  });
  const lights = [];
  for (let i = 0; i < PHOENIX_LIGHTS; i++) lights.push(marker(body, vPos[i].x, vPos[i].y, vPos[i].z, '#ffe2a8', 13, 'light'));
  for (let i = 0; i < PHOENIX_LIGHTS; i++) lights.push(marker(body, vPos[i].x, vPos[i].y - 1, vPos[i].z, '#ffb870', 30, 'halo'));
  return { group, body, hull, lights, vPos, rowPos, order, materials: [hullMat] };
}
