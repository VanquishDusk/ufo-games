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
  const silver = psx(new THREE.MeshPhongMaterial({ color: '#c6cad0', specular: '#ffffff', shininess: 70, side: THREE.DoubleSide, fog: false }));
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
